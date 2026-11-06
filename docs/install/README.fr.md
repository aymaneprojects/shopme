# Installer ShopMe

ShopMe est un processus Node.js plus PostgreSQL. En local, PostgreSQL est facultatif : une base embarquée est utilisée.

Plusieurs boutiques sur une même installation ? Voir [Mode multi-boutique](multi-store.fr.md).

## 1. Lancer en local (sans base de données)

Prérequis : Node.js 22 et pnpm 9 (`corepack enable`).

```bash
git clone https://github.com/aymaneprojects/shopme.git
cd shopme
pnpm install
pnpm dev
```

Ouvrez <http://localhost:3000/admin>. L'assistant de configuration crée votre boutique et le compte propriétaire.
Les données sont dans `./data` (base PostgreSQL embarquée dans `data/pglite`, fichiers envoyés dans `data/uploads`).

- Contenu de démonstration (une boutique fictive de café et de thé) : arrêtez le serveur, lancez `pnpm seed`, redémarrez.
  Le script affiche un mot de passe aléatoire pour le propriétaire s'il crée la boutique.
- Réglages : copiez `.env.example` vers `.env` (tout est facultatif). Avec `DATABASE_URL=postgres://...`, ShopMe utilise
  votre propre PostgreSQL.
- Lancement de type production : `pnpm build && pnpm start`.

## 2. Docker Compose (application + PostgreSQL)

```bash
docker compose up -d --build
```

Ouvrez <http://localhost:3000/admin>. Compose démarre `shopme` et `postgres:17` avec des volumes nommés (`pgdata`,
`shopme-data`) et des contrôles de santé ; les migrations s'exécutent au démarrage de l'application. Configurez via un
fichier `.env` placé à côté de `docker-compose.yml` :

| Variable | Rôle |
| --- | --- |
| `POSTGRES_PASSWORD` | À changer (défaut : `shopme`) pour tout serveur public. |
| `APP_URL` | URL publique, par ex. `https://boutique.exemple.fr`. |
| `SESSION_SECRET` | Facultatif ; généré et conservé dans le volume de données s'il est vide. |
| `SMTP_URL` | Envoi d'e-mails. Sans lui, les e-mails sont écrits dans les journaux. |
| `STRIPE_*` | Clés Stripe (quand le paiement sera disponible). |

Un récepteur d'e-mails local est disponible avec `docker compose --profile dev up -d` (`SMTP_URL=smtp://mailpit:1025`,
interface sur le port 8025).

## 3. Déployer sur un VPS avec un nom de domaine et HTTPS

1. Faites pointer un enregistrement DNS (`boutique.exemple.fr`) vers votre serveur ; ouvrez les ports 80 et 443
   (et rien d'autre publiquement).
2. Installez Docker et copiez le dépôt sur le serveur.
3. Créez `.env` :
   ```
   APP_URL=https://boutique.exemple.fr
   POSTGRES_PASSWORD=<longue valeur aléatoire>
   SESSION_SECRET=<au moins 32 caractères aléatoires>
   TRUST_PROXY=true
   ```
4. Ajoutez Caddy à la pile. Utilisez le fichier [`Caddyfile`](Caddyfile) (en remplaçant le domaine) et un service `caddy`
   dans un `docker-compose.override.yml` :
   ```yaml
   services:
     caddy:
       image: caddy:2
       restart: unless-stopped
       ports: ["80:80", "443:443"]
       volumes:
         - ./docs/install/Caddyfile:/etc/caddy/Caddyfile:ro
         - caddy-data:/data
       depends_on: [shopme]
     shopme:
       ports: !reset []
   volumes:
     caddy-data:
   ```
5. `docker compose up -d --build`. Caddy obtient le certificat automatiquement. Ouvrez `https://boutique.exemple.fr/admin`
   et terminez l'assistant tout de suite (le premier visiteur crée le compte propriétaire).

## 4. Sauvegardes

Sauvegardez la base de données et le volume des fichiers envoyés.

```bash
# base de données (format custom, restaurable avec pg_restore)
docker compose exec -T db pg_dump -U shopme -Fc shopme > shopme-$(date +%F).dump

# fichiers envoyés et secret généré (volume shopme-data)
docker run --rm -v shopme_shopme-data:/data -v "$PWD":/backup alpine tar czf /backup/shopme-data-$(date +%F).tgz -C /data .
```

Restauration : démarrez la pile, puis
`docker compose exec -T db pg_restore -U shopme -d shopme --clean --if-exists < shopme-AAAA-MM-JJ.dump`
et décompressez l'archive dans le volume. Conservez des copies hors du serveur et testez une restauration de temps en temps.
Mode embarqué (local) : arrêtez le serveur et copiez le dossier `data/`.

## 5. Mises à jour

```bash
git pull
docker compose up -d --build
```

Les migrations de base de données s'appliquent automatiquement au démarrage. Faites d'abord une sauvegarde. Pour revenir
en arrière, restaurez la sauvegarde et revenez à la version précédente.

Une mise à jour peut apporter une nouvelle version du thème par défaut, Aurora. Votre thème en ligne n'est pas modifié :
Boutique en ligne > Thèmes affiche « Mise à jour disponible » sur celui-ci, et « Mettre à jour le thème » crée une copie non
publiée à la nouvelle version, avec vos réglages, vos modèles, l'en-tête et le pied de page, vos textes modifiés et vos
fichiers importés. Les fichiers que vous avez modifiés dans l'éditeur de code sont listés pour que vous puissiez refaire ces
modifications ; publiez la copie quand vous êtes prêt.
