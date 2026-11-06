# Mode multi-boutique

Une seule installation de ShopMe peut héberger plusieurs boutiques. Une personne se connecte une fois avec son compte et
travaille dans chaque boutique où elle fait partie de l'équipe, avec le rôle et les autorisations propres à chacune.
Chaque boutique garde son catalogue, ses commandes, ses clients, son thème, ses fichiers, ses réglages, son compte de
paiement et ses sauvegardes, et répond sur sa propre adresse.

[English version](multi-store.md)

**Sur un serveur, le mode multi-boutique est activé par défaut**, et il est aussi simple qu'une boutique unique :
installez ShopMe pour `boutique.fr` et vous obtenez l'administration sur `https://boutique.fr/admin`, la vitrine de votre
première boutique sur `https://boutique.fr`, et chaque boutique suivante sur `https://<identifiant>.boutique.fr`. Un seul
domaine, un seul enregistrement DNS en plus (`*.boutique.fr`), et des certificats émis tout seuls.

Le mode est actif dans l'installateur, dans `docker-compose.yml` et dans l'image Docker (`MULTI_STORE` non défini vaut
`true` à ces endroits). `pnpm dev`, un simple démarrage `node` et l'application de bureau restent à boutique unique. Pour
ne garder qu'une boutique sur un serveur, mettez `MULTI_STORE=false` dans `.env` (ou installez avec `--single-store`) et
redémarrez ; le menu du compte affiche alors toujours « Créer une boutique » et explique comment réactiver le mode.

## Fonctionnement

| | |
| --- | --- |
| Administration | Une seule adresse d'administration pour toute l'installation (`ADMIN_HOST`, par défaut l'hôte d'`APP_URL`). L'URL désigne la boutique : `https://admin.exemple.fr/admin/store/<identifiant>/...`, ce qui permet d'ouvrir plusieurs boutiques dans des onglets. |
| Vitrines | Chaque boutique a une adresse permanente `<identifiant>.<STORE_BASE_DOMAIN>`, par exemple `maison-lumiere.boutiques.exemple.fr`. L'identifiant est tiré du nom de la boutique à sa création et ne change jamais. Une boutique peut ajouter ses propres domaines (Paramètres > Domaines), les vérifier et choisir un domaine principal : ses autres adresses redirigent vers lui. |
| Adresses inconnues | Une page neutre « boutique introuvable » (404) qui ne nomme aucune boutique. |
| Comptes | Un compte (e-mail, mot de passe, validation en deux étapes, sessions) est relié à un membre de l'équipe dans chaque boutique. La session appartient au compte, et chaque requête d'administration est vérifiée pour la boutique qu'elle désigne : un compte qui n'en fait pas partie reçoit une erreur 403. |
| Propriétaire de la plateforme | Le premier compte de l'installation. Son espace Plateforme liste toutes les boutiques, les suspend et les réactive, supprime une boutique avec toutes ses données et décide si les autres comptes peuvent créer des boutiques. |
| Menu du compte | La boutique courante, les autres boutiques du compte (pour changer), Toutes les boutiques, Créer une boutique, puis le compte : Plateforme (propriétaire), langue, thème, Centre d'aide, Se déconnecter. |

Une boutique suspendue affiche une page neutre « boutique indisponible » (503) sur ses adresses ; son administration
reste consultable, avec un bandeau, mais refuse les modifications, et les tâches de fond l'ignorent.

## Un seul domaine

Avec l'installateur (`shopme-install.sh install --domain boutique.fr`), le fichier `.env` contient :

```
APP_URL=https://boutique.fr
MULTI_STORE=true
STORE_BASE_DOMAIN=boutique.fr
ADMIN_HOST=boutique.fr
TRUST_PROXY=true
```

`STORE_BASE_DOMAIN` vaut par défaut l'hôte d'`APP_URL`, et `ADMIN_HOST` aussi : ces deux lignes peuvent donc être omises.
Quand les deux désignent le même vrai domaine, l'assistant d'installation l'enregistre automatiquement comme **domaine
principal vérifié de la première boutique** (c'est le domaine d'installation : aucun enregistrement TXT n'est demandé).
L'administration et la première boutique partagent alors la même adresse :

- les chemins sous `/admin` (et `/webhooks`) sont l'administration ; tous les autres chemins sont la vitrine de la
  première boutique ;
- l'adresse permanente `<identifiant>.boutique.fr` de cette boutique redirige vers `boutique.fr`, comme pour tout domaine
  principal ;
- les cookies sont propres à l'adresse et le contrôle d'origine compare l'adresse de la requête : l'adresse partagée
  n'exige aucun réglage ;
- les scripts du thème d'une boutique s'exécutent sur la même origine que l'administration, comme dans une installation à
  boutique unique : ne mettez dans le thème de la première boutique que du code de confiance, ou donnez-lui son propre
  domaine et déplacez l'administration avec `ADMIN_HOST`.

Pour garder l'administration sur sa propre adresse (`ADMIN_HOST=admin.boutique.fr`), définissez `STORE_BASE_DOMAIN` avec
le domaine voulu pour les boutiques ; aucun domaine principal n'est alors enregistré.

Les boutiques suivantes se créent depuis « Créer une boutique » dans le menu du compte : nom
(l'identifiant et l'adresse s'affichent au fur et à mesure), pays, devise, langue et thème de départ (l'un des thèmes
fournis, Aurora par défaut). La nouvelle boutique reçoit ce thème, publié, et les menus de départ, et la personne qui la crée en devient propriétaire. Les autres personnes obtiennent un
compte quand le propriétaire d'une boutique les invite (Paramètres > Utilisateurs) ; une personne invitée qui a déjà un
compte le rejoint en saisissant son mot de passe.

Sans l'installateur, ajoutez les lignes ci-dessus au fichier `.env` (ou à l'`environment` du service Compose) et
redémarrez. Sur une nouvelle installation, l'assistant crée le premier compte (le propriétaire de la plateforme) et sa
première boutique.

Les routes de compte et de plateforme (`/admin/api/account`, `/admin/api/platform`, connexion et déconnexion) ne répondent
que sur l'adresse d'administration, jamais sur l'adresse propre d'une boutique.

### Une installation existante à boutique unique

Définissez les variables ci-dessus et redémarrez : la boutique devient la première boutique de l'installation, et son
propriétaire le propriétaire de la plateforme. Chaque membre de l'équipe a déjà un compte (la migration
`0028_multi_store` en a créé un par membre ayant un mot de passe) ; les membres de boutiques différentes ne sont jamais
fusionnés, sauf si la personne prouve le mot de passe de chaque compte à la connexion. La boutique garde ses fichiers à
leur place et ses sauvegardes dans `DATA_DIR/backups`. Deux points demandent de l'attention :

- La boutique peut garder son adresse. Si elle était servie sur `APP_URL` (par exemple `boutique.exemple.fr`) et que vous
  ne définissez ni `STORE_BASE_DOMAIN` ni `ADMIN_HOST`, l'administration et la boutique partagent cette adresse comme
  décrit plus haut. Pour placer l'administration ailleurs, définissez `ADMIN_HOST=admin.exemple.fr` (et `APP_URL` sur
  cette adresse) : `boutique.exemple.fr` reste le domaine principal de la boutique.
- Les liens des e-mails envoyés avant le changement pointent toujours vers les anciennes adresses, qui servent toujours
  la boutique.

Revenir au mode à boutique unique n'est prévu que pour une installation qui ne compte qu'une boutique : dans ce mode,
la vitrine ne sert que la plus ancienne.

## DNS

| Enregistrement | Cible | Rôle |
| --- | --- | --- |
| `boutique.fr` A/AAAA | le serveur | l'administration, la première boutique et les webhooks Stripe |
| `*.boutique.fr` A/AAAA (générique) | le serveur | l'adresse permanente de chaque autre boutique (le seul enregistrement en plus) |
| `boutique.marque.fr` CNAME | `<identifiant>.boutique.fr` | le domaine propre d'une boutique (ou A/AAAA vers le serveur pour un domaine racine) |
| `_shopme-verify.boutique.marque.fr` TXT | `shopme-verify=<jeton>` | prouve que la boutique contrôle le domaine (Paramètres > Domaines affiche la valeur) |

L'installateur vérifie les deux premiers, et `shopme-install.sh doctor` les revérifie plus tard. Un domaine ne sert une
boutique qu'une fois vérifié, et une adresse appartient au plus à une boutique. Les adresses sous `STORE_BASE_DOMAIN` et
l'adresse d'administration ne peuvent pas être ajoutées comme domaines propres.

En local, rien à faire : avec la valeur par défaut `STORE_BASE_DOMAIN=localhost`, les boutiques répondent sur
`http://<identifiant>.localhost:3000` (les navigateurs dirigent `*.localhost` vers la machine elle-même) et
l'administration sur `http://localhost:3000/admin`.

## HTTPS

Les certificats n'exigent aucune clé d'API DNS.

- **Caddy** (le choix de l'installateur quand rien n'utilise les ports 80/443) : les certificats sont émis à la demande.
  Pour qu'un inconnu ne puisse pas faire demander un certificat pour n'importe quel nom, Caddy interroge d'abord ShopMe :
  `GET /__shopme/tls-ask?domain=<adresse>` répond 200 uniquement pour l'adresse d'administration, les adresses permanentes
  des boutiques et les domaines vérifiés, et 404 sinon.
- **nginx avec certbot** : l'installateur met en place `shopme-install.sh sync-certs`, lancé chaque minute par un timer
  systemd (ou une tâche cron sans systemd). Il demande à l'application quelles adresses elle sert (`GET /__shopme/hosts`,
  accessible depuis la machine seulement et protégé par `HOSTS_TOKEN` du fichier `.env`) et, pour chaque adresse sans
  certificat, ajoute un petit fichier de site et lance `certbot --nginx -d <adresse>` (HTTP-01), puis recharge nginx. Une
  nouvelle boutique a son certificat en une à deux minutes dès que son DNS répond. Le script prend un verrou, vérifie le
  DNS avant de demander, attend de plus en plus longtemps après un échec (5 minutes, en doublant, 6 heures après une limite
  de Let's Encrypt), demande au plus 5 certificats par passage et écrit dans `/var/log/shopme/sync-certs.log`. `doctor`
  indique si la tâche tourne et le dernier problème. Vous pouvez la lancer à la main : `sudo shopme-install.sh sync-certs`.
- **Un seul certificat générique** à la place, avec nginx : installez avec `--dns-provider <nom> --dns-credentials <fichier>`
  (Cloudflare, OVH, Gandi, DigitalOcean, Route 53) ou `--manual-dns`. `sync-certs` n'est alors pas installé ; le domaine
  propre d'une boutique reçoit son certificat avec `sudo shopme-install.sh add-domain <adresse>`.

### Caddyfile

Utilisez [`Caddyfile.multistore`](Caddyfile.multistore) (ou `deploy/server/Caddyfile`) :

```
{
	on_demand_tls {
		ask http://shopme:3000/__shopme/tls-ask
	}
}

boutique.fr {
	encode zstd gzip
	reverse_proxy shopme:3000
}

https:// {
	tls {
		on_demand
	}
	encode zstd gzip
	reverse_proxy shopme:3000
}
```

Let's Encrypt limite le nombre de certificats par domaine enregistré (actuellement 50 par semaine pour `boutique.fr` et
ses sous-domaines). Avec de nombreuses boutiques sous un même domaine de base, utilisez plutôt un certificat générique
pour `*.boutique.fr` (validation DNS : une version de Caddy avec le module de votre hébergeur DNS, ou `--dns-provider` avec
nginx) et gardez les certificats à la demande pour les domaines propres.

## Exemple Docker Compose

`docker-compose.override.yml` à côté du `docker-compose.yml` du dépôt :

```yaml
services:
  shopme:
    ports: !reset []
    environment:
      MULTI_STORE: "true"
      APP_URL: https://admin.exemple.fr
      STORE_BASE_DOMAIN: boutiques.exemple.fr
      TRUST_PROXY: "true"
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./docs/install/Caddyfile.multistore:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on: [shopme]
volumes:
  caddy-data:
```

Lancez ensuite `docker compose up -d --build`, ouvrez `https://admin.exemple.fr/admin` et terminez la configuration
aussitôt (le premier visiteur devient propriétaire de la plateforme).

## Paiements et e-mails par boutique

- Stripe : chaque boutique saisit ses propres clés et son secret de signature de webhook dans Paramètres > Paiements.
  Le point de terminaison du webhook est `https://admin.exemple.fr/webhooks/stripe/<identifiant>` ; ShopMe vérifie
  chaque événement avec le secret de cette boutique. Une boutique sans clés utilise les clés `STRIPE_*` de
  l'installation (les événements de ce compte partagé sont rattachés à la boutique à laquelle appartient le paiement).
- E-mails : chaque boutique a ses propres réglages e-mail, clés DKIM et boîte d'envoi (Réglages > E-mails) et signe avec
  son propre domaine. Tant que le domaine d'une boutique ne passe pas ses contrôles SPF et DKIM, elle envoie depuis
  `no-reply@<STORE_BASE_DOMAIN>` avec le nom de la boutique comme nom affiché et son adresse en adresse de réponse ; le
  propriétaire de la plateforme authentifie ce domaine une fois dans l'espace plateforme. Une boutique qui n'a pas choisi
  de mode utilise le `SMTP_URL` de l'installation quand il existe (les messages partent alors de `MAIL_FROM`). Voir
  [Envoi d'e-mails](email.fr.md).

## Fichiers, sauvegardes et exports

| | Emplacement |
| --- | --- |
| Fichiers envoyés | `STORAGE_DIR/shops/<id de la boutique>/...`, servis sous `/files/shops/<id>/...` uniquement sur les adresses de cette boutique (une boutique issue du mode à boutique unique garde ses fichiers à la racine de `STORAGE_DIR`). |
| Sauvegardes automatiques et exports `.shopme` | `DATA_DIR/stores/<id de la boutique>/backups` (la première boutique d'une installation convertie garde `DATA_DIR/backups`). Chaque boutique ne voit et ne télécharge que les siens. |
| Base de données | Une seule base pour toutes les boutiques. Sauvegardez-la comme indiqué dans le [guide d'installation](README.fr.md) : `pg_dump` couvre toutes les boutiques d'un coup. |

L'export `.shopme` d'une boutique ne contient que cette boutique et peut être importé dans une autre installation,
multi-boutique ou non. Supprimer une boutique (Plateforme > Supprimer la boutique, après avoir saisi son identifiant)
efface toutes ses lignes et tous ses fichiers ; les autres boutiques et les comptes ne sont pas touchés. Le propriétaire
d'une boutique peut aussi la supprimer depuis Paramètres > Général, ce qui écrit d'abord un export final.

Les tâches de fond (renouvellements et rappels d'abonnement, e-mails de paniers abandonnés, e-mails de cartes cadeaux,
sauvegardes automatiques, envoi et nouvelles tentatives des webhooks) tournent pour chaque boutique active, chacune avec
ses propres liens et son expéditeur.

## Limites

- Un seul processus serveur sert toutes les boutiques ; il n'y a pas de quotas par boutique pour le stockage, les
  requêtes ou les tâches. Dimensionnez le serveur pour les boutiques les plus actives réunies.
- Une seule base et un seul dossier de fichiers : une boutique ne peut pas être déplacée dans sa propre base (exportez-la
  en fichier `.shopme` et importez-la dans une autre installation).
- L'éditeur de thème prévisualise les thèmes sur l'adresse d'administration avec les scripts du thème désactivés, pour
  que le code d'une boutique ne s'exécute jamais là où les autres boutiques du compte sont accessibles. Les carrousels et
  les tiroirs ne s'animent pas dans l'éditeur ; la vitrine n'est pas concernée.
- Les comptes sont créés par l'assistant de configuration et par les invitations d'équipe ; il n'y a pas de page
  d'inscription publique.
- Les limites de Let's Encrypt s'appliquent aux certificats à la demande (voir plus haut).
- Utilisez un seul processus serveur : la file de tâches tourne à l'intérieur, pour toutes les boutiques. (Un second
  processus partageant la base verrait les nouvelles boutiques en moins de 30 secondes, mais exécuterait les mêmes
  tâches une seconde fois.)

## Sécurité

- Les sessions sont liées au compte et vérifiées pour la boutique de chaque requête ; les jetons d'API ne valent que pour
  leur boutique ; une requête dont l'URL désigne une boutique et dont l'adresse appartient à une autre est refusée.
- Les requêtes d'administration qui modifient des données doivent venir de l'adresse même de la requête (contrôle de
  l'en-tête Origin par adresse) ; les cookies sont liés à une seule adresse et jamais partagés avec les adresses des
  boutiques.
- Les pages de la vitrine, les paniers, les paiements, les comptes clients, les plans de site, les fichiers et les
  webhooks déterminent la boutique à partir de l'adresse, et les identifiants d'une autre boutique répondent
  « introuvable ».
- Les tentatives de connexion sont limitées par e-mail et par adresse IP, comme en mode à boutique unique ; la validation
  en deux étapes appartient au compte et couvre toutes ses boutiques.
