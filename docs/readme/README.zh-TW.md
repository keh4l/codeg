# Codeg

[![Release](https://img.shields.io/github/v/release/keh4l/codeg)](https://github.com/keh4l/codeg/releases)
[![Upstream](https://img.shields.io/badge/upstream-xintaofei%2Fcodeg-24292f)](https://github.com/xintaofei/codeg)
[![License](https://img.shields.io/github/license/keh4l/codeg)](../../LICENSE)

<p>
  <a href="../../README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a> |
  <strong>繁體中文</strong> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.pt.md">Português</a> |
  <a href="./README.ar.md">العربية</a>
</p>

這是 **keh4l 維護的 [Codeg](https://github.com/xintaofei/codeg) 客製版**。Codeg 是 xintaofei 開發的多智慧體程式設計工作台，把各種 AI 程式設計智慧體放在一起使用、彼此協作。客製版緊跟上游，另外加了一些自己的東西；下面沒列出的功能，和官方版完全一樣。

![workspace](../images/workspace-light.png#gh-light-mode-only)
![workspace](../images/workspace-dark.png#gh-dark-mode-only)

## 與官方版的差異

- **內建 Kiro CLI 智慧體。** Codeg 會使用你以 [Kiro 官方安裝程式](https://kiro.dev/docs/getting-started/installation/)安裝好的 `kiro-cli`：可以在輸入框選擇模型、模式、推理強度與思考開關，使用它的斜線指令，設定權限模式（每次詢問或信任所有工具），為它設定 MCP 伺服器與技能，還能匯入並繼續它以前的工作階段。「設定 → 智慧體」裡的「升級」會執行 Kiro 自己的更新程式。以前以自訂智慧體使用的 Kiro 對話，會移轉到內建的 Kiro 底下。這項功能也已經向上游提交：[xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851)。
- **每個瀏覽器視窗可以有自己的一組分頁。** 在同一台伺服器上開多個視窗時不再互相跟隨：在一個視窗裡開啟、切換或關閉會話分頁，其他視窗維持原樣，重新整理後還原的也是本視窗自己的分頁。會話、訊息和刪除操作仍會同步到所有視窗。對應「設定 → 一般」裡的「跨視窗同步會話分頁」：瀏覽器端預設關閉，桌面端預設開啟；開啟後所有視窗共用一組分頁，與官方版一致。上游的對應需求見 [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547)。
- **Claude Code 能看到思考過程。** 新模型在官方版裡只回傳加密的思考簽章，Claude 的思考內容一直是空的；客製版會向 API 請求思考摘要，和終端機裡開啟 `showThinkingSummaries` 後的 `claude` 看到的一樣。不需要的話，在 `~/.claude/settings.json`（或專案的 `.claude/settings.json`）裡寫入 `"showThinkingSummaries": false`。以前的對話當時就沒有回傳思考文字，無法補回。
- **從本儲存庫取得更新。** 發行套件以本 fork 自己的更新金鑰簽署：客製版不會被更新成官方版，官方版也不會被更新成客製版。
- **macOS 應用程式沒有經過 Apple 公證**，第一次開啟時 macOS 會擋一下（見下方「安裝」）。
- **沒有 Docker 映像檔。**

## 版本與上游

`keh4l` 分支 = 上游的 `main` + 上面這些改動。上游的更新會定期合併進來，所以上游的新功能客製版也會有。版本號寫作「上游版本-序號」：`0.32.4-1` 就是基於上游 0.32.4 的第一個客製版。

## 安裝

**桌面版** —— 從 [Releases](https://github.com/keh4l/codeg/releases/latest) 下載最新的安裝檔：macOS 用 `.dmg`（Apple 晶片或 Intel），Windows 用 `-setup.exe`（x64 或 ARM64），Linux 用 `.deb`、`.rpm` 或 `.AppImage`。

它和官方版是同一個應用程式：安裝後會取代官方版，原有的對話和設定都會保留。

macOS 第一次開啟時如果提示「已損毀」或「無法開啟」，執行一次：

```bash
xattr -cr /Applications/codeg.app
```

或者在「系統設定 → 隱私權與安全性」裡允許開啟。

**伺服器** —— Linux 或 macOS：

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

兩者都從本儲存庫的 Releases 安裝，伺服器內建的更新也走這裡。

**換回官方版** —— 先備份 Codeg 的資料。客製版為 Kiro 加了一個資料庫遷移，沒有這個遷移的官方版可能無法用同一份資料啟動。

## 文件

功能、設定與用法請看官方 [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.zh-TW.md) 和 [docs.codeg.app](https://docs.codeg.app)。它們描述的是官方版，差異見上文。

## 授權與致謝

Apache-2.0，見 [LICENSE](../../LICENSE)。Codeg 由 [xintaofei](https://github.com/xintaofei) 及貢獻者開發，客製版只是在它的基礎上增加內容。Codeg 建立在 [Agent Client Protocol](https://agentclientprotocol.com)、[Superpowers](https://github.com/obra/superpowers)、[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) 和 [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) 之上。
