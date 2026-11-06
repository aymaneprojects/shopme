# Installer sur un serveur en une commande

[English](quick-install.md)

Il vous faut un serveur Debian ou Ubuntu neuf (x86_64 ou arm64) accessible en root, et un nom de domaine dont vous pouvez modifier le DNS.
Aucune connaissance de Docker, nginx ou des bases de données n'est nécessaire.

## Installer

1. Chez votre fournisseur de domaine, créez un **enregistrement A** (et AAAA si votre serveur a une adresse IPv6) pour le nom de la boutique, par
   exemple `boutique.exemple.fr`, vers l'adresse IP publique du serveur.
2. Sur le serveur, téléchargez le script et lancez-le :

```bash
curl -fsSLO https://raw.githubusercontent.com/aymaneprojects/shopme/main/shopme-install.sh
sudo bash shopme-install.sh install --domain boutique.exemple.fr --email vous@exemple.fr --bundle <chemin-ou-url-https-du-bundle>
```

Lisez le script avant de le lancer si vous le souhaitez : c'est un seul fichier. Si vous omettez une option, il pose une question simple.

3. À la fin, il affiche l'adresse de l'administration. **Ouvrez-la tout de suite et terminez l'assistant de configuration** : le premier
   visiteur crée le compte propriétaire. Ouvrez ensuite **Réglages > E-mails** et ajoutez les 3 lignes DNS indiquées (SPF, DKIM, DMARC)
   pour que vos e-mails de commande et de mot de passe arrivent en boîte de réception. Voir [Envoi d'e-mails](email.fr.md).

Sans `--bundle` ni `--version`, le script compile ShopMe depuis le dépôt dans lequel il se trouve, ce qui demande 3 Go de mémoire libre
(voir [Petits serveurs](#petits-serveurs)). Sur un petit serveur, préférez un bundle (`shopme-server-<version>.tar.gz`).

## Ce que fait `install`

1. Vérifie le système (Debian ou Ubuntu, x86_64 ou arm64, root) et que l'enregistrement A/AAAA de votre domaine pointe vers ce serveur. Sinon, il
   attend et redemande (ou continue avec `--force`).
2. Installe Docker avec l'installateur officiel de Docker, après confirmation (`--yes` répond pour vous).
3. Regarde les ports 80 et 443 :
   - **nginx tourne** : il ajoute un seul fichier de site pour votre domaine, lance `nginx -t`, recharge nginx et obtient un certificat avec
     `certbot --nginx`. Vos autres sites ne sont jamais modifiés et nginx n'est jamais arrêté. Si un autre site utilise déjà le même nom, ou si
     le fichier n'est pas le nôtre, il s'arrête avant de rien changer.
   - **rien ne tourne** : il ajoute Caddy à la pile, avec HTTPS automatique.
   - **un autre serveur web** (Apache, etc.) : il s'arrête en expliquant pourquoi. `--no-proxy` installe l'application sur `127.0.0.1:3200` seulement,
     pour que vous y fassiez pointer votre propre proxy.
4. Crée `/opt/shopme` avec un `.env` (secrets générés sur place, mode 600, jamais affichés), un fichier compose, l'application et le dossier de données.
5. Démarre PostgreSQL et ShopMe avec des limites de mémoire, et attend que `/healthz` réponde.
6. Met en place les sauvegardes : un dump de la base chaque nuit à 03 h 30 conservé 14 jours, et une archive des fichiers envoyés chaque dimanche, dans
   `/opt/shopme/backups`. Le script se copie dans `/usr/local/sbin/shopme-install.sh` pour cela.

Le relancer est sans risque : secrets, données et certificats existants sont conservés.

## Commandes courantes

```bash
sudo shopme-install.sh doctor                 # contrôle complet
sudo shopme-install.sh status                 # contrôle rapide
sudo shopme-install.sh update --version 1.2.0 # ou --bundle <fichier|url>
sudo shopme-install.sh backup
sudo shopme-install.sh restore /opt/shopme/backups/db-20260101-033000.sql.gz
sudo shopme-install.sh uninstall              # garde les données ; --purge supprime tout
```

- **`update`** sauvegarde d'abord, remplace l'application, redémarre seulement le conteneur ShopMe et attend `/healthz`. S'il ne devient pas sain,
  la version précédente est remise automatiquement. (Si la nouvelle version avait déjà modifié la base, restaurez la sauvegarde qu'il indique.)
- **`status` / `doctor`** affichent OK, WARN ou FAIL avec la solution en mots simples : conteneurs et santé, disque, mémoire et swap, expiration du
  certificat, DNS du domaine, port 25 sortant, DNS inverse (PTR), IP publique, test de configuration nginx, dernière sauvegarde.
  `--json` donne la même chose en JSON ; le code de sortie est 1 en cas d'échec, pratique pour une supervision.
- **`restore`** prend un dump de base (`db-*.sql.gz`) ou une archive de fichiers (`uploads-*.tar.gz`) et fait d'abord une sauvegarde de sécurité.

## Plusieurs boutiques (multi-boutique)

```bash
sudo bash shopme-install.sh install --domain admin.exemple.fr --email vous@exemple.fr \
  --multi-store boutiques.exemple.fr --bundle <fichier|url> \
  --dns-provider cloudflare --dns-credentials /root/cloudflare.ini
```

`--domain` est l'adresse de l'administration de la plateforme et `--multi-store` le domaine de base : chaque boutique répond sur
`<identifiant>.boutiques.exemple.fr`. Créez les enregistrements A pour `admin.exemple.fr` et `*.boutiques.exemple.fr`. Détails dans
[Mode multi-boutique](multi-store.fr.md).

- **Avec Caddy**, rien de plus : les certificats sont émis à la demande, seulement pour les adresses que ShopMe confirme servir (point d'accès
  `/__shopme/tls-ask`).
- **Avec nginx**, il faut un certificat générique (`*.boutiques.exemple.fr`), que seule la validation DNS peut donner :
  - `--dns-provider cloudflare|ovh|gandi|digitalocean|route53` avec `--dns-credentials <fichier>` : le fichier contient vos identifiants d'API au
    format attendu par le plugin certbot (Cloudflare : `dns_cloudflare_api_token = ...` ; pour Route 53, un fichier d'identifiants AWS). Le script
    le copie dans un fichier réservé à root sous `/etc/shopme` (mode 600) et ne l'affiche jamais. Le renouvellement est automatique.
  - `--manual-dns` : certbot affiche l'enregistrement TXT à créer, pas à pas. Un certificat manuel ne se renouvelle pas seul : tous les 60 jours,
    lancez `sudo shopme-install.sh renew`. `doctor` prévient quand la date approche.
- **Le domaine propre d'une boutique** (par exemple `boutique.marque.fr`) : ajoutez-le et vérifiez-le dans Réglages > Domaines, faites pointer son
  enregistrement A vers le serveur, puis lancez `sudo shopme-install.sh add-domain boutique.marque.fr`. Avec nginx, il obtient son propre certificat ;
  avec Caddy, c'est automatique.

## Petits serveurs

- Des limites de mémoire sont fixées pour ShopMe (768 Mo) et PostgreSQL (512 Mo).
- Sans swap, le script propose d'en ajouter 2 Go (`--add-swap` répond oui d'avance). Il n'en ajoute jamais sans votre accord.
- Il ne compile jamais sur le serveur sous 3 Go de mémoire libre, et le dit. Le swap n'aide pas pour une compilation. Utilisez `--bundle`.

## Options

| Option | Sens |
| --- | --- |
| `--domain <hôte>` | Nom d'hôte public de la boutique (l'hôte d'administration en multi-boutique). |
| `--email <adresse>` | Adresse de contact pour l'autorité de certification. |
| `--multi-store <base>` | Plusieurs boutiques sur des sous-domaines de `<base>`. |
| `--bundle <chemin ou URL https>` | Un `shopme-server-<version>.tar.gz` précompilé. |
| `--version <x.y.z>` | Télécharge le bundle de cette version (voir plus bas). |
| `--sha256 <hex>` | Somme de contrôle attendue du bundle. Les téléchargements d'une release sont vérifiés avec le fichier `.sha256` publié. |
| `--source <dossier>` | Dépôt source à compiler. |
| `--dir <chemin>` | Dossier d'installation, `/opt/shopme` par défaut. |
| `--port <n>` | Port local de l'application, 3200 par défaut. |
| `--dns-provider`, `--dns-credentials`, `--manual-dns` | Certificat générique avec nginx. |
| `--no-proxy` | Pas de HTTPS configuré ; l'application écoute sur `127.0.0.1` seulement. |
| `--add-swap` | Ajoute 2 Go de swap s'il n'y en a pas. |
| `--force` | Continue malgré un DNS incorrect ou un nom nginx déjà pris. |
| `-y`, `--yes` | Répond oui à toutes les questions. |
| `--json` | `status` / `doctor` : sortie JSON. |
| `--purge` | `uninstall` : supprime aussi données, sauvegardes et volumes. |
| `--db-only`, `--uploads-only`, `--quiet` | `backup` : une seule partie, moins de messages. |

### D'où vient `--version`

L'adresse vient de la variable `SHOPME_BUNDLE_URL_TEMPLATE`, où `{version}` et `{arch}` (`x64` ou `arm64`) sont remplacés :

```
https://github.com/aymaneprojects/shopme/releases/download/v{version}/shopme-server-{version}-{arch}.tar.gz
```

Modifiez la variable pour utiliser un miroir ou votre propre hébergement : `SHOPME_BUNDLE_URL_TEMPLATE=https://fichiers.exemple.fr/{version}/shopme-{arch}.tar.gz sudo -E bash shopme-install.sh update --version 1.2.0`.
Seules les adresses `https://` sont acceptées.

Autres variables : `SHOPME_MIN_BUILD_RAM_MB` (3072 par défaut), `SHOPME_BACKUP_KEEP_DAYS` (14 par défaut), `SHOPME_DRY_RUN=1` (affiche chaque commande
et chaque fichier au lieu de les exécuter : une façon sûre de voir ce que ferait `install`).

## Dépannage

Commencez par `sudo shopme-install.sh doctor` : chaque ligne indique sa solution.

- **« DNS ... points to ... »** : l'enregistrement A/AAAA manque ou pointe ailleurs. Corrigez-le chez votre fournisseur de domaine (supprimez un
  enregistrement AAAA qui n'est pas ce serveur) puis appuyez sur Entrée pour revérifier, ou utilisez `--force`.
- **Erreur de certificat de certbot ou Caddy** : les ports 80 et 443 doivent être joignables depuis Internet (pare-feu du fournisseur, et `ufw` :
  `ufw allow 80,443/tcp`), et le DNS doit déjà pointer vers le serveur.
- **« Building from source needs about 3 GB of free RAM »** : utilisez un bundle (`--bundle`), ou un serveur plus gros pour la compilation.
- **« Another web server ... already uses port 80/443 »** : utilisez nginx, ou `--no-proxy` et faites pointer votre proxy vers `127.0.0.1:3200`.
- **`nginx -t` échoue** : rien n'a été rechargé. Corrigez le message affiché ; notre fichier est `sites-available/shopme.conf` (ou `conf.d/shopme.conf`).
- **L'application ne devient pas saine** : `docker compose -f /opt/shopme/docker-compose.yml logs --tail 50 shopme`.
- **E-mail** : `doctor` indique si le port 25 sortant est ouvert et si le DNS inverse est défini. Si le port 25 est bloqué, demandez à votre hébergeur de
  l'ouvrir ou utilisez un relais SMTP (Réglages > E-mails > Options avancées).
- **Repartir de zéro** : `sudo shopme-install.sh uninstall --purge` supprime tout, données comprises.

## Limites

Debian et Ubuntu uniquement (autres systèmes : [guide Docker Compose](README.fr.md)). Le plugin DNS Gandi s'installe avec pip, les autres avec apt.
Un DNS générique demande un fournisseur DNS que vous pouvez modifier ; le script ne peut pas le faire à votre place.
