<h1 align="center">
  <img src="../../public/icon.svg" alt="Codeg logo" width="56" align="absmiddle" /> Codeg custom build
</h1>

<p align="center">
  <a href="https://github.com/keh4l/codeg/releases/latest"><img src="https://img.shields.io/github/v/release/keh4l/codeg?style=flat&color=e91e63" alt="Latest release" /></a>
  <a href="https://github.com/xintaofei/codeg"><img src="https://img.shields.io/badge/upstream-xintaofei%2Fcodeg-24292f?style=flat" alt="Upstream" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/github/license/keh4l/codeg?style=flat" alt="License" /></a>
</p>

<p align="center">
  <sub><a href="../../README.md">简体中文</a> · <strong>English</strong> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.es.md">Español</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.pt.md">Português</a> · <a href="./README.ar.md">العربية</a></sub>
</p>

<p align="center">
  <strong>xintaofei's multi-agent coding workspace <a href="https://github.com/xintaofei/codeg">Codeg</a>, customized by keh4l</strong><br/>
  Every AI coding agent in one place, working together. Follows upstream closely and adds a few features.
</p>

<h3 align="center"><a href="https://github.com/keh4l/codeg/releases/latest"><ins>Download</ins></a> · <a href="#install"><ins>Install guide</ins></a> · <a href="https://docs.codeg.app"><ins>Official docs</ins></a></h3>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/workspace-dark.png" />
    <img src="../images/workspace-light.png" alt="The Codeg workspace: a conversation with an agent beside its live diffs and the project's files" width="960" />
  </picture>
</p>

## What's different from the official build

<table>
  <tr>
    <td width="50%" valign="top">🤖 <strong>Kiro CLI built in</strong><br/>Uses the <code>kiro-cli</code> you installed: pick its model and mode, add MCP servers and skills, resume past sessions.</td>
    <td width="50%" valign="top">🪟 <strong>Tabs per window</strong><br/>Browser windows on one server no longer follow each other's tabs; conversations and messages still sync.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">💭 <strong>Claude Code shows its thinking</strong><br/>Requests thinking summaries from the API, so the thinking section is no longer empty.</td>
    <td width="50%" valign="top">🔄 <strong>Follows upstream</strong><br/>Upstream is merged in regularly; anything not listed here works exactly as in the official build.</td>
  </tr>
</table>

<details>
<summary><strong>Kiro CLI built in</strong>: details</summary>
<br/>

- Runs the `kiro-cli` you installed with [Kiro's own installer](https://kiro.dev/docs/getting-started/installation/).
- Pick its model, mode, reasoning effort and thinking in the composer, and use its slash commands.
- Permission mode: ask every time, or trust all tools.
- Give it MCP servers and skills, and import and resume its past sessions.
- Upgrade in Settings → Agents runs Kiro's own updater.
- Conversations you had with Kiro as a custom agent move over to the built-in one.
- Proposed upstream as [xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851).

</details>

<details>
<summary><strong>Tabs per window</strong>: details</summary>
<br/>

- Opening, focusing or closing a conversation tab in one window leaves the others as they were.
- A reload brings back that window's own tabs.
- Conversations, messages and deletions still reach every window.
- It's the "Sync open conversation tabs across windows" switch in Settings → General: off by default in a browser, on in the desktop app. Turned on, all windows share one set of tabs, as in the official build.
- Requested upstream in [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547).

</details>

<details>
<summary><strong>Claude Code shows its thinking</strong>: details</summary>
<br/>

- With recent models the official build gets only an encrypted signature for each thinking block, so Claude's thinking stays empty.
- This build asks the API for thinking summaries — what the terminal `claude` shows with `showThinkingSummaries` on.
- To turn it off, add this to `~/.claude/settings.json` (or a project's `.claude/settings.json`):

  ```json
  "showThinkingSummaries": false
  ```

- Thinking from earlier conversations was never sent, so it can't be recovered.

</details>

### Releases

|  | This build | Official build |
| --- | --- | --- |
| Downloads and updates | This repository's [Releases](https://github.com/keh4l/codeg/releases), signed with this fork's own key | [xintaofei/codeg](https://github.com/xintaofei/codeg/releases) Releases |
| Version | `<upstream version>-<n>`: `0.33.0-2` is the 2nd build on upstream 0.33.0 | e.g. `0.33.0` |
| macOS notarization | None; allow it once on first launch (see [Install](#install)) | Yes |
| Docker image | None | Yes |

Updates never cross over: this build never updates to an official release, and an official build never updates to this one. The `keh4l` branch is upstream's `main` plus the changes above.

## Install

### Desktop

Download the latest installer from [Releases](https://github.com/keh4l/codeg/releases/latest):

| System | Installer |
| --- | --- |
| macOS (Apple Silicon or Intel) | `.dmg` |
| Windows (x64 or ARM64) | `-setup.exe` |
| Linux | `.deb`, `.rpm` or `.AppImage` |

It installs as the same app as the official Codeg: it replaces it and keeps your conversations and settings.

> [!NOTE]
> On macOS, if the first launch says the app is damaged or can't be opened, run this once, or allow it under System Settings → Privacy & Security:
>
> ```bash
> xattr -cr /Applications/codeg.app
> ```

### Server

Linux or macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

Both install from this repository's releases, and the server's built-in updater uses them too.

### Going back to the official build

> [!WARNING]
> Back up your Codeg data first. This build adds a database migration for Kiro, and an official build that doesn't have it may refuse to start on the same data.

## Documentation

For features, configuration and usage, see the official [README](https://github.com/xintaofei/codeg#readme) and [docs.codeg.app](https://docs.codeg.app). They describe the official build; the differences are listed above.

## License and acknowledgments

Apache-2.0, see [LICENSE](../../LICENSE). Codeg is created by [xintaofei](https://github.com/xintaofei) and its contributors; this build only adds to it. Codeg builds on [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) and [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills).
