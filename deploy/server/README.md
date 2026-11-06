# ShopMe server bundle

This archive holds the prebuilt ShopMe server: `app/` (server, production dependencies, admin, themes and database
migrations), plus templates in `templates/`. It runs with the official `node:22-slim` image and its own `postgres:17`.

The easy way: `shopme-install.sh` (included) does everything below for you.

```bash
sudo ./shopme-install.sh install --bundle ./shopme-server-<version>.tar.gz --domain shop.example.com --email you@example.com
```

## By hand

1. Unpack into `/opt/shopme`: `mkdir -p /opt/shopme && tar -xzf shopme-server-<version>.tar.gz -C /opt/shopme`
   (`app/` and `templates/` appear there).
2. Copy `templates/docker-compose.yml` to `/opt/shopme/docker-compose.yml`. Create `/opt/shopme/data` owned by uid 1000.
3. Create `/opt/shopme/.env` (mode 600):
   ```
   APP_URL=https://shop.example.com
   POSTGRES_PASSWORD=<long random value>
   SESSION_SECRET=<at least 32 random characters>
   TRUST_PROXY=true
   HSTS=true
   ```
   Multi-store is on by default (`MULTI_STORE=true` in the compose template): the admin is at `/admin`, the first store is served on
   the same domain and further stores on `<handle>.shop.example.com`, which needs one extra DNS record, `*.shop.example.com`.
   For a single store add `MULTI_STORE=false`. For nginx add `HOSTS_TOKEN=<16+ random characters>` and run
   `shopme-install.sh sync-certs` every minute (the installer does this for you); with Caddy the Caddyfile already issues certificates on demand.
4. `docker compose up -d`, then check `curl http://127.0.0.1:3200/healthz`.
5. HTTPS: use `templates/nginx-site.conf` with certbot, or `templates/docker-compose.caddy.yml` with `templates/Caddyfile`.
6. Open `https://shop.example.com/admin` and finish the setup wizard right away.

To update, unpack the new `app/` over the old one and run `docker compose up -d --force-recreate shopme`.
Take a backup first (`docker compose exec -T db pg_dump -U shopme shopme | gzip > backup.sql.gz`).
