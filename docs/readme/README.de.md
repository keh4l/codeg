<h1 align="center">
  <img src="../../public/icon.svg" alt="Codeg logo" width="56" align="absmiddle" /> Codeg – angepasste Version
</h1>

<p align="center">
  <a href="https://github.com/keh4l/codeg/releases/latest"><img src="https://img.shields.io/github/v/release/keh4l/codeg?style=flat&color=e91e63" alt="Neuestes Release" /></a>
  <a href="https://github.com/xintaofei/codeg"><img src="https://img.shields.io/badge/upstream-xintaofei%2Fcodeg-24292f?style=flat" alt="Upstream" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/github/license/keh4l/codeg?style=flat" alt="Lizenz" /></a>
</p>

<p align="center">
  <sub><a href="../../README.md">简体中文</a> · <a href="./README.en.md">English</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.es.md">Español</a> · <strong>Deutsch</strong> · <a href="./README.fr.md">Français</a> · <a href="./README.pt.md">Português</a> · <a href="./README.ar.md">العربية</a></sub>
</p>

<p align="center">
  <strong><a href="https://github.com/xintaofei/codeg">Codeg</a>, der Multi-Agent-Coding-Workspace von xintaofei, angepasst von keh4l</strong><br/>
  Alle KI-Coding-Agenten an einem Ort, die zusammenarbeiten. Folgt dem Upstream eng und ergänzt ein paar Funktionen.
</p>

<h3 align="center"><a href="https://github.com/keh4l/codeg/releases/latest"><ins>Download</ins></a> · <a href="#installation"><ins>Installation</ins></a> · <a href="https://docs.codeg.app"><ins>Offizielle Doku</ins></a></h3>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/workspace-dark.png" />
    <img src="../images/workspace-light.png" alt="Der Codeg-Workspace: eine Unterhaltung mit einem Agenten neben seinen Live-Diffs und den Projektdateien" width="960" />
  </picture>
</p>

## Unterschiede zur offiziellen Version

<table>
  <tr>
    <td width="50%" valign="top">🤖 <strong>Kiro CLI eingebaut</strong><br/>Nutzt dein installiertes <code>kiro-cli</code>: Modell und Modus wählen, MCP-Server und Skills hinzufügen, frühere Sitzungen fortsetzen.</td>
    <td width="50%" valign="top">🪟 <strong>Tabs pro Fenster</strong><br/>Browserfenster auf demselben Server folgen nicht mehr den Tabs der anderen; Unterhaltungen und Nachrichten werden weiter synchronisiert.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">💭 <strong>Claude Code zeigt sein Thinking</strong><br/>Fordert bei der API Thinking-Zusammenfassungen an, der Thinking-Bereich bleibt also nicht mehr leer.</td>
    <td width="50%" valign="top">🔄 <strong>Nah am Upstream</strong><br/>Upstream wird regelmäßig hineingemergt; was hier nicht steht, funktioniert genau wie in der offiziellen Version.</td>
  </tr>
</table>

<details>
<summary><strong>Kiro CLI eingebaut</strong> – Details</summary>
<br/>

- Startet das `kiro-cli`, das du mit [Kiros eigenem Installer](https://kiro.dev/docs/getting-started/installation/) installiert hast.
- Im Eingabefeld wählst du Modell, Modus, Reasoning-Stufe und Thinking; seine Slash-Befehle funktionieren auch.
- Berechtigungsmodus: jedes Mal fragen oder allen Tools vertrauen.
- Du kannst ihm MCP-Server und Skills geben und frühere Sitzungen importieren und fortsetzen.
- „Aktualisieren“ unter Einstellungen → Agenten startet Kiros eigenen Updater.
- Unterhaltungen, die du mit Kiro als benutzerdefiniertem Agenten geführt hast, wandern zum eingebauten Agenten.
- Upstream vorgeschlagen: [xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851).

</details>

<details>
<summary><strong>Tabs pro Fenster</strong> – Details</summary>
<br/>

- Wer in einem Fenster einen Konversationstab öffnet, fokussiert oder schließt, lässt die anderen unverändert.
- Nach dem Neuladen kommen die Tabs genau dieses Fensters zurück.
- Konversationen, Nachrichten und Löschungen erreichen weiterhin alle Fenster.
- Gesteuert über „Konversationstabs fensterübergreifend synchronisieren“ unter Einstellungen → Allgemein – im Browser standardmäßig aus, in der Desktop-App an. Eingeschaltet teilen sich alle Fenster wie im offiziellen Build einen Satz Tabs.
- Upstream angefragt in [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547).

</details>

<details>
<summary><strong>Claude Code zeigt sein Thinking</strong> – Details</summary>
<br/>

- Bei neueren Modellen bekommt die offizielle Version für jeden Thinking-Block nur eine verschlüsselte Signatur, Claudes Thinking bleibt also leer.
- Diese Version fordert bei der API Thinking-Zusammenfassungen an – dasselbe, was das Terminal-`claude` mit eingeschaltetem `showThinkingSummaries` zeigt.
- Zum Abschalten trägst du das in `~/.claude/settings.json` (oder in die `.claude/settings.json` eines Projekts) ein:

  ```json
  "showThinkingSummaries": false
  ```

- Für frühere Unterhaltungen wurde nie Thinking-Text geliefert, er lässt sich daher nicht nachholen.

</details>

### Veröffentlichung

|  | Diese Version | Offizielle Version |
| --- | --- | --- |
| Downloads und Updates | [Releases](https://github.com/keh4l/codeg/releases) dieses Repositorys, mit dem eigenen Schlüssel dieses Forks signiert | Releases von [xintaofei/codeg](https://github.com/xintaofei/codeg/releases) |
| Version | `<Upstream-Version>-<n>`: `0.33.0-2` ist die 2. Version auf Basis von Upstream 0.33.0 | z. B. `0.33.0` |
| macOS-Notarisierung | Nein; beim ersten Start einmal erlauben (siehe [Installation](#installation)) | Ja |
| Docker-Image | Nein | Ja |

Updates wechseln nie die Seite: Diese Version aktualisiert sich nie auf ein offizielles Release, und eine offizielle Version nie auf diese. Der Branch `keh4l` ist Upstreams `main` plus die Änderungen oben.

## Installation

### Desktop

Lade den neuesten Installer unter [Releases](https://github.com/keh4l/codeg/releases/latest) herunter:

| System | Installer |
| --- | --- |
| macOS (Apple Silicon oder Intel) | `.dmg` |
| Windows (x64 oder ARM64) | `-setup.exe` |
| Linux | `.deb`, `.rpm` oder `.AppImage` |

Sie wird als dieselbe App wie das offizielle Codeg installiert: Sie ersetzt es und behält deine Unterhaltungen und Einstellungen.

> [!NOTE]
> Wenn macOS beim ersten Start meldet, die App sei beschädigt oder könne nicht geöffnet werden, führe einmal Folgendes aus oder erlaube sie unter Systemeinstellungen → Datenschutz & Sicherheit:
>
> ```bash
> xattr -cr /Applications/codeg.app
> ```

### Server

Linux oder macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

Beide installieren aus den Releases dieses Repositorys, und auch der eingebaute Updater des Servers nutzt sie.

### Zurück zur offiziellen Version

> [!WARNING]
> Sichere zuerst deine Codeg-Daten. Diese Version fügt eine Datenbankmigration für Kiro hinzu, und eine offizielle Version ohne sie startet mit denselben Daten möglicherweise nicht.

## Dokumentation

Funktionen, Konfiguration und Nutzung beschreiben das offizielle [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.de.md) und [docs.codeg.app](https://docs.codeg.app). Sie beziehen sich auf die offizielle Version; die Unterschiede stehen oben.

## Lizenz und Danksagung

Apache-2.0, siehe [LICENSE](../../LICENSE). Codeg wird von [xintaofei](https://github.com/xintaofei) und den Mitwirkenden entwickelt; diese Version ergänzt es nur. Codeg baut auf [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) und [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) auf.
