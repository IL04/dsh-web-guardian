# DSH Web Guardian

> 中文介绍在前，English follows.

## 中文介绍

`dsh-web-guardian` 是 [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh)
的常驻 Web 守护服务。安装完成后，它会以用户级 systemd 服务持续运行 DSH
前端：即使关闭 SSH 终端，Web UI 也不会退出。

DSH 本体只监听本机回环地址 `127.0.0.1:3081`；守护服务在局域网 IP 的
`3080` 端口提供带登录页的访问入口。因此，同一局域网中的其他机器可以直接
打开 Web UI，不需要 SSH 端口转发。

### 主要特性

- 一次安装即可创建、启用并启动 `dsh-web.service`。
- 后端仅监听 `127.0.0.1:3081`，网关仅绑定指定的局域网 IPv4 地址和端口 `3080`。
- 自定义中文密码登录页，使用 `HttpOnly`、`SameSite` 会话 Cookie。
- 兼容脚本和健康检查的 HTTP Basic Auth。
- DSH 的设置和凭据 API 也由已认证网关保护。
- 为 HTTP 环境缺少 `crypto.randomUUID()` 的浏览器自动注入兼容实现。

### 安装与使用

先安装 DSH，再从 GitHub 安装本项目：

```bash
npm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui
npm install -g github:IL04/dsh-web-guardian
dsh-web install
```

首次安装会生成并显示随机密码。若要自行指定账户和密码：

```bash
DSH_WEB_USERNAME=lyy DSH_WEB_PASSWORD='change-me-now' dsh-web install
```

如果此前已存在 `~/.config/dsh-web/credentials.json`，安装会复用已有账户，
且无法显示原密码（密码仅以哈希形式保存）。需要新随机密码时运行：

```bash
dsh-web reset-password
```

从同一局域网的另一台设备打开命令输出的 URL（通常为
`http://<服务器局域网-IP>:3080`），即可使用网页登录。常用命令：

```bash
dsh-web status                  # 查看服务与监听状态
dsh-web reset-password          # 生成新密码
systemctl --user restart dsh-web # 重启服务
```

安全提示：请仅在受信任的局域网中开放 3080 端口。不要将其直接暴露到公网；
如需跨公网访问，请在前方部署 TLS 反向代理或通过 VPN 接入。

---

## English

`dsh-web-guardian` runs DeepSeek Harness Web behind an authenticated LAN-only
gateway. It keeps the DSH process alive as a user-level systemd service, so
the Web UI continues running after the SSH terminal is closed.

### Features

- One-time installation creates and enables `dsh-web.service`.
- DSH stays on `127.0.0.1:3081`; the gateway listens on a selected LAN IPv4
  address at port `3080`.
- Password form login with an HttpOnly, SameSite session cookie.
- Basic Auth remains available to scripts and health checks.
- The DSH settings/credentials API remains behind the authenticated gateway.
- Includes a compatibility shim for browsers where HTTP pages lack
  `crypto.randomUUID()`.

### Install

Install DSH first, then install this package from GitHub:

```bash
npm install -g github:IL04/dsh-web-guardian
dsh-web install
```

The first install prints a generated password. To choose credentials instead:

```bash
DSH_WEB_USERNAME=lyy DSH_WEB_PASSWORD='change-me-now' dsh-web install
```

If `~/.config/dsh-web/credentials.json` already exists, installation reuses
those credentials and cannot display the previous password, which is stored
only as a hash. Generate a new random password with:

```bash
dsh-web reset-password
```

Open the URL printed by the command from another machine on the same LAN.

### Commands

```bash
dsh-web install                 # create and start the user service
dsh-web status                  # show service / listener status
dsh-web reset-password          # generate a new password
dsh-web start                   # run in the foreground
systemctl --user restart dsh-web
```

Environment overrides: `DSH_WEB_HOST`, `DSH_WEB_PORT`,
`DSH_WEB_UPSTREAM_PORT`, `DSH_WEB_USERNAME`, `DSH_WEB_PASSWORD`, and `DSH_BIN`.

### Security

The public gateway binds only to the chosen LAN IP, while DSH itself remains
loopback-only. Use this on a trusted LAN and do not expose port 3080 directly
to the public internet. For untrusted networks, place a TLS-enabled reverse
proxy or VPN in front of it.
