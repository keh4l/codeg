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
  <strong>Español</strong> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.pt.md">Português</a> |
  <a href="./README.ar.md">العربية</a>
</p>

Esta es **la versión personalizada de [Codeg](https://github.com/xintaofei/codeg) que mantiene keh4l**. Codeg es el espacio de trabajo multiagente para programar creado por xintaofei: todos tus agentes de programación con IA en un solo lugar, trabajando juntos. Esta versión sigue de cerca al proyecto original y añade algunas cosas propias; todo lo que no aparece abajo funciona exactamente igual que en la aplicación oficial.

![workspace](../images/workspace-light.png#gh-light-mode-only)
![workspace](../images/workspace-dark.png#gh-dark-mode-only)

## Diferencias con la versión oficial

- **Kiro CLI es un agente integrado.** Codeg ejecuta el `kiro-cli` que instalaste con el [instalador oficial de Kiro](https://kiro.dev/docs/getting-started/installation/). En el compositor eliges su modelo, modo, esfuerzo de razonamiento y pensamiento; puedes usar sus comandos de barra, elegir un modo de permisos (preguntar, o confiar en todas las herramientas), darle servidores MCP y skills, e importar y reanudar sus sesiones anteriores. Actualizar, en Ajustes → Agentes, ejecuta el propio actualizador de Kiro. Las conversaciones que tenías con Kiro como agente personalizado pasan al agente integrado. También está propuesto al proyecto original: [xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851).
- **Cada ventana del navegador puede tener sus propias pestañas.** Varias ventanas sobre un mismo servidor ya no se siguen entre sí: abrir, enfocar o cerrar una pestaña de conversación en una deja las demás como estaban, y al recargar vuelven las pestañas de esa ventana. Las conversaciones, los mensajes y las eliminaciones siguen llegando a todas las ventanas. Es el interruptor «Sincronizar pestañas de conversación entre ventanas» en Ajustes → General: desactivado por defecto en el navegador y activado en la aplicación de escritorio; activado, todas las ventanas comparten un mismo conjunto de pestañas, como en la versión oficial. Solicitado upstream en [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547).
- **Claude Code muestra su pensamiento.** Con los modelos recientes, la versión oficial solo recibe una firma cifrada por cada bloque de pensamiento, así que el pensamiento de Claude aparece vacío. Esta versión pide a la API resúmenes del pensamiento: lo mismo que muestra `claude` en la terminal con `showThinkingSummaries` activado. Para desactivarlo, pon `"showThinkingSummaries": false` en `~/.claude/settings.json` (o en el `.claude/settings.json` de un proyecto). El pensamiento de conversaciones anteriores nunca se llegó a enviar, así que no se puede recuperar.
- **Las actualizaciones vienen de este repositorio.** Las versiones se firman con la clave de actualización propia de este fork, así que esta versión nunca se actualiza a una versión oficial, ni una versión oficial a esta.
- **La app de macOS no está notarizada**, así que macOS pide confirmación la primera vez que la abres (ver Instalación, más abajo).
- **No hay imagen de Docker.**

## Versiones y proyecto original

La rama `keh4l` es la rama `main` del proyecto original más los cambios de arriba. Los cambios del original se incorporan con regularidad, así que sus novedades también llegan aquí. Las versiones se escriben `<versión original>-<n>`: `0.32.4-1` es la primera versión basada en la 0.32.4 original.

## Instalación

**Escritorio** — descarga el instalador más reciente desde [Releases](https://github.com/keh4l/codeg/releases/latest): `.dmg` para macOS (Apple Silicon o Intel), `-setup.exe` para Windows (x64 o ARM64), y `.deb`, `.rpm` o `.AppImage` para Linux.

Se instala como la misma aplicación que el Codeg oficial: lo sustituye y conserva tus conversaciones y ajustes.

En macOS, si al abrirla por primera vez dice que la app está dañada o que no se puede abrir, ejecuta esto una vez:

```bash
xattr -cr /Applications/codeg.app
```

o permítela en Ajustes del Sistema → Privacidad y seguridad.

**Servidor** — en Linux o macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

En Windows, en PowerShell:

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

Ambos instalan desde las versiones de este repositorio, y el actualizador integrado del servidor también las usa.

**Volver a la versión oficial** — haz primero una copia de seguridad de tus datos de Codeg. Esta versión añade una migración de base de datos para Kiro, y una versión oficial que no la tenga puede negarse a arrancar con esos mismos datos.

## Documentación

Para funciones, configuración y uso, consulta el [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.es.md) oficial y [docs.codeg.app](https://docs.codeg.app). Describen la versión oficial; las diferencias están arriba.

## Licencia y agradecimientos

Apache-2.0, consulta [LICENSE](../../LICENSE). Codeg lo crean [xintaofei](https://github.com/xintaofei) y sus colaboradores; esta versión solo le añade cosas. Codeg se apoya en [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) y [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills).
