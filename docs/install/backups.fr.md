# Sauvegardes hors site

Des sauvegardes conservées uniquement sur le serveur disparaissent avec lui (disque en panne, VPS supprimé, incident chez l'hébergeur). Réglages > Sauvegarde peut envoyer une copie de chaque sauvegarde programmée vers un espace de stockage chez le fournisseur de votre choix, chiffrée si vous le souhaitez, et restaurer depuis cet espace en quelques clics. Cette page couvre les fournisseurs, les réglages, le chiffrement, la restauration et la vérification régulière.

Langues disponibles : [English](backups.md), français.

## Ce qui est sauvegardé

- **L'archive de la boutique** (`.shopme`) : produits, commandes, clients, contenu, fichiers de thème, fichiers téléversés et réglages. Les comptes de l'équipe, les mots de passe et les réglages hors site eux-mêmes n'en font pas partie.
- **L'export de la base de données**, sur une installation à une seule boutique où l'application peut lancer `pg_dump` (voir ci-dessous) : il contient aussi les comptes de l'équipe et tout ce qui est dans PostgreSQL. Sans `pg_dump`, seule l'archive de la boutique est envoyée.

L'image Docker officielle n'inclut pas `pg_dump`. Pour obtenir les exports, construisez votre propre image `FROM` celle de ShopMe avec le client PostgreSQL 17 (`apt-get install postgresql-client-17` depuis le dépôt apt de PostgreSQL), ou indiquez avec `PG_DUMP_PATH` un exécutable que l'application peut lancer. Sa version doit être au moins celle de la base. L'export est transmis en flux (jamais gardé en mémoire) et le mot de passe de la base passe par l'environnement du processus, pas par la ligne de commande.

## Mise en place

1. Créez un bucket chez un fournisseur de stockage, et une clé d'accès limitée à ce bucket (lecture, écriture, liste et suppression).
2. Ouvrez Réglages > Sauvegarde > Sauvegarde hors site.
3. Choisissez le fournisseur (le point d'accès et le style d'adressage sont remplis ; ajustez la région), puis le bucket, un dossier facultatif, la clé d'accès et sa clé secrète.
4. Si vous le souhaitez, définissez une phrase secrète de chiffrement.
5. Cliquez sur **Tester la connexion** : ShopMe écrit un petit fichier, le relit et le supprime. Corrigez ce que le message indique, puis **Enregistrer**.

Ensuite, chaque sauvegarde locale programmée (Réglages > Sauvegarde > Sauvegardes automatiques) est envoyée juste après sa création, puis la rotation est appliquée. **Sauvegarder et envoyer maintenant** fait la même chose à la demande.

La clé secrète et la phrase secrète sont chiffrées sur le serveur et ne sont plus jamais affichées ; laisser leurs champs vides conserve les valeurs enregistrées.

### Fournisseurs

| Fournisseur | Point d'accès | Exemples de région | Remarques |
| --- | --- | --- | --- |
| Backblaze B2 | `https://s3.<région>.backblazeb2.com` | `us-west-004`, `eu-central-003` | Utilisez une clé d'application limitée au bucket. |
| Scaleway Object Storage | `https://s3.<région>.scw.cloud` | `fr-par`, `nl-ams` | |
| OVHcloud Object Storage | `https://s3.<région>.io.cloud.ovh.net` | `gra`, `rbx` | Utilisez les identifiants S3 d'un utilisateur ayant le rôle de stockage d'objets. |
| Wasabi | `https://s3.<région>.wasabisys.com` | `eu-central-1`, `us-east-1` | |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `auto` | Remplacez `<account-id>` par l'identifiant de votre compte Cloudflare. |
| Amazon S3 | `https://s3.<région>.amazonaws.com` | `eu-west-3`, `us-east-1` | |
| MinIO / autre compatible S3 | l'adresse de votre serveur | au choix | Cochez l'adressage « path-style ». |

Tout service qui parle le protocole S3 fonctionne avec l'entrée MinIO / autre.

### Coûts, en termes généraux

Les fournisseurs facturent l'espace utilisé, et parfois aussi les téléchargements (sortie de données), les requêtes ou une durée minimale de conservation. Une archive de boutique ne représente en général qu'une fraction du volume total de vos médias, et la rotation limite le nombre de copies. Avant de choisir, comparez la facturation du volume stocké, des restaurations (téléchargements) et des suppressions faites avant une durée minimale. Consultez la grille tarifaire actuelle chez le fournisseur : cette page ne donne volontairement aucun chiffre.

## Rotation

Indiquez combien de sauvegardes **quotidiennes**, **hebdomadaires** et **mensuelles** garder. Après chaque envoi réussi, ShopMe garde la sauvegarde la plus récente de chacun des N derniers jours, des N dernières semaines ISO (lundi en premier) et des N derniers mois (tout en UTC), et supprime les autres. Les jours sans sauvegarde ne comptent pas : une période calme n'efface donc jamais l'historique. La plus récente est toujours conservée. Seuls les fichiers nommés comme ceux de ShopMe (`backup-<date>.shopme`, `db-<date>.dump`, avec `.enc` s'ils sont chiffrés) sont supprimés ; tout le reste du bucket est laissé tel quel.

Par défaut : 7 quotidiennes, 4 hebdomadaires, 6 mensuelles.

## Où vont les fichiers

```
<dossier>/shop-<id de la boutique>/archives/backup-2026-11-06T03-30-00Z.shopme[.enc]
<dossier>/shop-<id de la boutique>/database/db-2026-11-06T03-30-00Z.dump[.enc]
```

Chaque boutique a son propre dossier : les boutiques d'une installation multi-boutiques peuvent partager un bucket sans se voir. Une boutique ne peut lister, télécharger ou restaurer que les fichiers de son dossier.

## Échecs et bandeau

Chaque envoi est noté dans l'historique (heure, taille, statut, erreur). Un envoi échoué est retenté automatiquement après 5 minutes, 15 minutes, 1 heure puis 4 heures (cinq tentatives au total), même après un redémarrage du serveur. Un bandeau apparaît sur l'accueil et dans Réglages > Sauvegarde quand la dernière sauvegarde hors site a échoué, ou quand aucune sauvegarde n'est arrivée dans le bucket depuis plus de 48 heures. Un échec définitif est aussi ajouté au fil d'activité. Le bandeau disparaît après le prochain envoi réussi.

## Chiffrement

Avec une phrase secrète, chaque sauvegarde est chiffrée sur votre serveur en AES-256-GCM avant l'envoi (la clé est dérivée par scrypt, avec un sel aléatoire par fichier). Le fournisseur ne voit que des données illisibles. Les fichiers prennent l'extension `.enc`.

**Si vous perdez la phrase secrète, les sauvegardes chiffrées sont irrécupérables. Personne ne peut les ouvrir, pas même les auteurs de ShopMe.** Gardez-en une copie dans un gestionnaire de mots de passe, séparée du serveur. Changer la phrase secrète ne concerne que les nouvelles sauvegardes ; les anciens fichiers demandent toujours celle avec laquelle ils ont été faits.

Sans ShopMe (par exemple après la perte du serveur), déchiffrez un fichier avec le script autonome, qui demande seulement Node.js 18 ou plus récent :

```bash
SHOPME_BACKUP_PASSPHRASE='votre phrase secrète' \
  node scripts/decrypt-backup.mjs backup-2026-11-06T03-30-00Z.shopme.enc backup.shopme
```

Le format est décrit en tête de `packages/core/src/offsite/crypto.ts` et du script.

## Restauration

### Sur une installation qui fonctionne

Réglages > Sauvegarde > Sauvegarde hors site > **Afficher les sauvegardes** liste les fichiers du bucket, du plus récent au plus ancien, avec **Télécharger** (déchiffré) et **Restaurer**. Restaurer ouvre une confirmation qui explique ce qui se passe :

- **Remplacé :** produits, commandes, clients, contenu, fichiers de thème, fichiers et réglages.
- **Perdu :** tout ce qui a été créé ou modifié depuis la sauvegarde.
- **Inchangé :** les comptes de l'équipe et leurs mots de passe, les réglages hors site et les fichiers du bucket.

Cochez la case et confirmez : le fichier est téléchargé (et déchiffré), puis restauré par le même processus que Réglages > Sauvegarde > Importer une boutique. Exportez d'abord votre boutique en cas de doute.

### Après la perte du serveur

1. Installez ShopMe sur un nouveau serveur (voir [le guide d'installation](README.fr.md)) et créez le premier compte.
2. Ouvrez Réglages > Sauvegarde > Sauvegarde hors site, saisissez le même bucket, la même clé d'accès et, si vous en aviez une, la même phrase secrète, puis **Afficher les sauvegardes** et restaurez la plus récente.

Si vous préférez travailler avec des fichiers : téléchargez le `.shopme` (ou déchiffrez le `.enc` avec le script ci-dessus), puis utilisez Réglages > Sauvegarde > Importer une boutique.

Pour restaurer un export de base de données, utilisez l'outil de PostgreSQL sur une base vide : `pg_restore --no-owner -d shopme db-2026-11-06T03-30-00Z.dump`.

## Multi-boutiques

Chaque boutique règle sa destination, son historique et son bandeau dans ses propres Réglages > Sauvegarde. Le propriétaire de la plateforme peut aussi définir une **destination de la plateforme** dans l'espace plateforme (Plateforme > Sauvegardes) qui sauvegarde toute l'installation une fois par jour : une archive par boutique et, si `pg_dump` est disponible, la base de données. Ses fichiers sont sous `<dossier>/platform/`. Pour restaurer depuis la destination de la plateforme, téléchargez l'archive d'une boutique et importez-la dans les Réglages > Sauvegarde de cette boutique. Une destination de boutique ne reçoit jamais l'export de toute la base.

## Sécurité

- Les **points d'accès** doivent être des hôtes publics en `https://`. Les adresses privées, de bouclage et locales (y compris les adresses de métadonnées cloud) sont refusées, et revérifiées à la connexion. Un MinIO sur votre réseau local demande `BACKUP_ALLOW_PRIVATE_ENDPOINTS=true` dans l'environnement du serveur, ce qui autorise aussi `http://`.
- Les secrets ne sont jamais renvoyés par l'API, jamais écrits dans les journaux ni les messages d'erreur, et jamais inclus dans les exports `.shopme`.
- Les envois sont transmis en flux par parties de 8 Mo : le serveur ne garde jamais une archive entière en mémoire.

## Testez régulièrement votre restauration

Une sauvegarde que vous n'avez jamais restaurée n'est qu'un espoir. Une fois par mois :

1. Cliquez sur **Tester la connexion** et vérifiez que l'historique montre des entrées récentes en vert.
2. Installez ShopMe sur une machine de secours (ou en local avec Docker Compose), restaurez la dernière sauvegarde du bucket, et ouvrez la vitrine et quelques commandes.
3. Vérifiez que vous retrouvez la phrase secrète et les clés du bucket sans accès au serveur de production.

## Référence des réglages

| Variable | Rôle |
| --- | --- |
| `BACKUP_ALLOW_PRIVATE_ENDPOINTS` | `true` autorise une destination sur une adresse privée ou de bouclage (un MinIO local). Par défaut `false`. |
| `PG_DUMP_PATH` | Chemin de l'exécutable `pg_dump` utilisé pour l'export de la base. Par défaut : `pg_dump` du `PATH`, s'il y en a un. |
