# DSH Web Guardian

`dsh-web-guardian` runs DeepSeek Harness Web behind an authenticated LAN-only
gateway. It keeps the DSH process alive as a user-level systemd service and
provides a custom Chinese login page rather than a browser Basic Auth popup.

## Features

- One-time installation creates and enables `dsh-web.service`.
- DSH stays on `127.0.0.1:3081`; the gateway listens on a selected LAN IPv4
  address at port `3080`.
- Password form login with an HttpOnly, SameSite session cookie.
- Basic Auth remains available to scripts and health checks.
- The DSH settings/credentials API remains behind the authenticated gateway.
- Includes a compatibility shim for browsers where HTTP pages lack
  `crypto.randomUUID()`.

## Install

Install DSH first, then install this package from GitHub:

```bash
npm install -g github:OWNER/dsh-web-guardian
dsh-web install
```

The first install prints a generated password. To choose credentials instead:

```bash
DSH_WEB_USERNAME=lyy DSH_WEB_PASSWORD='change-me-now' dsh-web install
```

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
