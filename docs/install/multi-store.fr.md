# Mode multi-boutique

Une seule installation de ShopMe peut héberger plusieurs boutiques. Une personne se connecte une fois avec son compte et
travaille dans chaque boutique où elle fait partie de l'équipe, avec le rôle et les autorisations propres à chacune.
Chaque boutique garde son catalogue, ses commandes, ses clients, son thème, ses fichiers, ses réglages, son compte de
paiement et ses sauvegardes, et répond sur sa propre adresse.

[English version](multi-store.md)

Le mode multi-boutique est désactivé par défaut. Sans lui, ShopMe gère une boutique par installation, exactement comme
le décrit le [guide d'installation](README.fr.md). L'application de bureau gère toujours une seule boutique.

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

## Activer le mode

Ajoutez au fichier `.env` (ou à l'`environment` du service Compose) :

```
MULTI_STORE=true
APP_URL=https://admin.exemple.fr
STORE_BASE_DOMAIN=boutiques.exemple.fr
# Facultatif : ADMIN_HOST=admin.exemple.fr (par défaut, l'hôte d'APP_URL)
TRUST_PROXY=true
```

Redémarrez. Sur une nouvelle installation, l'assistant crée le premier compte (le propriétaire de la plateforme) et sa
première boutique. Les boutiques suivantes se créent depuis « Créer une boutique » dans le menu du compte : nom
(l'identifiant et l'adresse s'affichent au fur et à mesure), pays, devise et langue. La nouvelle boutique reçoit le thème
Aurora et les menus de départ, et la personne qui la crée en devient propriétaire. Les autres personnes obtiennent un
compte quand le propriétaire d'une boutique les invite (Paramètres > Utilisateurs) ; une personne invitée qui a déjà un
compte le rejoint en saisissant son mot de passe.

### Une installation existante à boutique unique

Définissez les variables ci-dessus et redémarrez : la boutique devient la première boutique de l'installation, et son
propriétaire le propriétaire de la plateforme. Chaque membre de l'équipe a déjà un compte (la migration
`0028_multi_store` en a créé un par membre ayant un mot de passe) ; les membres de boutiques différentes ne sont jamais
fusionnés, sauf si la personne prouve le mot de passe de chaque compte à la connexion. La boutique garde ses fichiers à
leur place et ses sauvegardes dans `DATA_DIR/backups`. Deux points demandent de l'attention :

- L'adresse d'administration ne doit pas être l'une des adresses de la boutique. Si la boutique était servie sur
  `APP_URL` (par exemple `boutique.exemple.fr`), déplacez l'administration sur une autre adresse
  (`APP_URL=https://admin.exemple.fr`) et gardez `boutique.exemple.fr` comme domaine de la boutique : il reste son
  domaine principal.
- Les liens des e-mails envoyés avant le changement pointent toujours vers les anciennes adresses, qui servent toujours
  la boutique.

Revenir au mode à boutique unique n'est prévu que pour une installation qui ne compte qu'une boutique : dans ce mode,
la vitrine ne sert que la plus ancienne.

## DNS

| Enregistrement | Cible | Rôle |
| --- | --- | --- |
| `admin.exemple.fr` A/AAAA | le serveur | l'administration et les webhooks Stripe |
| `*.boutiques.exemple.fr` A/AAAA (générique) | le serveur | l'adresse permanente de chaque boutique |
| `boutique.marque.fr` CNAME | `<identifiant>.boutiques.exemple.fr` | le domaine propre d'une boutique (ou A/AAAA vers le serveur pour un domaine racine) |
| `_shopme-verify.boutique.marque.fr` TXT | `shopme-verify=<jeton>` | prouve que la boutique contrôle le domaine (Paramètres > Domaines affiche la valeur) |

Un domaine ne sert une boutique qu'une fois vérifié, et une adresse appartient au plus à une boutique. Les adresses sous
`STORE_BASE_DOMAIN` et l'adresse d'administration ne peuvent pas être ajoutées comme domaines propres.

En local, rien à faire : avec la valeur par défaut `STORE_BASE_DOMAIN=localhost`, les boutiques répondent sur
`http://<identifiant>.localhost:3000` (les navigateurs dirigent `*.localhost` vers la machine elle-même) et
l'administration sur `http://localhost:3000/admin`.

## HTTPS avec Caddy (certificats à la demande)

Les adresses des boutiques apparaissent au fil des créations de boutiques et de domaines : les certificats sont donc
émis à la demande. Pour qu'un inconnu ne puisse pas faire demander un certificat pour n'importe quel nom, Caddy
interroge d'abord ShopMe : `GET /__shopme/tls-ask?domain=<adresse>` répond 200 uniquement pour l'adresse
d'administration, les adresses permanentes des boutiques et les domaines vérifiés, et 404 sinon.

Utilisez [`Caddyfile.multistore`](Caddyfile.multistore) :

```
{
	on_demand_tls {
		ask http://shopme:3000/__shopme/tls-ask
	}
}

admin.exemple.fr {
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

Let's Encrypt limite le nombre de certificats par domaine enregistré (actuellement 50 par semaine pour `exemple.fr` et
ses sous-domaines). Avec beaucoup de boutiques sous un même domaine de base, utilisez plutôt un certificat générique pour
`*.boutiques.exemple.fr` (validation DNS, qui demande une version de Caddy avec le module de votre fournisseur DNS) et
gardez les certificats à la demande pour les domaines propres.

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
- E-mails : les boutiques partagent le compte SMTP (`SMTP_URL`). Les messages partent de `MAIL_FROM` avec le nom
  d'expéditeur de la boutique (Paramètres > Notifications) comme nom affiché, et les réponses arrivent à l'adresse de la
  boutique : aucune boutique ne peut envoyer au nom d'un domaine que l'installation ne contrôle pas.

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
