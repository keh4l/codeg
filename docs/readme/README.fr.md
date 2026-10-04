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
  <strong>Français</strong> |
  <a href="./README.pt.md">Português</a> |
  <a href="./README.ar.md">العربية</a>
</p>

Voici **la version personnalisée de [Codeg](https://github.com/xintaofei/codeg) maintenue par keh4l**. Codeg est l'espace de travail multi-agents de xintaofei : tous vos agents de code IA au même endroit, qui travaillent ensemble. Cette version suit de près le projet d'origine et ajoute quelques éléments à elle ; tout ce qui n'est pas listé ci-dessous fonctionne exactement comme dans l'application officielle.

![workspace](../images/workspace-light.png#gh-light-mode-only)
![workspace](../images/workspace-dark.png#gh-dark-mode-only)

## Différences avec la version officielle

- **Kiro CLI est un agent intégré.** Codeg lance le `kiro-cli` que vous avez installé avec [l'installateur officiel de Kiro](https://kiro.dev/docs/getting-started/installation/). Dans le compositeur, vous choisissez son modèle, son mode, son niveau de raisonnement et la réflexion ; vous disposez de ses commandes slash, d'un mode d'autorisation (demander, ou faire confiance à tous les outils), de serveurs MCP et de skills, et vous pouvez importer et reprendre ses sessions passées. « Mettre à jour » dans Réglages → Agents lance l'outil de mise à jour de Kiro lui-même. Les conversations que vous aviez avec Kiro en tant qu'agent personnalisé passent sur l'agent intégré. C'est aussi proposé en amont : [xintaofei/codeg#851](https://github.com/xintaofei/codeg/pull/851).
- **Chaque fenêtre du navigateur peut garder ses propres onglets.** Plusieurs fenêtres sur un même serveur ne se suivent plus : ouvrir, activer ou fermer un onglet de conversation dans l'une laisse les autres telles quelles, et un rechargement restaure les onglets de cette fenêtre. Les conversations, les messages et les suppressions atteignent toujours toutes les fenêtres. C'est l'interrupteur « Synchroniser les onglets de conversation entre les fenêtres » dans Réglages → Général : désactivé par défaut dans un navigateur, activé dans l'application de bureau ; activé, toutes les fenêtres partagent un même ensemble d'onglets, comme dans la version officielle. Demandé en amont dans [xintaofei/codeg#547](https://github.com/xintaofei/codeg/issues/547).
- **Les mises à jour viennent de ce dépôt.** Les versions sont signées avec la clé de mise à jour propre à ce fork : cette version ne se met donc jamais à jour vers une version officielle, et une version officielle jamais vers celle-ci.
- **L'application macOS n'est pas notarisée** : macOS demande une confirmation à la première ouverture (voir Installation ci-dessous).
- **Il n'y a pas d'image Docker.**

## Versions et projet d'origine

La branche `keh4l` correspond à la branche `main` du projet d'origine plus les changements ci-dessus. Le projet d'origine y est fusionné régulièrement, ses nouveautés arrivent donc aussi ici. Les versions s'écrivent `<version d'origine>-<n>` : `0.32.4-1` est la première version basée sur la 0.32.4 d'origine.

## Installation

**Bureau** — téléchargez le dernier installateur depuis [Releases](https://github.com/keh4l/codeg/releases/latest) : `.dmg` pour macOS (Apple Silicon ou Intel), `-setup.exe` pour Windows (x64 ou ARM64), `.deb`, `.rpm` ou `.AppImage` pour Linux.

Elle s'installe comme la même application que le Codeg officiel : elle le remplace et conserve vos conversations et réglages.

Sur macOS, si le premier lancement indique que l'application est endommagée ou ne peut pas être ouverte, exécutez une fois :

```bash
xattr -cr /Applications/codeg.app
```

ou autorisez-la dans Réglages Système → Confidentialité et sécurité.

**Serveur** — sous Linux ou macOS :

```bash
curl -fsSL https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.sh | bash
CODEG_STATIC_DIR=/usr/local/share/codeg/web codeg-server
```

Sous Windows, dans PowerShell :

```powershell
irm https://raw.githubusercontent.com/keh4l/codeg/keh4l/install.ps1 | iex
$env:CODEG_STATIC_DIR="$env:LOCALAPPDATA\codeg\web"; codeg-server
```

Les deux installent depuis les versions de ce dépôt, et l'outil de mise à jour intégré du serveur les utilise aussi.

**Revenir à la version officielle** — sauvegardez d'abord vos données Codeg. Cette version ajoute une migration de base de données pour Kiro, et une version officielle qui ne l'a pas peut refuser de démarrer avec les mêmes données.

## Documentation

Pour les fonctionnalités, la configuration et l'utilisation, consultez le [README](https://github.com/xintaofei/codeg/blob/main/docs/readme/README.fr.md) officiel et [docs.codeg.app](https://docs.codeg.app). Ils décrivent la version officielle ; les différences sont listées ci-dessus.

## Licence et remerciements

Apache-2.0, voir [LICENSE](../../LICENSE). Codeg est créé par [xintaofei](https://github.com/xintaofei) et ses contributeurs ; cette version ne fait qu'y ajouter. Codeg s'appuie sur [Agent Client Protocol](https://agentclientprotocol.com), [Superpowers](https://github.com/obra/superpowers), [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) et [scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills).
