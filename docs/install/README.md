# Install ShopMe

ShopMe is one Node.js process plus PostgreSQL. For local use PostgreSQL is optional: an embedded database is used.

**New server and a domain name? [Install on a server in one command](quick-install.md)**: HTTPS, backups, updates and checks included, no guide to read.

Several stores on one installation? That is the default on a server (Docker Compose, the one-command installer): the admin is at `/admin` of your domain, the first store is served on that same domain and further stores on `<handle>.<your domain>`, with one wildcard DNS record. Set `MULTI_STORE=false` in `.env` to keep a single store. See [Multi-store mode](multi-store.md).

Not technical? Use the [desktop app](desktop.md) (Windows, macOS, Linux): one download, no setup. / [Application de bureau](desktop.fr.md).

## 1. Run locally (no database needed)

Requirements: Node.js 22 and pnpm 9 (`corepack enable`).

```bash
git clone https://github.com/aymaneprojects/shopme.git
cd shopme
pnpm install
pnpm dev
```

Open <http://localhost:3000/admin>. The setup wizard creates your store and owner account.
Data lives in `./data` (embedded PostgreSQL under `data/pglite`, uploads under `data/uploads`).

- Demo content (a fictional coffee and tea shop): stop the server, run `pnpm seed`, start again. The seed prints a random
  owner password when it creates the shop.
- Settings: copy `.env.example` to `.env` (all optional). Use `DATABASE_URL=postgres://...` to run on your own PostgreSQL.
- Production-style run: `pnpm build && pnpm start`.

## 2. Docker Compose (app + PostgreSQL)

```bash
docker compose up -d --build
```

Open <http://localhost:3000/admin>. Compose starts `shopme` and `postgres:17` with named volumes (`pgdata`, `shopme-data`)
and health checks; migrations run when the app starts. Configure through a `.env` file next to `docker-compose.yml`:

| Variable | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Change from the default (`shopme`) for any public server. |
| `APP_URL` | Public URL, e.g. `https://shop.example.com`. |
| `SESSION_SECRET` | Optional; generated and stored in the data volume when empty. |
| `SMTP_URL` | Optional installation-wide SMTP relay. Without it, stores send directly from the server (see [Sending e-mail](email.md)). |
| `PUBLIC_IP` | Optional public IP of the server for the e-mail DNS records, when it cannot be detected. |
| `BACKUP_ALLOW_PRIVATE_ENDPOINTS` | Optional; `true` lets the off-site backup bucket be on a private address (a local MinIO). |
| `PG_DUMP_PATH` | Optional `pg_dump` binary for the database dump of off-site backups. |
| `STRIPE_*` | Stripe keys (when checkout is available). |

Order, shipping and password e-mails need three DNS lines at your domain provider to reach the inbox: Settings > E-mails shows them. See [Sending e-mail](email.md).

Backups that survive the loss of the server: Settings > Backup can send every scheduled backup, encrypted if you wish, to an S3-compatible bucket (Backblaze B2, Scaleway, OVHcloud, Wasabi, Cloudflare R2, Amazon S3, MinIO). See [Off-site backups](backups.md).

A local mail catcher is available with `docker compose --profile dev up -d` (set `SMTP_URL=smtp://mailpit:1025`, UI on port 8025).

## 3. Deploy on a VPS with a domain and HTTPS

1. Point a DNS record (`shop.example.com`) at your server; open ports 80 and 443 (and nothing else publicly).
2. Install Docker, copy the repository (or just `docker-compose.yml`, `Dockerfile` and sources) to the server.
3. Create `.env`:
   ```
   APP_URL=https://shop.example.com
   POSTGRES_PASSWORD=<long random value>
   SESSION_SECRET=<at least 32 random characters>
   TRUST_PROXY=true
   ```
4. Add Caddy to the stack. Use [`Caddyfile`](Caddyfile) and a `caddy` service in a `docker-compose.override.yml`:
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
5. `docker compose up -d --build`. Caddy obtains the certificate automatically. Open `https://shop.example.com/admin`
   and complete the setup wizard right away (the first visitor creates the owner account).

## 4. Backups

Back up both the database and the uploads volume.

```bash
# database (custom format, restorable with pg_restore)
docker compose exec -T db pg_dump -U shopme -Fc shopme > shopme-$(date +%F).dump

# uploads and generated secret (volume shopme-data)
docker run --rm -v shopme_shopme-data:/data -v "$PWD":/backup alpine tar czf /backup/shopme-data-$(date +%F).tgz -C /data .
```

Restore: start the stack, then
`docker compose exec -T db pg_restore -U shopme -d shopme --clean --if-exists < shopme-YYYY-MM-DD.dump`
and unpack the tarball into the volume. Keep copies off the server and test a restore now and then.
Embedded (local) mode: stop the server and copy the `data/` directory.

## 5. Upgrades

```bash
git pull
docker compose up -d --build
```

Database migrations are applied automatically at startup. Take a backup first. To roll back, restore the backup and
check out the previous version.

An upgrade may bring a newer version of the default theme, Aurora. Your live theme is not changed: Online Store > Themes
shows "Update available" on it, and "Update theme" creates a new unpublished copy at the new version with your settings,
templates, header and footer, edited texts and uploaded files. Files you changed in the code editor are listed so you can
make those changes again; publish the copy when you are ready.
