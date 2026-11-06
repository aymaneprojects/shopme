# Install on a server in one command

[Français](quick-install.fr.md)

You need a fresh Debian or Ubuntu server (x86_64 or arm64) that you can reach as root, and a domain name whose DNS you can edit.
No Docker, nginx or database knowledge is needed.

## Install

1. At your domain provider, create an **A record** (and an AAAA record if your server has an IPv6 address) for the shop's name, for example
   `boutique.fr`, pointing to the server's public IP address, and **one more A record**, `*.boutique.fr`, to the same address (every extra
   store then answers on `<handle>.boutique.fr`). With `--single-store` the second record is not needed.
2. On the server, download the script and run it:

```bash
curl -fsSLO https://raw.githubusercontent.com/aymaneprojects/shopme/main/shopme-install.sh
sudo bash shopme-install.sh install --domain shop.example.com --email you@example.com --bundle <path-or-https-url-of-the-bundle>
```

Read the script before you run it if you like: it is one file. Leave out a flag and it asks a simple question instead.

3. When it ends it prints the admin address. **Open it right away and finish the setup wizard**: the first visitor creates the
   owner account. Then open **Settings > E-mails** and add the 3 DNS lines shown there (SPF, DKIM, DMARC) so your order and
   password e-mails reach the inbox. See [Sending e-mail](email.md).

Without `--bundle` and `--version`, the script builds ShopMe from the source checkout it sits in, which needs 3 GB of free RAM
(see [Small servers](#small-servers)). Prefer a bundle (`shopme-server-<version>.tar.gz`) on a small server.

## What `install` does

1. Checks the system (Debian or Ubuntu, x86_64 or arm64, root) and that your domain's A/AAAA record points to this server. If it does not, it
   waits and asks again (or goes on with `--force`).
2. Installs Docker with Docker's official installer, after asking (`--yes` answers for you).
3. Looks at ports 80 and 443:
   - **nginx is running**: it adds one site file for your domain, runs `nginx -t`, reloads nginx and gets a certificate with
     `certbot --nginx`. Your other sites are never touched and nginx is never stopped. If another site already uses the same name, or
     the file is not ours, it stops before changing anything.
   - **nothing is running**: it adds Caddy to the stack, with automatic HTTPS.
   - **another web server** (Apache and others): it stops with an explanation. `--no-proxy` installs the app on `127.0.0.1:3200` only so
     you can point your own proxy to it.
4. Creates `/opt/shopme` with a `.env` (secrets generated on the spot, mode 600, never shown), a compose file, the app and the data folder.
5. Starts PostgreSQL and ShopMe with memory limits, and waits until `/healthz` answers.
6. Sets up backups: a database dump every night at 03:30 kept 14 days, and an archive of the uploaded files every Sunday, in
   `/opt/shopme/backups`. The script copies itself to `/usr/local/sbin/shopme-install.sh` for this.

Running it again is safe: secrets, data and existing certificates are kept.

## Everyday commands

```bash
sudo shopme-install.sh doctor                 # full check
sudo shopme-install.sh status                 # short check
sudo shopme-install.sh update --version 1.2.0 # or --bundle <file|url>
sudo shopme-install.sh backup
sudo shopme-install.sh restore /opt/shopme/backups/db-20260101-033000.sql.gz
sudo shopme-install.sh uninstall              # keeps data; add --purge to delete everything
```

- **`update`** backs up first, replaces the app, restarts only the ShopMe container and waits for `/healthz`. If it does not
  become healthy, the previous version is put back automatically. (If the new version had already changed the database, restore the
  backup it names.)
- **`status` / `doctor`** show OK, WARN or FAIL with the fix in plain words: containers and health, disk, memory and swap,
  certificate expiry, DNS of the domain, outgoing port 25, reverse DNS (PTR), public IP, nginx configuration test, last backup.
  `--json` prints the same as JSON; the exit code is 1 when something fails, which suits a monitoring job.
- **`restore`** takes a database dump (`db-*.sql.gz`) or a files archive (`uploads-*.tar.gz`) and takes a safety backup first.

## Several stores (multi-store) is the default

A server installed for `boutique.fr` runs in multi-store mode without any extra option:

```bash
sudo bash shopme-install.sh install --domain boutique.fr --email you@example.com --bundle <file|url>
```

- The admin is at `https://boutique.fr/admin`, and the **first store's storefront is served on `boutique.fr` itself** (the setup wizard records
  it as that store's verified primary domain). Every further store answers on `https://<handle>.boutique.fr`.
- `.env` gets `MULTI_STORE=true`, `STORE_BASE_DOMAIN=boutique.fr` and `ADMIN_HOST=boutique.fr`. The install also asks for the `*.boutique.fr` A record
  and checks it (`doctor` checks it again later).
- **With Caddy** nothing more is needed: certificates are issued on demand, only for hosts ShopMe confirms it serves (the `/__shopme/tls-ask`
  endpoint).
- **With nginx** no DNS API key is needed either. The installer adds `shopme-install.sh sync-certs`, run every minute by a systemd timer (cron
  without systemd). It reads the hosts the app serves from a local-only endpoint (`/__shopme/hosts`, protected by `HOSTS_TOKEN` in `.env`) and runs
  `certbot --nginx -d <host>` for each new one, then reloads nginx. It uses a lock, backs off after a failure or a Let's Encrypt rate limit, and
  logs to `/var/log/shopme/sync-certs.log`. A new store has HTTPS within a minute or two.
  - Prefer one wildcard certificate? `--dns-provider cloudflare|ovh|gandi|digitalocean|route53` with `--dns-credentials <file>`: the file holds your API
    credentials in the format certbot's plugin expects (for Cloudflare: `dns_cloudflare_api_token = ...`; for Route 53 an AWS credentials file). The
    script copies it to a root-only file under `/etc/shopme` (mode 600) and never prints it. Renewal is automatic.
  - `--manual-dns`: certbot shows the TXT record to create, step by step. A manual certificate cannot renew itself: every 60 days run
    `sudo shopme-install.sh renew`. `doctor` warns when the date approaches.
- **A store's own domain** (for example `shop.brand.com`): add and verify it in Settings > Domains and point its A record to the server. The
  certificate follows by itself (`sync-certs` with nginx, on demand with Caddy). With a wildcard certificate run `sudo shopme-install.sh add-domain shop.brand.com`.
- **Only one store?** Install with `--single-store`, or set `MULTI_STORE=false` in `/opt/shopme/.env` and restart. An installation made before multi-store
  became the default stays as it is. More in [Multi-store mode](multi-store.md).

## Small servers

- Memory limits are set for ShopMe (768 MB) and PostgreSQL (512 MB).
- With no swap, the script offers to add 2 GB (`--add-swap` says yes in advance). It never adds swap without your agreement.
- It never builds on the server below 3 GB of free RAM and says so. Swap does not help a build. Use `--bundle` instead.

## Flags

| Flag | Meaning |
| --- | --- |
| `--domain <host>` | Public host name of the shop: the admin, the first store and the base of the other stores' hosts. |
| `--email <address>` | Contact address for the certificate authority. |
| `--multi-store <base>` | Stores on subdomains of `<base>` instead of `<host>` (multi-store is already the default). |
| `--single-store` | One store only: `MULTI_STORE=false`, no wildcard record. |
| `--bundle <path or https URL>` | A prebuilt `shopme-server-<version>.tar.gz`. |
| `--version <x.y.z>` | Download that release's bundle (see below). |
| `--sha256 <hex>` | Expected checksum of the bundle. Downloads from a release are checked against the published `.sha256` file. |
| `--source <dir>` | Source checkout to build from. |
| `--dir <path>` | Installation folder, default `/opt/shopme`. |
| `--port <n>` | Loopback port of the app, default 3200. |
| `--dns-provider`, `--dns-credentials`, `--manual-dns` | One wildcard certificate with nginx (optional: the default needs no DNS key). |
| `--no-proxy` | No HTTPS set up; the app listens on `127.0.0.1` only. |
| `--add-swap` | Add 2 GB of swap if there is none. |
| `--force` | Go on despite a DNS mismatch or an existing nginx name. |
| `-y`, `--yes` | Answer yes to every question. |
| `--json` | `status` / `doctor`: JSON output. |
| `--purge` | `uninstall`: also delete data, backups and volumes. |
| `--db-only`, `--uploads-only`, `--quiet` | `backup`: only one part, less output. |

### Where `--version` downloads from

The URL comes from the variable `SHOPME_BUNDLE_URL_TEMPLATE`, where `{version}` and `{arch}` (`x64` or `arm64`) are replaced:

```
https://github.com/aymaneprojects/shopme/releases/download/v{version}/shopme-server-{version}-{arch}.tar.gz
```

Set the variable to use a mirror or your own release host: `SHOPME_BUNDLE_URL_TEMPLATE=https://files.example.com/{version}/shopme-{arch}.tar.gz sudo -E bash shopme-install.sh update --version 1.2.0`.
Only `https://` addresses are accepted.

Other variables: `SHOPME_MIN_BUILD_RAM_MB` (default 3072), `SHOPME_BACKUP_KEEP_DAYS` (default 14), `SHOPME_DRY_RUN=1` (prints every
command and file instead of running it: a safe way to see what `install` would do).

## Troubleshooting

Start with `sudo shopme-install.sh doctor`: each line names its fix.

- **"DNS ... points to ..."**: the A/AAAA record is missing or points elsewhere. Fix it at your domain provider (remove an AAAA record that is
  not this server) and press Enter to check again, or use `--force`.
- **Certificate error from certbot or Caddy**: ports 80 and 443 must be reachable from the Internet (check the provider's firewall, and `ufw`:
  `ufw allow 80,443/tcp`), and DNS must already point to the server.
- **"Building from source needs about 3 GB of free RAM"**: use a bundle (`--bundle`), or a bigger server for the build.
- **"Another web server ... already uses port 80/443"**: use nginx, or `--no-proxy` and point your proxy to `127.0.0.1:3200`.
- **`nginx -t` fails**: nothing was reloaded. Fix the message it prints; our file is `sites-available/shopme.conf` (or `conf.d/shopme.conf`).
- **The app does not become healthy**: `docker compose -f /opt/shopme/docker-compose.yml logs --tail 50 shopme`.
- **E-mail**: `doctor` shows whether outgoing port 25 is open and whether reverse DNS is set. If port 25 is blocked, ask your host to open it or use an
  SMTP relay (Settings > E-mails > Advanced options).
- **Start over**: `sudo shopme-install.sh uninstall --purge` removes everything including data.

## Limits

Debian and Ubuntu only (other systems: [Docker Compose guide](README.md)). The Gandi DNS plugin is installed with pip, the others with apt.
The `*.<domain>` A record must be created by you at your DNS provider; the script checks it but cannot create it.
