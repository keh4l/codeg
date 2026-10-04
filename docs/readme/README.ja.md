# Codeg

[![Release](https://img.shields.io/github/v/release/keh4l/codeg)](https://github.com/keh4l/codeg/releases)
[![Upstream](https://img.shields.io/badge/upstream-xintaofei%2Fcodeg-24292f)](https://github.com/xintaofei/codeg)
[![License](https://img.shields.io/github/license/keh4l/codeg)](../../LICENSE)

<p>
  <a href="../../README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <strong>日本語</strong> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.pt.md">Português</a> |
  <a href="./README.ar.md">العربية</a>
</p>

これは **keh4l が保守する [Codeg](https://github.com/xintaofei/codeg) のカスタムビルド**です。Codeg は xintaofei が開発したマルチエージェント・コーディングワークスペースで、さまざまな AI コーディングエージェントを一か所で使い、連携させられます。このビルドは上流に密に追従しつつ、いくつか独自の機能を加えています。以下に挙げていない部分は公式版とまったく同じです。

![workspace](../images/workspace-light.png#gh-light-mode-only)
![workspace](../images/workspace-dark.png#gh-dark-mode-only)

## 公式版との違い

- **Kiro CLI を組み込みエージェントとして搭載。** Codeg は [Kiro 公式インストーラー](https://kiro.dev/docs/getting-started/installation/)でインストールした `kiro-cli` を使います。入力欄でモデル・モード・推論の強さ・思考の切り替えを選べ、スラッシュコマンド、権限モード（毎回確認、またはすべてのツールを信頼）、MCP サーバーとスキルに対応し、過去のセッションを取り込んで再開できます。設定 → エージェントの「アップグレード」は Kiro 自身のアップデーターを実行します。カスタムエージェントとして使っていた Kiro の会話は、組み込みの Kiro に移行されます。この機能は上流にも提案済みです：[xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851)。
- **ブラウザのウィンドウごとに独自のタブを持てます。** 同じサーバーで複数のウィンドウを開いても、互いに追従しなくなります。あるウィンドウで会話タブを開く・切り替える・閉じても他のウィンドウはそのままで、再読み込みするとそのウィンドウ自身のタブが戻ります。会話、メッセージ、削除はこれまでどおりすべてのウィンドウに反映されます。設定 → 一般の「ウィンドウ間で会話タブを同期」で切り替えます。ブラウザでは既定でオフ、デスクトップアプリではオンで、オンにすると公式版と同じくすべてのウィンドウが一つのタブセットを共有します。上流への要望は [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547) です。
- **Claude Code の思考内容が表示されます。** 新しいモデルでは公式版に思考の暗号化された署名しか返らず、Claude の思考欄は空のままです。このビルドは API に思考の要約を要求するので、ターミナルの `claude` で `showThinkingSummaries` をオンにしたときと同じ内容が表示されます。不要なら `~/.claude/settings.json`（またはプロジェクトの `.claude/settings.json`）に `"showThinkingSummaries": false` を書いてください。以前の会話では思考テキスト自体が返されていないため、後から復元することはできません。
- **更新はこのリポジトリから。** リリースはこのフォーク独自の更新鍵で署名されているため、このビルドが公式リリースに更新されることも、公式ビルドがこのビルドに更新されることもありません。
- **macOS アプリは公証されていません**。初回起動時に macOS が一度確認を求めます（下の「インストール」を参照）。
- **Docker イメージはありません。**

## バージョンと上流

`keh4l` ブランチは、上流の `main` に上記の変更を加えたものです。上流の更新は定期的にマージされるので、上流の新機能もこのビルドに届きます。バージョンは「上流バージョン-番号」の形で、`0.32.4-1` は上流 0.32.4 をベースにした最初のビルドです。

## インストール

**デスクトップ** — [Releases](https://github.com/keh4l/codeg/releases/latest) から最新のインストーラーをダウンロードしてください。macOS は `.dmg`（Apple シリコンまたは Intel）、Windows は `-setup.exe`（x64 または ARM64）、Linux は `.deb`・`.rpm`・`.AppImage` です。

公式の Codeg と同じアプリとしてインストールされ、公式版を置き換えます。会話と設定はそのまま残ります。

macOS で初回起動時に「壊れている」「開けません」と表示された場合は、一度だけ次を実行してください：

```bash
xattr -cr /Applications/codeg.app
```

または「システム設定 → プライバシーとセキュリティ」で開くことを許可してください。

**サーバー** — Linux または macOS：

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows では PowerShell で：

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

どちらもこのリポジトリのリリースからインストールされ、サーバーの組み込みアップデートもここを使います。

**公式版に戻すとき** — まず Codeg のデータをバックアップしてください。このビルドは Kiro 用のデータベース移行を追加しており、それを持たない公式版は同じデータで起動できない場合があります。

## ドキュメント

機能・設定・使い方は、公式の [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.ja.md) と [docs.codeg.app](https://docs.codeg.app) を参照してください。これらは公式版について書かれています。違いは上記のとおりです。

## ライセンスと謝辞

Apache-2.0。[LICENSE](../../LICENSE) を参照してください。Codeg は [xintaofei](https://github.com/xintaofei) とコントリビューターによって開発されており、このビルドはそれに機能を加えたものです。Codeg は [Agent Client Protocol](https://agentclientprotocol.com)、[Superpowers](https://github.com/obra/superpowers)、[OfficeCLI](https://github.com/iOfficeAI/OfficeCLI)、[scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) の上に成り立っています。
