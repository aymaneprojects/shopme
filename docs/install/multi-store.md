# Multi-store mode

One ShopMe installation can host several stores. A person signs in once with their account and works in every store
where they are a staff member, each with its own role and permissions. Every store keeps its own catalog, orders,
customers, theme, files, settings, payment account and backups, and answers on its own host.

[Version française](multi-store.fr.md)

Multi-store mode is off by default. Without it ShopMe runs one store per installation, exactly as described in the
[install guide](README.md). The desktop app always runs one store.

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

## Turn it on

Add to `.env` (or the `environment` of the Compose service):

```
MULTI_STORE=true
APP_URL=https://admin.example.com
STORE_BASE_DOMAIN=shops.example.com
# Optional: ADMIN_HOST=admin.example.com (default: the host of APP_URL)
TRUST_PROXY=true
```

Restart. On a new installation the setup wizard creates the first account (the platform owner) and its first store.
Further stores come from "Create a store" in the account menu: name (the handle and address are previewed), country,
currency and language. The new store gets the Aurora theme and the starter menus, and its creator becomes its owner.
Other people get an account when a store owner invites them (Settings > Users); an invited person who already has an
account joins with that account by typing its password.

### An existing single-store installation

Set the variables above and restart: the store becomes the first store of the installation, its owner the platform
owner. Every staff member already has an account (migration `0028_multi_store` created one per member with a password);
members of different stores are never merged unless the person proves the password of each account at sign-in.
The store keeps its files where they are and its backups in `DATA_DIR/backups`. Two points need care:

- The admin host must not be one of the store's hosts. If the store was served on `APP_URL` (say `shop.example.com`),
  move the admin to another host (`APP_URL=https://admin.example.com`) and keep `shop.example.com` as the store's
  domain: it keeps working as its primary domain.
- Store links in e-mails sent before the switch keep pointing at the old addresses, which still serve the store.

Switching back to single-store mode is only meant for an installation that has one store: in that mode the
storefront serves the oldest store only.

## DNS

| Record | Points to | Purpose |
| --- | --- | --- |
| `admin.example.com` A/AAAA | the server | the admin and the Stripe webhooks |
| `*.shops.example.com` A/AAAA (wildcard) | the server | every store's permanent host |
| `shop.brand.com` CNAME | `<handle>.shops.example.com` | a store's own domain (or A/AAAA to the server for an apex domain) |
| `_shopme-verify.shop.brand.com` TXT | `shopme-verify=<token>` | proves the store controls the domain (Settings > Domains shows the value) |

A domain serves a store only once it is verified, and a host belongs to one store at most. Hosts under
`STORE_BASE_DOMAIN` and the admin host cannot be added as custom domains.

Locally nothing is needed: with the default `STORE_BASE_DOMAIN=localhost`, stores answer on
`http://<handle>.localhost:3000` (browsers resolve `*.localhost` to the machine itself) and the admin on
`http://localhost:3000/admin`.

## HTTPS with Caddy (on-demand certificates)

Store hosts appear when stores and domains are created, so certificates are issued on demand. To keep strangers from
making the server request certificates for any name, Caddy first asks ShopMe: `GET /__shopme/tls-ask?domain=<host>`
answers 200 only for the admin host, the stores' permanent hosts and verified custom domains, and 404 otherwise.

Use [`Caddyfile.multistore`](Caddyfile.multistore):

```
{
	on_demand_tls {
		ask http://shopme:3000/__shopme/tls-ask
	}
}

admin.example.com {
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

Let's Encrypt limits certificates per registered domain (currently 50 a week for `example.com` and its subdomains).
With many stores under one base domain, use a wildcard certificate for `*.shops.example.com` instead (DNS challenge,
which needs a Caddy build with your DNS provider's module) and keep on-demand certificates for custom domains.

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
