# Multi-store mode

One ShopMe installation can host several stores. A person signs in once with their account and works in every store
where they are a staff member, each with its own role and permissions. Every store keeps its own catalog, orders,
customers, theme, files, settings, payment account and backups, and answers on its own host.

[Version française](multi-store.fr.md)

**On a server, multi-store is the default**, and it is as simple as a single store: install ShopMe for `boutique.fr` and
you get the admin at `https://boutique.fr/admin`, your first store's storefront on `https://boutique.fr`, and every
further store on `https://<handle>.boutique.fr`. One domain, one extra DNS record (`*.boutique.fr`), and certificates
that are issued by themselves.

It is on in the installer, in `docker-compose.yml` and in the Docker image (`MULTI_STORE` unset means `true` there).
`pnpm dev`, a bare `node` start and the desktop app stay single-store. To keep one store on a server, set
`MULTI_STORE=false` in `.env` (or install with `--single-store`) and restart; the account menu then still shows "Create a
store" and explains how to turn the mode back on.

## How it works

| | |
| --- | --- |
| Admin | One admin host for the whole installation (`ADMIN_HOST`, default: the host of `APP_URL`). The URL names the store: `https://admin.example.com/admin/store/<handle>/...`, so several stores can be open in tabs. |
| Storefronts | Each store has a permanent host `<handle>.<STORE_BASE_DOMAIN>`, for example `boutique-lumiere.shops.example.com`. The handle is the slug of the store name at creation and never changes. Stores can add their own domains (Settings > Domains), verify them and pick a primary domain: the store's other hosts redirect to it. |
| Unknown hosts | A neutral "store not found" page (404) that names no store. |
| Accounts | An account (e-mail, password, two-step verification, sessions) is linked to one staff member per store. The session belongs to the account, and every admin request is checked against the store it names: an account that is not staff there gets 403. |
| Platform owner | The first account of the installation. Its Platform area lists every store, suspends and resumes stores, deletes a store with all its data, and decides whether other accounts may create stores. |
| Account menu | The current store, the account's other stores (switch), All stores, Create a store, then the account: Platform (owner), language, theme, Help center, Log out. |

A suspended store shows a neutral "store unavailable" page (503) on its hosts, its admin stays readable with a banner and
refuses changes, and the background jobs skip it.

## One domain

With the installer (`shopme-install.sh install --domain boutique.fr`) the `.env` gets:

```
APP_URL=https://boutique.fr
MULTI_STORE=true
STORE_BASE_DOMAIN=boutique.fr
ADMIN_HOST=boutique.fr
TRUST_PROXY=true
```

`STORE_BASE_DOMAIN` defaults to the host of `APP_URL`, and `ADMIN_HOST` too, so these two lines can be left out. When
both are the same real domain, the setup wizard records it automatically as the **verified primary domain of the first
store** (it is the install domain, so no TXT record is needed). The admin and the first store then share the host:

- paths under `/admin` (and `/webhooks`) are the admin; every other path is the first store's storefront;
- the first store's permanent host `<handle>.boutique.fr` redirects to `boutique.fr` like any primary domain;
- cookies are host-only and the origin check compares the request's own host, so the shared host needs no extra setting;
- a store's theme scripts run on the same origin as the admin there, as in a single-store installation: only put code
  you trust in the first store's theme, or give it its own domain and move the admin elsewhere with `ADMIN_HOST`.

To keep the admin on its own host (`ADMIN_HOST=admin.boutique.fr`) set `STORE_BASE_DOMAIN` to the domain you want for the
stores; nothing is recorded as a primary domain then.

Further stores come from "Create a store" in the account menu: name (the handle and address are previewed), country,
currency, language and starting theme (one of the bundled themes, Aurora by default). The new store gets that theme, published, and the starter menus, and its creator becomes its owner.
Other people get an account when a store owner invites them (Settings > Users); an invited person who already has an
account joins with that account by typing its password.

Setting it up by hand without the installer: add the lines above to `.env` (or the `environment` of the Compose service) and restart.
On a new installation the setup wizard creates the first account (the platform owner) and its first store.

Account and platform routes (`/admin/api/account`, `/admin/api/platform`, sign-in and sign-out) answer only on the admin
host, never on a store's own host.

### An existing single-store installation

Set the variables above and restart: the store becomes the first store of the installation, its owner the platform
owner. Every staff member already has an account (migration `0028_multi_store` created one per member with a password);
members of different stores are never merged unless the person proves the password of each account at sign-in.
The store keeps its files where they are and its backups in `DATA_DIR/backups`. Two points need care:

- The store can keep the address it had. If it was served on `APP_URL` (say `shop.example.com`) and you leave
  `STORE_BASE_DOMAIN` and `ADMIN_HOST` unset, the admin and the store share that host as described above. To put the admin
  elsewhere, set `ADMIN_HOST=admin.example.com` (and `APP_URL` to that address): `shop.example.com` stays the store's
  primary domain.
- Store links in e-mails sent before the switch keep pointing at the old addresses, which still serve the store.

Switching back to single-store mode is only meant for an installation that has one store: in that mode the
storefront serves the oldest store only.

## DNS

| Record | Points to | Purpose |
| --- | --- | --- |
| `boutique.fr` A/AAAA | the server | the admin, the first store and the Stripe webhooks |
| `*.boutique.fr` A/AAAA (wildcard) | the server | every other store's permanent host (the only extra record) |
| `shop.brand.com` CNAME | `<handle>.boutique.fr` | a store's own domain (or A/AAAA to the server for an apex domain) |
| `_shopme-verify.shop.brand.com` TXT | `shopme-verify=<token>` | proves the store controls the domain (Settings > Domains shows the value) |

The installer checks the first two and `shopme-install.sh doctor` checks them again later. A domain serves a store only
once it is verified, and a host belongs to one store at most. Hosts under `STORE_BASE_DOMAIN` and the admin host cannot
be added as custom domains.

Locally nothing is needed: with the default `STORE_BASE_DOMAIN=localhost`, stores answer on
`http://<handle>.localhost:3000` (browsers resolve `*.localhost` to the machine itself) and the admin on
`http://localhost:3000/admin`.

## HTTPS

Certificates need no DNS API key.

- **Caddy** (the installer's default when nothing uses ports 80/443): certificates are issued on demand. To keep strangers
  from making the server request certificates for any name, Caddy first asks ShopMe: `GET /__shopme/tls-ask?domain=<host>`
  answers 200 only for the admin host, the stores' permanent hosts and verified custom domains, and 404 otherwise.
- **nginx with certbot**: the installer sets up `shopme-install.sh sync-certs`, run every minute by a systemd timer (or a
  cron job without systemd). It asks the app which hosts it serves (`GET /__shopme/hosts`, reachable from the machine itself
  only and protected by `HOSTS_TOKEN` from `.env`), and for each host without a certificate it adds a small site file
  and runs `certbot --nginx -d <host>` (HTTP-01), then reloads nginx. A new store has its certificate within a minute or two
  once its DNS answers. It takes a lock, checks DNS before asking, backs off after a failure (5 minutes, doubling, 6 hours
  after a Let's Encrypt rate limit), requests at most 5 certificates per run and logs to `/var/log/shopme/sync-certs.log`.
  `doctor` shows whether the job runs and the last problem. Run it by hand any time: `sudo shopme-install.sh sync-certs`.
- **One wildcard certificate** instead, for nginx: install with `--dns-provider <name> --dns-credentials <file>`
  (Cloudflare, OVH, Gandi, DigitalOcean, Route 53) or `--manual-dns`. Then `sync-certs` is not installed, except that a
  store's own domain still gets its certificate with `sudo shopme-install.sh add-domain <host>`.

### Caddyfile

Use [`Caddyfile.multistore`](Caddyfile.multistore) (or `deploy/server/Caddyfile`):

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

Let's Encrypt limits certificates per registered domain (currently 50 a week for `boutique.fr` and its subdomains).
With many stores under one base domain, use a wildcard certificate for `*.boutique.fr` instead (DNS challenge,
which needs a Caddy build with your DNS provider's module, or `--dns-provider` with nginx) and keep on-demand certificates for custom domains.


## Docker Compose example

`docker-compose.override.yml` next to the repository's `docker-compose.yml`:

```yaml
services:
  shopme:
    ports: !reset []
    environment:
      MULTI_STORE: "true"
      APP_URL: https://admin.example.com
      STORE_BASE_DOMAIN: shops.example.com
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

Then `docker compose up -d --build`, open `https://admin.example.com/admin` and complete the setup right away (the first
visitor becomes the platform owner).

## Payments and e-mail per store

- Stripe: each store enters its own keys and webhook signing secret in Settings > Payments. The webhook endpoint is
  `https://admin.example.com/webhooks/stripe/<handle>`; ShopMe checks each event with that store's secret. A store
  without keys uses the installation's `STRIPE_*` keys (events on that shared account are matched to the store that
  owns the payment).
- E-mail: each store has its own e-mail settings, DKIM keys and outbox (Settings > E-mails) and signs with its own
  domain. Until a store's domain passes its SPF and DKIM checks, it sends from `no-reply@<STORE_BASE_DOMAIN>` with the
  store's name as display name and its address as Reply-To; the platform owner authenticates that domain once in the
  platform area. A store that has not chosen a mode uses the installation's `SMTP_URL` when there is one (messages then
  go out from `MAIL_FROM`). See [Sending e-mail](email.md).

## Files, backups and exports

| | Location |
| --- | --- |
| Uploads | `STORAGE_DIR/shops/<store id>/...`, served under `/files/shops/<store id>/...` on that store's hosts only (a store migrated from single-store mode keeps its files at the root of `STORAGE_DIR`). |
| Automatic backups and `.shopme` exports | `DATA_DIR/stores/<store id>/backups` (the first store of a migrated installation keeps `DATA_DIR/backups`). Each store lists and downloads only its own. |
| Database | One database for every store. Back it up as in the [install guide](README.md#4-backups): `pg_dump` covers all stores at once. |

A store's `.shopme` export contains that store only and can be imported into another installation, multi-store or not.
Deleting a store (Platform > Delete store, after typing its handle) removes every row and file of that store; other
stores and the accounts are untouched. Store owners can also delete their own store from Settings > General, which
writes a final export first.

Background jobs (subscription renewals and reminders, abandoned checkout e-mails, gift card e-mails, automatic backups,
webhook deliveries and retries) run for every active store, each with its own links and sender.

## Limits

- One server process serves every store; there are no per-store quotas on storage, requests or jobs. Size the server
  for the busiest stores together.
- One database and one uploads folder: a store cannot be moved to its own database (export it to a `.shopme` file and
  import it into another installation instead).
- The theme editor previews themes on the admin host with the theme's scripts turned off, so a store's code never runs
  where an account's other stores are reachable. Sliders and drawers do not animate in the editor; the storefront is
  unaffected.
- Accounts are created by the setup wizard and by staff invitations; there is no public sign-up page.
- Let's Encrypt rate limits apply to on-demand certificates (see above).
- Run one server process: the job queue runs inside it, for every store. (A second process sharing the database would
  see new stores within 30 seconds, but would run the same jobs again.)

## Security notes

- Sessions are bound to the account and checked against the store of every request; API tokens work only for their own
  store; a request whose URL names one store and whose host belongs to another is refused.
- Mutating admin requests must come from the request's own host (Origin check per host); cookies are host-only, never
  shared with store hosts.
- Storefront pages, carts, checkouts, customer accounts, sitemaps, files and webhooks resolve the store from the host,
  and ids of another store answer "not found".
- Login attempts are rate limited per e-mail and per IP address, as in single-store mode; two-step verification belongs
  to the account and covers all its stores.
