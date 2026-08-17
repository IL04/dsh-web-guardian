#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const home = os.homedir()
const configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'dsh-web')
const credentialFile = path.join(configDir, 'credentials.json')
const unitDir = path.join(configDir, '..', 'systemd', 'user')
const unitFile = path.join(unitDir, 'dsh-web.service')
const scriptPath = fileURLToPath(import.meta.url)
const publicPort = port(process.env.DSH_WEB_PORT, 3080, 'DSH_WEB_PORT')
const upstreamPort = port(process.env.DSH_WEB_UPSTREAM_PORT, 3081, 'DSH_WEB_UPSTREAM_PORT')
const bindHost = process.env.DSH_WEB_HOST || lanAddress()
const publicAuthority = `${bindHost}:${publicPort}`
const upstreamAuthority = `127.0.0.1:${upstreamPort}`

function executableOnPath(name) {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(directory || '.', name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {}
  }
}

// Resolve this during installation, while the interactive shell still has the
// global DSH bin directory on PATH. The generated systemd unit then continues
// to work even when it has a minimal service PATH.
const dshBin = process.env.DSH_BIN || executableOnPath('dsh') || 'dsh'

function port(value, fallback, name) {
  if (!value) return fallback
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error(`${name} must be a valid TCP port`)
  return result
}

function lanAddress() {
  const candidates = Object.entries(os.networkInterfaces()).flatMap(([name, values]) => (values || [])
    .filter(value => value.family === 'IPv4' && !value.internal)
    .map(value => ({ name, address: value.address })))
  const preferred = candidates.find(({ name }) => /^(en|eth|eno|ens|bond|wlan|wlp)/iu.test(name))
  const fallback = candidates.find(({ name }) => !/^(docker|br-|veth|virbr)/iu.test(name))
  const selected = preferred || fallback || candidates[0]
  if (!selected) throw new Error('No LAN IPv4 address found. Set DSH_WEB_HOST explicitly.')
  return selected.address
}

function saveCredentials(value) {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(credentialFile, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(credentialFile, 0o600)
}

function loadCredentials() {
  try {
    const value = JSON.parse(fs.readFileSync(credentialFile, 'utf8'))
    if (!value.username || value.username.includes(':') || !value.salt || !value.hash) throw new Error('invalid fields')
    if (!value.sessionSecret) {
      value.sessionSecret = crypto.randomBytes(32).toString('base64url')
      saveCredentials(value)
    }
    return value
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw new Error(`Cannot read ${credentialFile}: ${error.message}`)
  }
}

function writeCredentials(username, password) {
  if (!username || username.includes(':')) throw new Error('Username must be non-empty and cannot contain a colon.')
  if (password.length < 8) throw new Error('Password must contain at least 8 characters.')
  const salt = crypto.randomBytes(16)
  saveCredentials({ username, salt: salt.toString('base64'), hash: crypto.scryptSync(password, salt, 32).toString('base64'), sessionSecret: crypto.randomBytes(32).toString('base64url') })
}

function setCredentials(reset) {
  const existing = loadCredentials()
  const supplied = process.env.DSH_WEB_PASSWORD
  if (!reset && existing && !supplied) return existing
  const username = process.env.DSH_WEB_USERNAME || existing?.username || 'admin'
  const password = supplied || crypto.randomBytes(24).toString('base64url')
  writeCredentials(username, password)
  if (supplied) console.error('[dsh-web] Credentials updated from environment variables.')
  else console.error(`[dsh-web] ${reset ? 'New' : 'Initial'} password for ${username}: ${password}`)
  return loadCredentials()
}

function equals(credentials, username, password) {
  if (username !== credentials.username) return false
  const actual = crypto.scryptSync(password, Buffer.from(credentials.salt, 'base64'), 32)
  const expected = Buffer.from(credentials.hash, 'base64')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function basic(header) {
  if (!header?.startsWith('Basic ')) return undefined
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    return separator < 0 ? undefined : [decoded.slice(0, separator), decoded.slice(separator + 1)]
  } catch { return undefined }
}

function cookie(request, name) {
  for (const entry of (request.headers.cookie || '').split(';')) {
    const [key, ...rest] = entry.trim().split('=')
    if (key === name) return rest.join('=')
  }
}

function signature(credentials, expiry) {
  return crypto.createHmac('sha256', credentials.sessionSecret).update(`${credentials.username}:${expiry}`).digest('base64url')
}

function validSession(credentials, request) {
  const [expiry, value] = (cookie(request, 'dsh_web_session') || '').split('.', 2)
  if (!/^\d+$/.test(expiry || '') || Number(expiry) <= Date.now() || !value) return false
  const expected = Buffer.from(signature(credentials, expiry))
  const actual = Buffer.from(value)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function authenticated(request, credentials) {
  if (validSession(credentials, request)) return true
  if (request.headers.accept?.includes('text/html')) return false
  const value = basic(request.headers.authorization)
  return value !== undefined && equals(credentials, value[0], value[1])
}

function loginPage(error = false) {
  const notice = error ? '<p class="error">账户或密码不正确，请重试。</p>' : '<p class="hint">使用此 DSH Web 服务的访问凭据登录。</p>'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · DSH Web</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 15% 15%,#203d78 0,transparent 32rem),radial-gradient(circle at 85% 80%,#184c46 0,transparent 28rem),#0a1020;color:#edf2ff;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}.card{width:min(420px,calc(100% - 32px));padding:38px;border:1px solid #ffffff1f;border-radius:24px;background:#101a31d9;box-shadow:0 24px 80px #0007;backdrop-filter:blur(18px)}.mark{width:44px;height:44px;display:grid;place-items:center;border-radius:13px;background:linear-gradient(135deg,#72a9ff,#7c65ff);font-size:23px}h1{font-size:28px;letter-spacing:-.04em;margin:22px 0 4px}.sub{margin:0 0 26px;color:#aebbd5}.hint,.error{margin:0 0 18px;font-size:14px}.hint{color:#aebbd5}.error{color:#ffb4b4}label{display:block;margin:15px 0 7px;color:#cbd5ed;font-size:14px;font-weight:600}input{width:100%;border:1px solid #ffffff26;border-radius:11px;padding:12px 13px;background:#071024;color:inherit;font:inherit;outline:none}input:focus{border-color:#86b2ff;box-shadow:0 0 0 3px #5a92ff2c}button{width:100%;margin-top:24px;border:0;border-radius:11px;padding:12px 16px;background:linear-gradient(135deg,#78aaff,#826cf7);color:#071024;font:700 16px inherit;cursor:pointer}.foot{margin:22px 0 0;color:#8694b1;font-size:12px;text-align:center}</style></head><body><main class="card"><div class="mark">✦</div><h1>欢迎使用 DSH Web</h1><p class="sub">DeepSeek Harness 局域网控制台</p>${notice}<form method="post" action="/login"><label for="username">账户</label><input id="username" name="username" required autofocus autocomplete="username"><label for="password">密码</label><input id="password" name="password" type="password" required autocomplete="current-password"><button type="submit">登录</button></form><p class="foot">受密码保护的本机服务</p></main></body></html>`
}

function login(response, error = false) {
  response.writeHead(error ? 401 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(loginPage(error))
}

function loginRoute(request, response, credentials) {
  if (request.method === 'GET') return login(response)
  if (request.method !== 'POST') { response.writeHead(405, { Allow: 'GET, POST' }); return response.end() }
  let body = ''
  request.setEncoding('utf8')
  request.on('data', chunk => { body += chunk; if (body.length > 8192) request.destroy() })
  request.on('end', () => {
    const form = new URLSearchParams(body)
    if (!equals(credentials, form.get('username') || '', form.get('password') || '')) return login(response, true)
    const expiry = String(Date.now() + 12 * 60 * 60 * 1000)
    response.writeHead(303, { Location: '/', 'Set-Cookie': `dsh_web_session=${expiry}.${signature(credentials, expiry)}; Max-Age=43200; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' })
    response.end()
  })
}

function logout(response) {
  response.writeHead(303, { Location: '/login', 'Set-Cookie': 'dsh_web_session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/' })
  response.end()
}

function unauthorized(target, upgrade = false) {
  if (upgrade) { target.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return target.destroy() }
  target.writeHead(401, { 'Cache-Control': 'no-store' }); target.end('Authentication required.\n')
}

// DSH uses UUIDs as client-side request identifiers. On HTTP origins some
// browsers omit crypto.randomUUID(), and a few embedded browsers omit Web
// Crypto entirely. Provide a standards-shaped UUID v4 fallback before any
// DSH client module is evaluated.
const uuidShim = `<script data-dsh-web-uuid-shim>(function(){const c=globalThis.crypto||(globalThis.crypto={});if(typeof c.randomUUID==='function')return;c.randomUUID=()=>{const b=new Uint8Array(16);if(typeof c.getRandomValues==='function')c.getRandomValues(b);else for(let i=0;i<b.length;i++)b[i]=Math.floor(Math.random()*256);b[6]=b[6]&15|64;b[8]=b[8]&63|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-')}}</script>`

function headers(request) {
  const api = request.url === '/api' || request.url?.startsWith('/api/')
  const result = { ...request.headers, 'accept-encoding': 'identity', host: api ? upstreamAuthority : (request.headers.host || publicAuthority), 'x-forwarded-for': request.socket.remoteAddress || '', 'x-forwarded-host': request.headers.host || publicAuthority, 'x-forwarded-proto': 'http' }
  if (api && result.origin !== undefined) result.origin = `http://${upstreamAuthority}`
  return result
}

function proxy(request, response) {
  const upstream = http.request({ host: '127.0.0.1', port: upstreamPort, method: request.method, path: request.url, headers: headers(request) }, remote => {
    const html = request.method !== 'HEAD' && remote.statusCode === 200 && String(remote.headers['content-type'] || '').includes('text/html')
    if (!html) { response.writeHead(remote.statusCode || 502, remote.rawHeaders); return remote.pipe(response) }
    const chunks = []
    remote.on('data', chunk => chunks.push(chunk))
    remote.on('error', () => response.destroy())
    remote.on('end', () => {
      const outgoing = { ...remote.headers, 'cache-control': 'no-store' }
      delete outgoing['content-length']; delete outgoing['content-encoding']; delete outgoing['transfer-encoding']
      const page = Buffer.concat(chunks).toString('utf8')
      response.writeHead(200, outgoing)
      response.end(page.includes('data-dsh-web-uuid-shim') ? page : page.replace(/<head[^>]*>/iu, match => `${match}${uuidShim}`))
    })
  })
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('DSH Web is starting or unavailable.\n') })
  request.pipe(upstream)
}

function proxyUpgrade(request, socket, head) {
  const upstream = http.request({ host: '127.0.0.1', port: upstreamPort, method: request.method, path: request.url, headers: headers(request) })
  upstream.on('upgrade', (remote, remoteSocket, remoteHead) => {
    const lines = [`HTTP/${remote.httpVersion} ${remote.statusCode} ${remote.statusMessage}`]
    for (let index = 0; index < remote.rawHeaders.length; index += 2) lines.push(`${remote.rawHeaders[index]}: ${remote.rawHeaders[index + 1]}`)
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head.length) remoteSocket.write(head)
    if (remoteHead.length) socket.write(remoteHead)
    remoteSocket.pipe(socket); socket.pipe(remoteSocket)
  })
  upstream.on('response', remote => { socket.write(`HTTP/1.1 ${remote.statusCode || 502} ${remote.statusMessage || ''}\r\n\r\n`); remote.pipe(socket) })
  upstream.on('error', () => socket.destroy())
  upstream.end()
}

function start() {
  const credentials = setCredentials(false)
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || '/', `http://${publicAuthority}`).pathname
    if (pathname === '/login') return loginRoute(request, response, credentials)
    if (pathname === '/logout') return logout(response)
    if (!authenticated(request, credentials)) return request.method === 'GET' && (pathname === '/' || request.headers.accept?.includes('text/html')) ? login(response) : unauthorized(response)
    proxy(request, response)
  })
  server.on('upgrade', (request, socket, head) => authenticated(request, credentials) ? proxyUpgrade(request, socket, head) : unauthorized(socket, true))
  server.on('error', error => { console.error(`[dsh-web] Cannot listen on ${bindHost}:${publicPort}: ${error.message}`); process.exit(1) })
  server.listen(publicPort, bindHost, () => {
    console.error(`[dsh-web] LAN URL: http://${bindHost}:${publicPort} (user: ${credentials.username})`)
    const child = spawn(dshBin, ['web', '--port', String(upstreamPort)], { stdio: 'inherit', env: process.env })
    let closing = false
    const close = code => server.listening ? server.close(() => process.exit(code)) : process.exit(code)
    const stop = signal => { if (closing) return; closing = true; child.kill(signal); close(0) }
    process.once('SIGINT', () => stop('SIGINT')); process.once('SIGTERM', () => stop('SIGTERM'))
    child.once('error', error => { console.error(`[dsh-web] Failed to start dsh: ${error.message}`); close(1) })
    child.once('exit', code => close(code ?? 1))
  })
}

function serviceText() {
  const executableDir = path.dirname(process.execPath)
  const binDir = path.dirname(scriptPath)
  const servicePath = [...new Set([executableDir, binDir, path.dirname(dshBin), '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin'])].join(path.delimiter)
  return `[Unit]\nDescription=Authenticated DSH Web LAN endpoint\nWants=network-online.target\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${home}\nEnvironment=PATH=${servicePath}\nEnvironment=DSH_BIN=${dshBin}\nExecStart=${process.execPath} ${scriptPath} start\nRestart=on-failure\nRestartSec=3\nKillMode=control-group\n\n[Install]\nWantedBy=default.target\n`
}

function systemctl(args) { return spawnSync('systemctl', ['--user', ...args], { stdio: 'inherit' }).status === 0 }

function install() {
  const existing = loadCredentials()
  const credentials = setCredentials(false)
  if (existing && !process.env.DSH_WEB_PASSWORD) console.log(`Using existing credentials for ${credentials.username}. Run \`dsh-web reset-password\` to generate a new password.`)
  fs.mkdirSync(unitDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(unitFile, serviceText(), { mode: 0o644 })
  if (!systemctl(['daemon-reload']) || !systemctl(['enable', 'dsh-web.service']) || !systemctl(['restart', 'dsh-web.service'])) process.exitCode = 1
  else console.log(`Installed and started dsh-web.service. Open http://${bindHost}:${publicPort}`)
}

function status() {
  const probe = net.connect({ host: bindHost, port: publicPort })
  probe.once('connect', () => { probe.end(); console.log(`dsh-web is listening on http://${bindHost}:${publicPort}`) })
  probe.once('error', () => { console.error('dsh-web is not listening'); process.exitCode = 1 })
}

function usage() { console.log('Usage: dsh-web [install|start|status|reset-password]\n\nEnvironment: DSH_WEB_HOST, DSH_WEB_PORT, DSH_WEB_UPSTREAM_PORT, DSH_WEB_USERNAME, DSH_WEB_PASSWORD, DSH_BIN') }

const command = process.argv[2] || 'start'
if (['-h', '--help', 'help'].includes(command)) usage()
else if (command === 'install') install()
else if (command === 'start') start()
else if (command === 'status') status()
else if (command === 'reset-password') {
  setCredentials(true)
  if (systemctl(['is-active', '--quiet', 'dsh-web.service'])) {
    if (!systemctl(['restart', 'dsh-web.service'])) process.exitCode = 1
    else console.log('Credentials updated and dsh-web.service restarted.')
  } else console.log('Credentials updated.')
}
else { console.error(`Unknown command: ${command}`); usage(); process.exitCode = 2 }
