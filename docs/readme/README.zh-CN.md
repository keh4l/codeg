# Codeg

[![Release](https://img.shields.io/github/v/release/keh4l/codeg)](https://github.com/keh4l/codeg/releases)
[![Upstream](https://img.shields.io/badge/upstream-xintaofei%2Fcodeg-24292f)](https://github.com/xintaofei/codeg)
[![License](https://img.shields.io/github/license/keh4l/codeg)](../../LICENSE)

<p>
  <a href="../../README.md">English</a> |
  <strong>简体中文</strong> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.pt.md">Português</a> |
  <a href="./README.ar.md">العربية</a>
</p>

这是 **keh4l 维护的 [Codeg](https://github.com/xintaofei/codeg) 定制版**。Codeg 是 xintaofei 开发的多智能体编码工作台，把各种 AI 编码智能体放在一起使用、相互协作。定制版紧跟上游，另外加了一些自己的东西；下面没列出的功能，和官方版完全一样。

![workspace](../images/workspace-light.png#gh-light-mode-only)
![workspace](../images/workspace-dark.png#gh-dark-mode-only)

## 与官方版的区别

- **内置 Kiro CLI 智能体。** Codeg 使用你用 [Kiro 官方安装程序](https://kiro.dev/docs/getting-started/installation/)装好的 `kiro-cli`：可以在输入框里选模型、模式、推理强度和思考开关，用它的斜杠命令，设置权限模式（每次询问或信任所有工具），给它配 MCP 服务器和技能，还能导入并继续它以前的会话。「设置 → 智能体」里的「升级」会调用 Kiro 自己的更新程序。以前作为自定义智能体使用的 Kiro 对话，会迁移到内置的 Kiro 下。这个功能也已经向上游提交：[xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851)。
- **每个浏览器窗口可以有自己的一套标签。** 同一个服务器上开多个窗口时不再互相跟随：在一个窗口里打开、切换或关闭会话标签，其他窗口保持原样，刷新后恢复的也是本窗口自己的标签。会话、消息和删除操作仍会同步到所有窗口。对应「设置 → 常规」里的「跨窗口同步会话标签」：浏览器端默认关闭，桌面端默认开启；打开后所有窗口共用一套标签，与官方版一致。上游的对应需求见 [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547)。
- **Claude Code 能看到思考过程。** 新模型在官方版里只返回加密的思考签名，Claude 的思考内容一直是空的；定制版会向 API 请求思考摘要，和终端里打开 `showThinkingSummaries` 后的 `claude` 看到的一样。不需要的话，在 `~/.claude/settings.json`（或项目的 `.claude/settings.json`）里写 `"showThinkingSummaries": false`。以前的对话当时就没有返回思考文本，无法补回。
- **从本仓库获取更新。** 发布包用本 fork 自己的更新密钥签名：定制版不会被更新成官方版，官方版也不会被更新成定制版。
- **macOS 应用没有经过 Apple 公证**，第一次打开时 macOS 会拦一下（见下方「安装」）。
- **没有 Docker 镜像。**

## 版本与上游

`keh4l` 分支 = 上游的 `main` + 上面这些改动。上游的更新会定期合并进来，所以上游的新功能定制版也会有。版本号写作「上游版本-序号」：`0.32.4-1` 就是基于上游 0.32.4 的第一个定制版。

## 安装

**桌面版** —— 从 [Releases](https://github.com/keh4l/codeg/releases/latest) 下载最新的安装包：macOS 用 `.dmg`（Apple 芯片或 Intel），Windows 用 `-setup.exe`（x64 或 ARM64），Linux 用 `.deb`、`.rpm` 或 `.AppImage`。

它和官方版是同一个应用：安装后会替换官方版，原有的对话和设置都会保留。

macOS 第一次打开时如果提示「已损坏」或「无法打开」，执行一次：

```bash
xattr -cr /Applications/codeg.app
```

或者在「系统设置 → 隐私与安全性」里允许打开。

**服务端** —— Linux 或 macOS：

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

两者都从本仓库的 Releases 安装，服务端内置的更新也走这里。

**换回官方版** —— 先备份 Codeg 的数据。定制版为 Kiro 加了一个数据库迁移，没有这个迁移的官方版可能无法用同一份数据启动。

## 文档

功能、配置和用法请看官方 [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.zh-CN.md) 和 [docs.codeg.app](https://docs.codeg.app)。它们描述的是官方版，区别见上文。

## 许可证与鸣谢

Apache-2.0，见 [LICENSE](../../LICENSE)。Codeg 由 [xintaofei](https://github.com/xintaofei) 及贡献者开发，定制版只是在它的基础上增加内容。Codeg 构建在 [Agent Client Protocol](https://agentclientprotocol.com)、[Superpowers](https://github.com/obra/superpowers)、[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) 和 [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) 之上。
