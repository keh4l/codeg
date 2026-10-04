<h1 align="center">
  <img src="../../public/icon.svg" alt="Codeg logo" width="56" align="absmiddle" /> Codeg, versão personalizada
</h1>

<p align="center">
  <a href="https://github.com/keh4l/codeg/releases/latest"><img src="https://img.shields.io/github/v/release/keh4l/codeg?style=flat&color=e91e63" alt="Última versão" /></a>
  <a href="https://github.com/xintaofei/codeg"><img src="https://img.shields.io/badge/upstream-xintaofei%2Fcodeg-24292f?style=flat" alt="Projeto original" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/github/license/keh4l/codeg?style=flat" alt="Licença" /></a>
</p>

<p align="center">
  <sub><a href="../../README.md">简体中文</a> · <a href="./README.en.md">English</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.es.md">Español</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <strong>Português</strong> · <a href="./README.ar.md">العربية</a></sub>
</p>

<p align="center">
  <strong><a href="https://github.com/xintaofei/codeg">Codeg</a>, o espaço de trabalho multiagente de xintaofei, personalizado por keh4l</strong><br/>
  Todos os seus agentes de programação com IA num só lugar, trabalhando juntos. Acompanha de perto o projeto original e acrescenta alguns recursos.
</p>

<h3 align="center"><a href="https://github.com/keh4l/codeg/releases/latest"><ins>Baixar</ins></a> · <a href="#instalação"><ins>Instalação</ins></a> · <a href="https://docs.codeg.app"><ins>Documentação oficial</ins></a></h3>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/workspace-dark.png" />
    <img src="../images/workspace-light.png" alt="O espaço de trabalho do Codeg: uma conversa com um agente ao lado dos diffs ao vivo e dos arquivos do projeto" width="960" />
  </picture>
</p>

## Diferenças em relação à versão oficial

<table>
  <tr>
    <td width="50%" valign="top">🤖 <strong>Kiro CLI integrado</strong><br/>Usa o <code>kiro-cli</code> que você instalou: escolha modelo e modo, configure servidores MCP e skills, retome sessões anteriores.</td>
    <td width="50%" valign="top">🪟 <strong>Abas por janela</strong><br/>Janelas do navegador no mesmo servidor não seguem mais as abas umas das outras; conversas e mensagens continuam sincronizadas.</td>
  </tr>
  <tr>
    <td width="50%" valign="top">💭 <strong>O Claude Code mostra o pensamento</strong><br/>Pede à API resumos do pensamento, então essa área não fica mais vazia.</td>
    <td width="50%" valign="top">🔄 <strong>Acompanha o original</strong><br/>O projeto original é mesclado regularmente; o que não está listado aqui funciona como na versão oficial.</td>
  </tr>
</table>

<details>
<summary><strong>Kiro CLI integrado</strong>: detalhes</summary>
<br/>

- Executa o `kiro-cli` que você instalou com o [instalador oficial do Kiro](https://kiro.dev/docs/getting-started/installation/).
- No compositor você escolhe modelo, modo, esforço de raciocínio e pensamento, e usa os comandos de barra dele.
- Modo de permissão: perguntar sempre, ou confiar em todas as ferramentas.
- Você pode configurar servidores MCP e skills, e importar e retomar sessões anteriores.
- Atualizar, em Configurações → Agentes, executa o atualizador do próprio Kiro.
- As conversas que você tinha com o Kiro como agente personalizado passam para o agente integrado.
- Proposto ao projeto original: [xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851).

</details>

<details>
<summary><strong>Abas por janela</strong>: detalhes</summary>
<br/>

- Abrir, focar ou fechar uma aba de conversa em uma janela deixa as outras como estavam.
- Ao recarregar, voltam as abas daquela janela.
- Conversas, mensagens e exclusões continuam chegando a todas as janelas.
- É a opção "Sincronizar abas de conversa entre janelas" em Configurações → Geral: desativada por padrão no navegador e ativada no aplicativo desktop. Ativada, todas as janelas compartilham um único conjunto de abas, como na versão oficial.
- Solicitado ao projeto original em [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547).

</details>

<details>
<summary><strong>O Claude Code mostra o pensamento</strong>: detalhes</summary>
<br/>

- Com os modelos recentes, a versão oficial recebe só uma assinatura criptografada para cada bloco de pensamento, então o pensamento do Claude fica vazio.
- Esta versão pede à API resumos do pensamento — o mesmo que o `claude` no terminal mostra com `showThinkingSummaries` ativado.
- Para desativar, adicione isto em `~/.claude/settings.json` (ou no `.claude/settings.json` de um projeto):

  ```json
  "showThinkingSummaries": false
  ```

- O pensamento de conversas anteriores nunca foi enviado, então não dá para recuperá-lo.

</details>

### Publicação

|  | Esta versão | Versão oficial |
| --- | --- | --- |
| Downloads e atualizações | [Releases](https://github.com/keh4l/codeg/releases) deste repositório, assinadas com a chave própria deste fork | Releases de [xintaofei/codeg](https://github.com/xintaofei/codeg/releases) |
| Versão | `<versão original>-<n>`: `0.33.0-2` é a 2ª versão baseada na 0.33.0 original | ex.: `0.33.0` |
| Notarização no macOS | Não; é preciso permitir uma vez na primeira abertura (veja [Instalação](#instalação)) | Sim |
| Imagem Docker | Não | Sim |

As atualizações nunca se cruzam: esta versão nunca atualiza para uma versão oficial, nem uma versão oficial para esta. O branch `keh4l` é o `main` do projeto original mais as mudanças acima.

## Instalação

### Desktop

Baixe o instalador mais recente em [Releases](https://github.com/keh4l/codeg/releases/latest):

| Sistema | Instalador |
| --- | --- |
| macOS (Apple Silicon ou Intel) | `.dmg` |
| Windows (x64 ou ARM64) | `-setup.exe` |
| Linux | `.deb`, `.rpm` ou `.AppImage` |

Ele é instalado como o mesmo app do Codeg oficial: substitui o oficial e mantém suas conversas e configurações.

> [!NOTE]
> No macOS, se na primeira abertura aparecer que o app está danificado ou não pode ser aberto, execute o comando abaixo uma vez, ou permita-o em Ajustes do Sistema → Privacidade e Segurança:
>
> ```bash
> xattr -cr /Applications/codeg.app
> ```

### Servidor

Linux ou macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

Ambos instalam a partir das versões deste repositório, e o atualizador embutido do servidor também as usa.

### Voltar para a versão oficial

> [!WARNING]
> Faça antes um backup dos seus dados do Codeg. Esta versão adiciona uma migração de banco de dados para o Kiro, e uma versão oficial que não a tenha pode se recusar a iniciar com os mesmos dados.

## Documentação

Para recursos, configuração e uso, veja o [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.pt.md) oficial e [docs.codeg.app](https://docs.codeg.app). Eles descrevem a versão oficial; as diferenças estão acima.

## Licença e agradecimentos

Apache-2.0, veja [LICENSE](../../LICENSE). O Codeg é criado por [xintaofei](https://github.com/xintaofei) e seus colaboradores; esta versão apenas acrescenta a ele. O Codeg se apoia no [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) e [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills).
