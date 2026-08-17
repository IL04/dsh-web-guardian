# DSH Web Guardian

[简体中文](README.zh-CN.md) | **English**

`dsh-web-guardian` runs DeepSeek Harness Web behind an authenticated LAN-only
gateway. It keeps the DSH process alive as a user-level systemd service, so
the Web UI continues running after the SSH terminal is closed.

## Features

- One-time installation creates, enables, and starts `dsh-web.service`.
- DSH stays on `127.0.0.1:3081`; the gateway listens on a selected LAN IPv4
  address at port `3080`.
- The public listener opens only after DSH is ready, preventing an initial
  page load from receiving incomplete plugin assets.
- Password form login with an HttpOnly, SameSite session cookie.
- Basic Auth remains available to scripts and health checks.
- The DSH settings and credentials API remains behind the authenticated gateway.
- Includes a compatibility shim when HTTP pages or restricted browsers lack
  `crypto.randomUUID()`.

## Install

Install DSH first, then install this package from GitHub:

```bash
npm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui
npm install -g github:IL04/dsh-web-guardian
dsh-web install
```

The first install prints a generated password. The default username is `admin`.
To choose credentials instead:

```bash
DSH_WEB_USERNAME=lyy DSH_WEB_PASSWORD='change-me-now' dsh-web install
```

If `~/.config/dsh-web/credentials.json` already exists, installation reuses
those credentials and cannot display the previous password, which is stored
only as a hash. Generate a new random password with:

```bash
dsh-web reset-password
```

When the service is running, this command automatically restarts it so the
new password takes effect immediately.

Open the URL printed by the command from another machine on the same LAN.

## Commands

```bash
dsh-web install                 # create and start the user service
dsh-web status                  # show service / listener status
dsh-web reset-password          # generate a new password
dsh-web start                   # run in the foreground
systemctl --user restart dsh-web
```

Environment overrides: `DSH_WEB_HOST`, `DSH_WEB_PORT`,
`DSH_WEB_UPSTREAM_PORT`, `DSH_WEB_USERNAME`, `DSH_WEB_PASSWORD`, and `DSH_BIN`.

## Security

The public gateway binds only to the chosen LAN IP, while DSH itself remains
loopback-only. Use this on a trusted LAN and do not expose port 3080 directly
to the public internet. For untrusted networks, place a TLS-enabled reverse
proxy or VPN in front of it.
