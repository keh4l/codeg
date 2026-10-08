<h1 align="center">
  <img src="../../public/icon.svg" alt="Codeg logo" width="56" align="absmiddle" /> Codeg 커스텀 빌드
</h1>

<p align="center">
  <a href="https://github.com/keh4l/codeg/releases/latest"><img src="https://img.shields.io/github/v/release/keh4l/codeg?style=flat&color=e91e63" alt="최신 릴리스" /></a>
  <a href="https://github.com/spacering-net/codeg"><img src="https://img.shields.io/badge/upstream-spacering--net%2Fcodeg-24292f?style=flat" alt="업스트림" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/github/license/keh4l/codeg?style=flat" alt="라이선스" /></a>
</p>

<p align="center">
  <sub><a href="../../README.md">简体中文</a> · <a href="./README.en.md">English</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <strong>한국어</strong> · <a href="./README.es.md">Español</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.pt.md">Português</a> · <a href="./README.ar.md">العربية</a></sub>
</p>

<p align="center">
  <strong>xintaofei의 멀티 에이전트 코딩 워크스페이스 <a href="https://github.com/spacering-net/codeg">Codeg</a>, keh4l의 커스텀 빌드</strong><br/>
  여러 AI 코딩 에이전트를 한곳에서 쓰고 서로 협업하게 해 줍니다. 업스트림을 꾸준히 따라가면서 몇 가지 기능을 더했습니다.
</p>

<h3 align="center"><a href="https://github.com/keh4l/codeg/releases/latest"><ins>다운로드</ins></a> · <a href="#설치"><ins>설치 안내</ins></a> · <a href="https://docs.codeg.app"><ins>공식 문서</ins></a></h3>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/workspace-dark.png" />
    <img src="../images/workspace-light.png" alt="Codeg 워크스페이스: 에이전트와의 대화, 그 옆의 실시간 diff와 프로젝트 파일" width="960" />
  </picture>
</p>

## 공식 빌드와 다른 점

<table>
  <tr>
    <td width="50%" valign="top">🤖 <strong>Kiro CLI 내장</strong><br/>설치해 둔 <code>kiro-cli</code>를 그대로 사용: 모델과 모드 선택, MCP와 스킬 설정, 지난 세션 이어 하기.</td>
    <td width="50%" valign="top">🪟 <strong>창마다 자체 탭</strong><br/>같은 서버에서 여러 브라우저 창을 열어도 탭이 서로 따라가지 않습니다. 대화와 메시지는 그대로 동기화됩니다.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">💭 <strong>Claude Code의 생각 과정 표시</strong><br/>API에 생각 요약을 요청하므로 생각 영역이 더 이상 비어 있지 않습니다.</td>
    <td width="50%" valign="top">🔄 <strong>업스트림 추종</strong><br/>업스트림 변경은 정기적으로 병합됩니다. 여기에 없는 기능은 공식 빌드와 똑같습니다.</td>
  </tr>
</table>

<details>
<summary><strong>Kiro CLI 내장</strong> 자세히</summary>
<br/>

- [Kiro 공식 설치 프로그램](https://kiro.dev/docs/getting-started/installation/)으로 설치한 `kiro-cli`를 실행합니다.
- 입력창에서 모델, 모드, 추론 강도, 생각(thinking) 스위치를 고를 수 있고 슬래시 명령도 쓸 수 있습니다.
- 권한 모드는 '매번 묻기' 또는 '모든 도구 신뢰' 중에서 고릅니다.
- MCP 서버와 스킬을 설정할 수 있고, 지난 세션을 가져와 이어서 진행할 수 있습니다.
- 설정 → 에이전트의 '업그레이드'는 Kiro 자체 업데이트 프로그램을 실행합니다.
- 커스텀 에이전트로 쓰던 Kiro 대화는 내장 Kiro로 옮겨집니다.
- 업스트림에도 제안되어 있습니다: [spacering-net/codeg#851](https://github.com/spacering-net/codeg/pull/851).

</details>

<details>
<summary><strong>창마다 자체 탭</strong> 자세히</summary>
<br/>

- 한 창에서 대화 탭을 열거나 전환하거나 닫아도 다른 창은 그대로입니다.
- 새로고침하면 그 창의 탭이 그대로 돌아옵니다.
- 대화, 메시지, 삭제는 여전히 모든 창에 반영됩니다.
- 설정 → 일반의 '창 간 대화 탭 동기화'로 바꿀 수 있습니다. 브라우저에서는 기본으로 꺼져 있고 데스크톱 앱에서는 켜져 있습니다. 켜면 공식 빌드처럼 모든 창이 하나의 탭 세트를 공유합니다.
- 업스트림 요청: [spacering-net/codeg#547](https://github.com/spacering-net/codeg/issues/547).

</details>

<details>
<summary><strong>Claude Code의 생각 과정 표시</strong> 자세히</summary>
<br/>

- 최신 모델에서는 공식 빌드에 생각(thinking) 블록의 암호화된 서명만 오기 때문에 Claude의 생각 내용이 비어 있습니다.
- 이 빌드는 API에 생각 요약을 요청합니다. 터미널의 `claude`에서 `showThinkingSummaries`를 켰을 때와 같은 내용입니다.
- 원하지 않으면 `~/.claude/settings.json`(또는 프로젝트의 `.claude/settings.json`)에 다음을 추가하세요:

  ```json
  "showThinkingSummaries": false
  ```

- 이전 대화는 생각 텍스트를 받은 적이 없으므로 되살릴 수 없습니다.

</details>

### 배포 방식

|  | 이 빌드 | 공식 빌드 |
| --- | --- | --- |
| 다운로드와 업데이트 | 이 저장소의 [Releases](https://github.com/keh4l/codeg/releases), 이 포크 자체의 키로 서명 | [spacering-net/codeg](https://github.com/spacering-net/codeg/releases)의 Releases |
| 버전 | `<업스트림 버전>-<번호>`: `0.33.0-2`는 업스트림 0.33.0 기반의 두 번째 빌드 | 예: `0.33.0` |
| macOS 공증 | 없음, 처음 열 때 한 번 허용 필요([설치](#설치) 참고) | 있음 |
| Docker 이미지 | 없음 | 있음 |

업데이트는 서로 넘어가지 않습니다. 이 빌드가 공식 릴리스로 업데이트되거나 공식 빌드가 이 빌드로 업데이트되는 일은 없습니다. `keh4l` 브랜치는 업스트림 `main`에 위의 변경을 더한 것입니다.

## 설치

### 데스크톱

[Releases](https://github.com/keh4l/codeg/releases/latest)에서 최신 설치 파일을 받으세요:

| 운영체제 | 설치 파일 |
| --- | --- |
| macOS(Apple 실리콘 또는 Intel) | `.dmg` |
| Windows(x64 또는 ARM64) | `-setup.exe` |
| Linux | `.deb`, `.rpm`, `.AppImage` |

공식 Codeg와 같은 앱으로 설치되어 공식 앱을 대체하며, 대화와 설정은 그대로 유지됩니다.

> [!NOTE]
> macOS에서 처음 실행할 때 '손상되었습니다' 또는 '열 수 없습니다'라고 나오면 다음 명령을 한 번 실행하거나, 시스템 설정 → 개인정보 보호 및 보안에서 열기를 허용하세요:
>
> ```bash
> xattr -cr /Applications/codeg.app
> ```

### 서버

Linux 또는 macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows(PowerShell):

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

둘 다 이 저장소의 릴리스에서 설치되며, 서버에 내장된 업데이트도 여기를 사용합니다.

### 공식 빌드로 돌아갈 때

> [!WARNING]
> 먼저 Codeg 데이터를 백업하세요. 이 빌드는 Kiro용 데이터베이스 마이그레이션을 추가하므로, 이것이 없는 공식 빌드는 같은 데이터로 시작하지 못할 수 있습니다.

## 문서

기능, 설정, 사용법은 공식 [README](https://github.com/spacering-net/codeg/blob/main/docs/readme/README.ko.md)와 [docs.codeg.app](https://docs.codeg.app)을 참고하세요. 공식 빌드 기준으로 쓰여 있으며, 다른 점은 위에 정리되어 있습니다.

## 라이선스와 감사의 말

Apache-2.0, [LICENSE](../../LICENSE)를 참고하세요. Codeg는 [xintaofei](https://github.com/xintaofei)와 기여자들이 만들었고, 이 빌드는 거기에 기능을 더했을 뿐입니다. Codeg는 [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI), [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills)를 바탕으로 합니다.
