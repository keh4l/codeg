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
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <strong>Português</strong> |
  <a href="./README.ar.md">العربية</a>
</p>

Esta é **a versão personalizada do [Codeg](https://github.com/xintaofei/codeg) mantida por keh4l**. O Codeg é o espaço de trabalho multiagente para programação criado por xintaofei: todos os seus agentes de programação com IA num só lugar, trabalhando juntos. Esta versão acompanha de perto o projeto original e acrescenta algumas coisas próprias; tudo o que não está listado abaixo funciona exatamente como no app oficial.

![workspace](../images/workspace-light.png#gh-light-mode-only)
![workspace](../images/workspace-dark.png#gh-dark-mode-only)

## Diferenças em relação à versão oficial

- **O Kiro CLI é um agente integrado.** O Codeg executa o `kiro-cli` que você instalou com o [instalador oficial do Kiro](https://kiro.dev/docs/getting-started/installation/). No compositor você escolhe modelo, modo, esforço de raciocínio e pensamento; usa os comandos de barra dele; escolhe um modo de permissão (perguntar, ou confiar em todas as ferramentas); configura servidores MCP e skills; e importa e retoma sessões anteriores. Atualizar, em Configurações → Agentes, executa o atualizador do próprio Kiro. As conversas que você tinha com o Kiro como agente personalizado passam para o agente integrado. Isso também foi proposto ao projeto original: [xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851).
- **Cada janela do navegador pode ter as próprias abas.** Várias janelas no mesmo servidor não seguem mais umas às outras: abrir, focar ou fechar uma aba de conversa em uma deixa as outras como estavam, e ao recarregar voltam as abas daquela janela. Conversas, mensagens e exclusões continuam chegando a todas as janelas. É a opção "Sincronizar abas de conversa entre janelas" em Configurações → Geral: desativada por padrão no navegador e ativada no aplicativo desktop; ativada, todas as janelas compartilham um único conjunto de abas, como na versão oficial. Solicitado ao upstream em [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547).
- **As atualizações vêm deste repositório.** As versões são assinadas com a chave de atualização própria deste fork, então esta versão nunca atualiza para uma versão oficial, nem uma versão oficial para esta.
- **O app para macOS não é notarizado**, então o macOS pede confirmação na primeira vez que você o abre (veja Instalação, abaixo).
- **Não há imagem Docker.**

## Versões e projeto original

O branch `keh4l` é o `main` do projeto original mais as mudanças acima. O original é mesclado regularmente, então as novidades dele também chegam aqui. As versões seguem `<versão original>-<n>`: `0.32.4-1` é a primeira versão baseada na 0.32.4 original.

## Instalação

**Desktop** — baixe o instalador mais recente em [Releases](https://github.com/keh4l/codeg/releases/latest): `.dmg` para macOS (Apple Silicon ou Intel), `-setup.exe` para Windows (x64 ou ARM64), `.deb`, `.rpm` ou `.AppImage` para Linux.

Ele é instalado como o mesmo app do Codeg oficial: substitui o oficial e mantém suas conversas e configurações.

No macOS, se na primeira abertura aparecer que o app está danificado ou não pode ser aberto, execute uma vez:

```bash
xattr -cr /Applications/codeg.app
```

ou permita-o em Ajustes do Sistema → Privacidade e Segurança.

**Servidor** — no Linux ou macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

No Windows, no PowerShell:

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

Ambos instalam a partir das versões deste repositório, e o atualizador embutido do servidor também as usa.

**Voltar para a versão oficial** — faça antes um backup dos seus dados do Codeg. Esta versão adiciona uma migração de banco de dados para o Kiro, e uma versão oficial que não a tenha pode se recusar a iniciar com os mesmos dados.

## Documentação

Para recursos, configuração e uso, veja o [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.pt.md) oficial e [docs.codeg.app](https://docs.codeg.app). Eles descrevem a versão oficial; as diferenças estão acima.

## Licença e agradecimentos

Apache-2.0, veja [LICENSE](../../LICENSE). O Codeg é criado por [xintaofei](https://github.com/xintaofei) e seus colaboradores; esta versão apenas acrescenta a ele. O Codeg se apoia no [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) e [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills).
