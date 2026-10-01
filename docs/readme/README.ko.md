# Codeg

[![Release](https://img.shields.io/github/v/release/keh4l/codeg)](https://github.com/keh4l/codeg/releases)
[![Upstream](https://img.shields.io/badge/upstream-xintaofei%2Fcodeg-24292f)](https://github.com/xintaofei/codeg)
[![License](https://img.shields.io/github/license/keh4l/codeg)](../../LICENSE)

<p>
  <a href="../../README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.ja.md">日本語</a> |
  <strong>한국어</strong> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.pt.md">Português</a> |
  <a href="./README.ar.md">العربية</a>
</p>

이 저장소는 **keh4l이 관리하는 [Codeg](https://github.com/xintaofei/codeg) 커스텀 빌드**입니다. Codeg는 xintaofei가 만든 멀티 에이전트 코딩 워크스페이스로, 여러 AI 코딩 에이전트를 한곳에서 쓰고 서로 협업하게 해 줍니다. 이 빌드는 업스트림을 꾸준히 따라가면서 몇 가지 기능을 더했습니다. 아래에 없는 부분은 공식 앱과 똑같이 동작합니다.

![workspace](../images/workspace-light.png#gh-light-mode-only)
![workspace](../images/workspace-dark.png#gh-dark-mode-only)

## 공식 빌드와 다른 점

- **Kiro CLI가 내장 에이전트로 들어갑니다.** Codeg는 [Kiro 공식 설치 프로그램](https://kiro.dev/docs/getting-started/installation/)으로 설치한 `kiro-cli`를 실행합니다. 입력창에서 모델, 모드, 추론 강도, 생각(thinking) 스위치를 고를 수 있고, 슬래시 명령, 권한 모드(매번 묻기 또는 모든 도구 신뢰), MCP 서버와 스킬을 지원하며, 지난 세션을 가져와 이어서 진행할 수 있습니다. 설정 → 에이전트의 '업그레이드'는 Kiro 자체 업데이트 프로그램을 실행합니다. 커스텀 에이전트로 쓰던 Kiro 대화는 내장 Kiro로 옮겨집니다. 이 기능은 업스트림에도 제안되어 있습니다: [xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851).
- **업데이트는 이 저장소에서 받습니다.** 릴리스는 이 포크 자체의 업데이트 키로 서명되므로, 이 빌드가 공식 릴리스로 업데이트되거나 공식 빌드가 이 빌드로 업데이트되는 일은 없습니다.
- **macOS 앱은 공증(notarization)을 받지 않았습니다.** 처음 열 때 macOS가 한 번 확인을 요청합니다(아래 '설치' 참고).
- **Docker 이미지는 없습니다.**

## 버전과 업스트림

`keh4l` 브랜치는 업스트림 `main`에 위의 변경을 더한 것입니다. 업스트림 변경은 정기적으로 병합되므로 업스트림의 새 기능도 이 빌드에 들어옵니다. 버전은 `<업스트림 버전>-<번호>` 형식이며, `0.32.4-1`은 업스트림 0.32.4를 바탕으로 한 첫 번째 빌드입니다.

## 설치

**데스크톱** — [Releases](https://github.com/keh4l/codeg/releases/latest)에서 최신 설치 파일을 받으세요. macOS는 `.dmg`(Apple 실리콘 또는 Intel), Windows는 `-setup.exe`(x64 또는 ARM64), Linux는 `.deb`, `.rpm`, `.AppImage`입니다.

공식 Codeg와 같은 앱으로 설치되어 공식 앱을 대체하며, 대화와 설정은 그대로 유지됩니다.

macOS에서 처음 실행할 때 '손상되었습니다' 또는 '열 수 없습니다'라고 나오면 다음 명령을 한 번 실행하세요:

```bash
xattr -cr /Applications/codeg.app
```

또는 시스템 설정 → 개인정보 보호 및 보안에서 열기를 허용하세요.

**서버** — Linux 또는 macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows에서는 PowerShell에서:

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

둘 다 이 저장소의 릴리스에서 설치되며, 서버에 내장된 업데이트도 여기를 사용합니다.

**공식 빌드로 돌아갈 때** — 먼저 Codeg 데이터를 백업하세요. 이 빌드는 Kiro용 데이터베이스 마이그레이션을 추가하므로, 이것이 없는 공식 빌드는 같은 데이터로 시작하지 못할 수 있습니다.

## 문서

기능, 설정, 사용법은 공식 [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.ko.md)와 [docs.codeg.app](https://docs.codeg.app)을 참고하세요. 공식 빌드 기준으로 쓰여 있으며, 다른 점은 위에 정리되어 있습니다.

## 라이선스와 감사의 말

Apache-2.0, [LICENSE](../../LICENSE)를 참고하세요. Codeg는 [xintaofei](https://github.com/xintaofei)와 기여자들이 만들었고, 이 빌드는 거기에 기능을 더했을 뿐입니다. Codeg는 [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI), [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills)를 바탕으로 합니다.
