# Codeg

[![Release](https://img.shields.io/github/v/release/keh4l/codeg)](https://github.com/keh4l/codeg/releases)
[![Upstream](https://img.shields.io/badge/upstream-xintaofei%2Fcodeg-24292f)](https://github.com/xintaofei/codeg)
[![License](https://img.shields.io/github/license/keh4l/codeg)](../../LICENSE)

<p>
  <a href="../../README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <strong>Deutsch</strong> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.pt.md">Português</a> |
  <a href="./README.ar.md">العربية</a>
</p>

Dies ist **keh4ls angepasste Version von [Codeg](https://github.com/xintaofei/codeg)**, dem Multi-Agent-Coding-Workspace von xintaofei: alle KI-Coding-Agenten an einem Ort, die zusammenarbeiten. Diese Version folgt dem Upstream-Projekt eng und ergänzt ein paar eigene Dinge; alles, was unten nicht aufgeführt ist, funktioniert genau wie in der offiziellen App.

![workspace](../images/workspace-light.png#gh-light-mode-only)
![workspace](../images/workspace-dark.png#gh-dark-mode-only)

## Unterschiede zur offiziellen Version

- **Kiro CLI ist ein eingebauter Agent.** Codeg startet das `kiro-cli`, das du mit [Kiros eigenem Installer](https://kiro.dev/docs/getting-started/installation/) installiert hast. Im Eingabefeld wählst du Modell, Modus, Reasoning-Stufe und Thinking; dazu kommen seine Slash-Befehle, ein Berechtigungsmodus (jedes Mal fragen oder allen Tools vertrauen), MCP-Server und Skills, und du kannst frühere Sitzungen importieren und fortsetzen. „Aktualisieren“ unter Einstellungen → Agenten startet Kiros eigenen Updater. Unterhaltungen, die du mit Kiro als benutzerdefiniertem Agenten geführt hast, wandern zum eingebauten Agenten. Das ist auch upstream vorgeschlagen: [xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851).
- **Jedes Browserfenster kann seine eigenen Tabs behalten.** Mehrere Fenster auf demselben Server folgen einander nicht mehr: Wer in einem Fenster einen Konversationstab öffnet, fokussiert oder schließt, lässt die anderen unverändert, und nach dem Neuladen kommen die Tabs genau dieses Fensters zurück. Konversationen, Nachrichten und Löschungen erreichen weiterhin alle Fenster. Gesteuert wird das über „Konversationstabs fensterübergreifend synchronisieren“ unter Einstellungen → Allgemein – im Browser standardmäßig aus, in der Desktop-App an; eingeschaltet teilen sich alle Fenster wie im offiziellen Build einen Satz Tabs. Upstream angefragt in [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547).
- **Updates kommen aus diesem Repository.** Releases sind mit dem eigenen Update-Schlüssel dieses Forks signiert. Diese Version aktualisiert sich also nie auf ein offizielles Release, und eine offizielle Version nie auf eines von diesen.
- **Die macOS-App ist nicht notarisiert**, daher fragt macOS beim ersten Öffnen einmal nach (siehe Installation unten).
- **Es gibt kein Docker-Image.**

## Versionen und Upstream

Der Branch `keh4l` ist Upstreams `main` plus die Änderungen oben. Upstream wird regelmäßig hineingemergt, neue Upstream-Funktionen kommen also auch hier an. Versionen lauten `<Upstream-Version>-<n>`: `0.32.4-1` ist die erste Version auf Basis von Upstream 0.32.4.

## Installation

**Desktop** — lade den neuesten Installer unter [Releases](https://github.com/keh4l/codeg/releases/latest) herunter: `.dmg` für macOS (Apple Silicon oder Intel), `-setup.exe` für Windows (x64 oder ARM64), `.deb`, `.rpm` oder `.AppImage` für Linux.

Sie wird als dieselbe App wie das offizielle Codeg installiert: Sie ersetzt es und behält deine Unterhaltungen und Einstellungen.

Wenn macOS beim ersten Start meldet, die App sei beschädigt oder könne nicht geöffnet werden, führe einmal Folgendes aus:

```bash
xattr -cr /Applications/codeg.app
```

oder erlaube sie unter Systemeinstellungen → Datenschutz & Sicherheit.

**Server** — unter Linux oder macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Unter Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

Beide installieren aus den Releases dieses Repositorys, und auch der eingebaute Updater des Servers nutzt sie.

**Zurück zur offiziellen Version** — sichere zuerst deine Codeg-Daten. Diese Version fügt eine Datenbankmigration für Kiro hinzu, und eine offizielle Version ohne sie startet mit denselben Daten möglicherweise nicht.

## Dokumentation

Funktionen, Konfiguration und Nutzung beschreiben das offizielle [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.de.md) und [docs.codeg.app](https://docs.codeg.app). Sie beziehen sich auf die offizielle Version; die Unterschiede stehen oben.

## Lizenz und Danksagung

Apache-2.0, siehe [LICENSE](../../LICENSE). Codeg wird von [xintaofei](https://github.com/xintaofei) und den Mitwirkenden entwickelt; diese Version ergänzt es nur. Codeg baut auf [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) und [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) auf.
