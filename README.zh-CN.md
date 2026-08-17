# DSH Web Guardian

**简体中文** | [English](README.md)

`dsh-web-guardian` 是 [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh)
的常驻 Web 守护服务。安装完成后，它会以用户级 systemd 服务持续运行 DSH
前端：即使关闭 SSH 终端，Web UI 也不会退出。

## 主要特性

- 一次安装即可创建、启用并启动 `dsh-web.service`。
- 后端仅监听 `127.0.0.1:3081`，网关仅绑定指定局域网 IPv4 地址的 `3080` 端口。
- 仅在 DSH 完成启动后开放公网监听，避免首次访问取得不完整的插件资源。
- 自定义中文密码登录页，使用 `HttpOnly`、`SameSite` 会话 Cookie。
- 兼容脚本和健康检查的 HTTP Basic Auth。
- DSH 的设置与凭据 API 也由已认证网关保护。
- 为 HTTP 环境或精简浏览器缺少 `crypto.randomUUID()` 的情况自动注入兼容实现。

## 安装与使用

先安装 DSH，再从 GitHub 安装本项目：

```bash
npm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui
npm install -g github:IL04/dsh-web-guardian
dsh-web install
```

首次安装会生成并显示随机密码，默认账户名为 `admin`。若要自行指定账户和密码：

```bash
DSH_WEB_USERNAME=lyy DSH_WEB_PASSWORD='change-me-now' dsh-web install
```

如果此前已存在 `~/.config/dsh-web/credentials.json`，安装会复用已有账户，
且无法显示原密码（密码仅以哈希形式保存）。需要新随机密码时运行：

```bash
dsh-web reset-password
```

若服务正在运行，此命令会自动重启服务，使新密码立即生效。

从同一局域网的另一台设备打开命令输出的 URL（通常为
`http://<服务器局域网-IP>:3080`），即可使用网页登录。

## 常用命令

```bash
dsh-web install                 # 创建并启动用户级服务
dsh-web status                  # 查看服务与监听状态
dsh-web reset-password          # 生成新密码
dsh-web start                   # 在前台运行
systemctl --user restart dsh-web
```

可用环境变量：`DSH_WEB_HOST`、`DSH_WEB_PORT`、`DSH_WEB_UPSTREAM_PORT`、
`DSH_WEB_USERNAME`、`DSH_WEB_PASSWORD` 与 `DSH_BIN`。

## 安全说明

公网网关仅绑定选择的局域网 IP，而 DSH 本体仍只监听回环地址。请仅在可信局域网
开放 3080 端口，切勿直接暴露到公网；如需跨公网访问，请在前方部署 TLS 反向代理
或使用 VPN。
