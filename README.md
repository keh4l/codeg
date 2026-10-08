<h1 align="center">
  <img src="./public/icon.svg" alt="Codeg logo" width="56" align="absmiddle" /> Codeg 定制版
</h1>

<p align="center">
  <a href="https://github.com/keh4l/codeg/releases/latest"><img src="https://img.shields.io/github/v/release/keh4l/codeg?style=flat&color=e91e63" alt="最新版本" /></a>
  <a href="https://github.com/spacering-net/codeg"><img src="https://img.shields.io/badge/upstream-spacering--net%2Fcodeg-24292f?style=flat" alt="上游仓库" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/keh4l/codeg?style=flat" alt="许可证" /></a>
</p>

<p align="center">
  <sub><strong>简体中文</strong> · <a href="./docs/readme/README.en.md">English</a> · <a href="./docs/readme/README.zh-TW.md">繁體中文</a> · <a href="./docs/readme/README.ja.md">日本語</a> · <a href="./docs/readme/README.ko.md">한국어</a> · <a href="./docs/readme/README.es.md">Español</a> · <a href="./docs/readme/README.de.md">Deutsch</a> · <a href="./docs/readme/README.fr.md">Français</a> · <a href="./docs/readme/README.pt.md">Português</a> · <a href="./docs/readme/README.ar.md">العربية</a></sub>
</p>

<p align="center">
  <strong>xintaofei 的多智能体编码工作台 <a href="https://github.com/spacering-net/codeg">Codeg</a>，由 keh4l 定制</strong><br/>
  把各种 AI 编码智能体放在一起使用、相互协作。紧跟上游，另外加了几个功能。
</p>

<h3 align="center"><a href="https://github.com/keh4l/codeg/releases/latest"><ins>下载</ins></a> · <a href="#安装"><ins>安装说明</ins></a> · <a href="https://docs.codeg.app"><ins>官方文档</ins></a></h3>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/images/workspace-dark.png" />
    <img src="./docs/images/workspace-light.png" alt="Codeg 工作区：和智能体的对话，旁边是实时 diff 和项目文件" width="960" />
  </picture>
</p>

## 与官方版的区别

<table>
  <tr>
    <td width="50%" valign="top">🤖 <strong>内置 Kiro CLI</strong><br/>直接用你装好的 <code>kiro-cli</code>：选模型和模式，配 MCP 和技能，继续以前的会话。</td>
    <td width="50%" valign="top">🪟 <strong>每个窗口一套标签</strong><br/>同一个服务器开多个浏览器窗口，标签互不跟随；会话和消息照常同步。</td>
  </tr>
  <tr>
    <td width="50%" valign="top">💭 <strong>Claude Code 显示思考过程</strong><br/>向 API 请求思考摘要，思考区域不再是空的。</td>
    <td width="50%" valign="top">🔄 <strong>紧跟上游</strong><br/>上游的更新定期合并进来；没列在这里的功能，和官方版完全一样。</td>
  </tr>
</table>

<details>
<summary><strong>内置 Kiro CLI</strong> 的细节</summary>
<br/>

- 使用你用 [Kiro 官方安装程序](https://kiro.dev/docs/getting-started/installation/)装好的 `kiro-cli`。
- 输入框里可以选模型、模式、推理强度和思考开关，也能用它的斜杠命令。
- 权限模式可选「每次询问」或「信任所有工具」。
- 可以给它配 MCP 服务器和技能，还能导入并继续它以前的会话。
- 「设置 → 智能体」里的「升级」调用 Kiro 自己的更新程序。
- 以前作为自定义智能体使用的 Kiro 对话，会迁移到内置的 Kiro 下。
- 已向上游提交：[spacering-net/codeg#851](https://github.com/spacering-net/codeg/pull/851)。

</details>

<details>
<summary><strong>每个窗口一套标签</strong> 的细节</summary>
<br/>

- 在一个窗口里打开、切换或关闭会话标签，其他窗口保持原样。
- 刷新后恢复的是本窗口自己的标签。
- 会话、消息和删除操作仍会同步到所有窗口。
- 开关是「设置 → 常规」里的「跨窗口同步会话标签」：浏览器端默认关闭，桌面端默认开启。打开后所有窗口共用一套标签，和官方版一样。
- 上游的对应需求：[spacering-net/codeg#547](https://github.com/spacering-net/codeg/issues/547)。

</details>

<details>
<summary><strong>Claude Code 显示思考过程</strong> 的细节</summary>
<br/>

- 新模型在官方版里只返回加密的思考签名，所以思考内容一直是空的。
- 定制版向 API 请求思考摘要，和终端里打开 `showThinkingSummaries` 后的 `claude` 看到的一样。
- 不需要的话，在 `~/.claude/settings.json`（或项目的 `.claude/settings.json`）里加上：

  ```json
  "showThinkingSummaries": false
  ```

- 以前的对话当时就没有返回思考文本，无法补回。

</details>

### 发布方式

|  | 定制版 | 官方版 |
| --- | --- | --- |
| 下载与更新 | 本仓库的 [Releases](https://github.com/keh4l/codeg/releases)，用本 fork 自己的密钥签名 | [spacering-net/codeg](https://github.com/spacering-net/codeg/releases) 的 Releases |
| 版本号 | 上游版本-序号，如 `0.33.0-2` 是基于上游 0.33.0 的第 2 个定制版 | 如 `0.33.0` |
| macOS 公证 | 没有，第一次打开要放行一次（见[安装](#安装)） | 有 |
| Docker 镜像 | 没有 | 有 |

两边的更新互不相通：定制版不会被更新成官方版，官方版也不会被更新成定制版。`keh4l` 分支就是上游的 `main` 加上上面这些改动。

## 安装

### 桌面版

从 [Releases](https://github.com/keh4l/codeg/releases/latest) 下载最新的安装包：

| 系统 | 安装包 |
| --- | --- |
| macOS（Apple 芯片或 Intel） | `.dmg` |
| Windows（x64 或 ARM64） | `-setup.exe` |
| Linux | `.deb`、`.rpm` 或 `.AppImage` |

它和官方版是同一个应用：装上后会替换官方版，原有的对话和设置都会保留。

> [!NOTE]
> macOS 第一次打开时如果提示「已损坏」或「无法打开」，执行一次下面的命令，或者在「系统设置 → 隐私与安全性」里允许打开：
>
> ```bash
> xattr -cr /Applications/codeg.app
> ```

### 服务端

Linux 或 macOS：

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

### 换回官方版

> [!WARNING]
> 先备份 Codeg 的数据。定制版为 Kiro 加了一个数据库迁移，没有这个迁移的官方版可能无法用同一份数据启动。

## 文档

功能、配置和用法请看官方 [README](https://github.com/spacering-net/codeg/blob/main/docs/readme/README.zh-CN.md) 和 [docs.codeg.app](https://docs.codeg.app)。它们描述的是官方版，区别见上文。

## 许可证与鸣谢

Apache-2.0，见 [LICENSE](./LICENSE)。Codeg 由 [xintaofei](https://github.com/xintaofei) 及贡献者开发，定制版只是在它的基础上增加内容。Codeg 构建在 [Agent Client Protocol](https://agentclientprotocol.com)、[Superpowers](https://github.com/obra/superpowers)、[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) 和 [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) 之上。
