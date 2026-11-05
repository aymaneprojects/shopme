# Application de bureau ShopMe (Windows, macOS, Linux)

Faites tourner votre boutique sur votre ordinateur : on télécharge, on double-clique, c'est prêt. Pas de terminal, pas de base
de données à installer.

## 1. Télécharger

Ouvrez la [page des Releases](https://github.com/aymaneprojects/shoppen/releases/latest) et téléchargez le fichier adapté à
votre système :

| Système | Fichier |
| --- | --- |
| Windows 10/11 (64 bits) | `ShopMe-<version>-win-x64.exe` |
| macOS, Apple Silicon (M1 et suivants) | `ShopMe-<version>-mac-arm64.dmg` |
| macOS, Intel | `ShopMe-<version>-mac-x64.dmg` |
| Linux (64 bits) | `ShopMe-<version>-linux-x86_64.AppImage` (rendez-le exécutable, puis lancez-le) |

## 2. Installation et premier lancement

Les applications ne sont **pas encore signées**, votre système affichera donc un avertissement la première fois. C'est normal.

**Windows.** Lancez l'installateur. Si une fenêtre bleue « Windows a protégé votre ordinateur » (SmartScreen) apparaît, cliquez
sur **Informations complémentaires**, puis **Exécuter quand même**. ShopMe s'installe pour votre utilisateur seulement (aucun
droit administrateur requis).

**macOS.** Ouvrez le `.dmg` et glissez ShopMe dans Applications. La première fois, ne double-cliquez pas : **clic droit (ou
Contrôle-clic) sur ShopMe, choisissez Ouvrir, puis Ouvrir** à nouveau. Si macOS ne propose que « Placer dans la corbeille »,
allez dans **Réglages Système, Confidentialité et sécurité**, descendez et cliquez sur **Ouvrir quand même** à côté du message
concernant ShopMe. Si macOS indique que l'app est « endommagée », exécutez une fois
`xattr -cr /Applications/ShopMe.app` dans le Terminal.

**Linux.** `chmod +x ShopMe-*.AppImage && ./ShopMe-*.AppImage`.

Une petite fenêtre affiche « Starting your store… », puis l'administration s'ouvre. L'assistant de configuration crée votre
boutique et votre compte propriétaire.

## 3. Utiliser l'application

Le menu **ShopMe** contient :

- **Open admin** : la fenêtre d'administration (la rouvre si vous l'avez fermée).
- **Open storefront** : votre boutique, dans votre navigateur habituel.
- **Open data folder** : ouvre le dossier où tout est stocké.
- **Export my store…** / **Import a store…** : enregistre toute la boutique dans un fichier `.shopme` et recharge-la sur un serveur (ou un autre ordinateur).
- **Quit** : quitter.

Fermer la fenêtre d'administration quitte ShopMe et arrête la boutique.

## 4. Où sont vos données

Tout (base de données, images envoyées, secrets) se trouve dans un seul dossier, `data`, dans le dossier utilisateur de
l'application :

| Système | Dossier |
| --- | --- |
| Windows | `%APPDATA%\ShopMe\data` |
| macOS | `~/Library/Application Support/ShopMe/data` |
| Linux | `~/.config/ShopMe/data` |

Désinstaller l'application ne supprime pas ce dossier.

## 5. Sauvegarder

1. Quittez ShopMe (la base de données ne doit pas être en cours d'utilisation).
2. Copiez tout le dossier `data` dans un endroit sûr (disque externe, stockage en ligne).

Pour restaurer, quittez ShopMe et remettez le dossier `data` copié à sa place. Sauvegardez régulièrement : c'est votre seul
exemplaire.

## 6. Limites

- Votre boutique n'est **en ligne que lorsque l'ordinateur est allumé et que ShopMe est ouvert**, et elle n'est accessible que
  depuis cet ordinateur (`127.0.0.1`). Vos clients sur Internet ne peuvent pas la visiter.
- Pour une boutique disponible 24 h/24 avec votre propre domaine et HTTPS, installez ShopMe sur un serveur :
  voir [Installer ShopMe](README.fr.md).
- Pas encore de mise à jour automatique : téléchargez la nouvelle version depuis les Releases et installez-la par-dessus
  l'ancienne. Vos données sont conservées.

## Pour les mainteneurs : construire et signer

```bash
pnpm install && pnpm turbo run build
pnpm --filter @shopme/desktop dist        # installateur pour le système courant, dans apps/desktop/dist
pnpm --filter @shopme/desktop dist:dir    # application décompressée, vérification rapide
```

Pousser un tag `v*` lance `.github/workflows/release.yml` et joint les installateurs à une GitHub Release. Les builds ne sont
pas signés, sauf si ces secrets du dépôt existent :

| Secret | Rôle |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Certificat de signature (`.p12`/`.pfx` en base64 ou URL) et son mot de passe : Windows et macOS. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarisation macOS (nécessite aussi `CSC_LINK` avec un certificat Developer ID Application). |
