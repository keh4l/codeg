# Codeg

[![Release](https://img.shields.io/github/v/release/keh4l/codeg)](https://github.com/keh4l/codeg/releases)
[![Upstream](https://img.shields.io/badge/upstream-xintaofei%2Fcodeg-24292f)](https://github.com/xintaofei/codeg)
[![License](https://img.shields.io/github/license/keh4l/codeg)](./LICENSE)

<p>
  <strong>English</strong> |
  <a href="./docs/readme/README.zh-CN.md">简体中文</a> |
  <a href="./docs/readme/README.zh-TW.md">繁體中文</a> |
  <a href="./docs/readme/README.ja.md">日本語</a> |
  <a href="./docs/readme/README.ko.md">한국어</a> |
  <a href="./docs/readme/README.es.md">Español</a> |
  <a href="./docs/readme/README.de.md">Deutsch</a> |
  <a href="./docs/readme/README.fr.md">Français</a> |
  <a href="./docs/readme/README.pt.md">Português</a> |
  <a href="./docs/readme/README.ar.md">العربية</a>
</p>

This is **keh4l's custom build of [Codeg](https://github.com/xintaofei/codeg)**, the multi-agent coding workspace by xintaofei: every AI coding agent in one place, working together. It follows upstream closely and adds a few things of its own. Everything not listed below works exactly as in the official app.

![workspace](./docs/images/workspace-light.png#gh-light-mode-only)
![workspace](./docs/images/workspace-dark.png#gh-dark-mode-only)

## What's different from the official build

- **Kiro CLI is a built-in agent.** Codeg runs the `kiro-cli` you installed with [Kiro's own installer](https://kiro.dev/docs/getting-started/installation/). Pick its model, mode, reasoning effort and thinking in the composer, use its slash commands, choose a permission mode (ask, or trust all tools), give it MCP servers and skills, and import and resume its past sessions. Upgrade in Settings → Agents runs Kiro's own updater. Conversations you had with Kiro as a custom agent move over to the built-in one. This is also proposed upstream as [xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851).
- **Each browser window can keep its own tabs.** Several windows on one server no longer follow each other: opening, focusing or closing a conversation tab in one leaves the others as they were, and a reload brings back that window's own tabs. Conversations, messages and deletions still reach every window. This is the "Sync open conversation tabs across windows" switch in Settings → General — off by default in a browser, on in the desktop app; turned on, all windows share one set of tabs, as in the official build. Requested upstream in [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547).
- **Updates come from this repository.** Releases are signed with this fork's own update key, so this build never updates to an official release, and an official build never updates to one of these.
- **The macOS app is not notarized**, so macOS asks once before opening it (see Install below).
- **There is no Docker image.**

## Versions and upstream

The `keh4l` branch is upstream's `main` plus the changes above. Upstream is merged in regularly, so new upstream features reach this build too. A version reads `<upstream version>-<n>`: `0.32.4-1` is the first build on top of upstream 0.32.4.

## Install

**Desktop** — download the latest installer from [Releases](https://github.com/keh4l/codeg/releases/latest): `.dmg` for macOS (Apple Silicon or Intel), `-setup.exe` for Windows (x64 or ARM64), `.deb`, `.rpm` or `.AppImage` for Linux.

It installs as the same app as the official Codeg: it replaces it and keeps your conversations and settings.

On macOS, if the first launch says the app is damaged or can't be opened, run this once:

```bash
xattr -cr /Applications/codeg.app
```

or allow it under System Settings → Privacy & Security.

**Server** — on Linux or macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

Both install from this repository's releases, and the server's built-in updater uses them too.

**Going back to the official build** — back up your Codeg data first. This build adds a database migration for Kiro, and an official build that doesn't have it may refuse to start on the same data.

## Documentation

For features, configuration and usage, see the official [README](https://github.com/xintaofei/codeg#readme) and [docs.codeg.app](https://docs.codeg.app). They describe the official build; the differences are listed above.

## License and acknowledgments

Apache-2.0, see [LICENSE](./LICENSE). Codeg is created by [xintaofei](https://github.com/xintaofei) and its contributors; this build only adds to it. Codeg builds on [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) and [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills).
