# Sending e-mail

[Français](email.fr.md)

ShopMe sends order, shipping, password and subscription e-mails by itself, from your own server. You need a domain name (and access to its DNS settings) and a server; you do not need an account at an e-mail service. Open **Settings > E-mails** in the admin: it shows the 3 DNS lines to add, a **Check** button and a **Send a test e-mail** button.

There are two ways to send, and you can switch in two clicks (Settings > E-mails > Advanced options):

1. **Directly from this server** (default). ShopMe signs each message (DKIM) and hands it to the recipient's mail server, like any mail server would.
2. **Through an SMTP relay.** Any SMTP server: Brevo, Postmark, Amazon SES, Mailgun, Resend, Zoho or another one. Better for large newsletters, and the way to go when your host blocks outgoing mail.

Without any setting, a store sends directly. If the installation has an `SMTP_URL`, that account is used as long as the store has not chosen a mode itself.

## Zero configuration

On first start ShopMe:

- finds the server's public IP address (the `PUBLIC_IP` setting if you set one, otherwise a DNS-based lookup; if neither works the page asks you to type it);
- takes the sending domain from the sender address of Settings > Notifications, or, when none is set, from the store's primary domain, then from the host of `APP_URL`;
- creates the DKIM key pair for that domain (RSA 2048, selector `shopme1`, private key encrypted in the database);
- starts sending directly.

Mail sent before your DNS lines are in place is still tried, but receiving servers are likely to treat it as suspicious. That is why the page asks you to add three lines.

## The 3 DNS lines

Sign in at the company where you bought the domain name, open its **DNS** (or "DNS zone") page and add one **TXT** record for each line shown in Settings > E-mails. Use the **Copy** buttons. Changes take from a few minutes to a few hours to be visible. Example for `myshop.com` and a server at `203.0.113.7`:

| Type | Name | Value |
| --- | --- | --- |
| TXT | `myshop.com` | `v=spf1 ip4:203.0.113.7 ~all` |
| TXT | `shopme1._domainkey.myshop.com` | `v=DKIM1; k=rsa; p=MIIBIjANBgkqh...` |
| TXT | `_dmarc.myshop.com` | `v=DMARC1; p=none; rua=mailto:postmaster@myshop.com` |

Some providers want only the part before the domain in the Name field (`@`, `shopme1._domainkey`, `_dmarc`).

- **SPF** says which servers may send for your domain. A domain can have only **one** SPF record. If you already have one (for example for your mailbox provider), ShopMe reads it and proposes the merged value: your existing line with your server added before the final `~all` or `-all`. Replace the old line with the proposed one; do not add a second.
- **DKIM** is the signature of your e-mails. The value is the public half of the key ShopMe created; the private half never leaves the server. With a relay, the relay gives you its own DKIM lines: copy them from its dashboard.
- **DMARC** tells receivers what to do with mail that fails SPF and DKIM. It starts with `p=none` (watch only) and a report address (`rua`, default `postmaster@your-domain`; you can change it in Advanced options). Once your mail has been delivered fine for a few weeks, change `p=none` to `p=quarantine`.

### Check

**Check** looks the records up live and shows, for each line, **Done**, **To do** or **Problem** with the fix in one sentence. It also keeps the result: ShopMe checks again by itself every ten minutes while SPF or DKIM are not in place, and twice a day afterwards.

### Which address is in "From"

A message sent straight from your server only reaches the inbox if the From domain is authenticated (SPF and DKIM pass). So:

- While your domain's SPF and DKIM do not pass, or when the sender is a free mailbox such as `gmail.com`, ShopMe does **not** use that address in From. It sends from the platform address, `no-reply@<platform domain>`, with your store name as display name and your store address as Reply-To. The page says so: "Sent from no-reply@… on behalf of your store until your domain is verified".
- As soon as your own checks pass, it switches to your own address by itself.
- The platform domain is the host of `APP_URL` (single-store) or `STORE_BASE_DOMAIN` / `ADMIN_HOST` (multi-store). It needs the same 3 lines, once for the whole installation: in multi-store mode the platform owner does it in the platform area, in single-store mode in Settings > E-mails > Details, "Installation domain". Without an authenticated platform domain there is no fallback, and the admin shows a banner.
- With a relay or the installation's `SMTP_URL`, the From stays your address.

## Server checks (direct mode)

In **Details**, ShopMe explains each check in plain words:

1. **Outgoing port 25.** ShopMe connects to well-known mail servers on port 25. Many hosting providers block this port by default to fight spam, or open it on request. You must check with your host; ShopMe cannot change this. If it is blocked, use a relay.
2. **Reverse DNS (PTR).** The name that your server's IP address maps back to. Receivers like it when this name resolves back to the same address ("forward-confirmed") and is not a generic name made of the IP. It is set in your hosting provider's panel (often called "reverse DNS" or "rDNS"), not in your domain's DNS. Use a name such as `mail.myshop.com` that you also point to the server's IP.
3. **Blocklists.** ShopMe asks a few public DNS blocklists (Spamhaus ZEN, SpamCop, PSBL) whether the IP is listed. Only IPv4, only when you press Check, answers cached for an hour. Some lists refuse queries that come through public resolvers; that shows as "unknown", not as a failure.
4. **Server IP.** From `PUBLIC_IP`, else detected, else typed in the page.

When port 25 is blocked or the IP is listed, the page recommends relay mode on the spot.

## Delivery, retries and the outbox

Every message goes to an outbox (Settings > E-mails > Details > Latest e-mails) with its status, number of tries, last error and Message-ID, so failures are never silent.

- The server looks up the recipient domain's MX hosts through the system resolver (a domain without MX falls back to its address, a "null MX" is a permanent failure), and connects on port 25 with opportunistic STARTTLS. On a connection problem or a 4xx answer it tries the next MX.
- A **4xx** answer (temporary: greylisting, mailbox busy) is retried 4 more times with growing waits (15 minutes, 1 hour, 4 hours, 18 hours): five tries over about 23 hours. Retries survive a restart because they are driven by the outbox table.
- A **5xx** answer (permanent: no such user, rejected) marks the message **Failed** at once, with the server's words.
- The envelope sender and the Message-ID use the sending domain.
- **Marketing mail** (abandoned-cart reminders, newsletters) carries `List-Unsubscribe` headers (a link and a mailto, plus one-click where the store is on HTTPS); order, shipping, password and subscription mail does not.

MX hosts and relay hosts on private or loopback addresses are refused. For development only, `EMAIL_ALLOW_PRIVATE_HOSTS=true` allows them.

## Relay mode

Settings > E-mails > Advanced options > "Through an e-mail service". Pick a preset (it fills host, port and encryption), type the user name and the password or API key, save. The password is stored encrypted per store and is never shown again. The presets are starting points: check the exact host, port and SPF `include:` in your provider's dashboard.

| Service | Host | Port | Encryption |
| --- | --- | --- | --- |
| Brevo | `smtp-relay.brevo.com` | 587 | STARTTLS |
| Postmark | `smtp.postmarkapp.com` | 587 | STARTTLS |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | 587 | STARTTLS |
| Mailgun | `smtp.mailgun.org` | 587 | STARTTLS |
| Resend | `smtp.resend.com` | 465 | TLS |
| Zoho Mail | `smtp.zoho.com` | 465 | TLS |

Add the SPF `include:` and DKIM lines your service gives you, and keep the DMARC line. **Check** verifies your SPF include and DMARC; DKIM is the service's business.

## Receiving e-mail

ShopMe has no inbound mail server. For the address where customers write to you, use your registrar's free e-mail forwarding or an existing mailbox. That address is used as the **Reply-To** of the e-mails you send.

## Warm-up advice

A new server IP has no reputation yet. Start with transactional mail only (orders, shipping), send a handful of test messages to your own mailboxes at several providers, and let volume grow over a few weeks. Do not send a large newsletter on day one. Keep an eye on the outbox and, once it runs well, move DMARC to `p=quarantine`.

## Limits

- Direct mode suits transactional volumes (orders, shipping, passwords, a few abandoned-cart reminders). For large newsletters use a relay: they have the reputation and the throttling that bulk sending needs.
- ShopMe delivers each message to each recipient's domain separately; there is no bounce processing beyond the answer received while delivering. A message accepted by the remote server can still be filtered later.
- IPv6 is advertised in SPF when detected, but blocklist checks are IPv4 only.
- Receiving servers may still refuse a new or listed IP, or one without a reverse name: the checks above tell you why.

## Settings

| Variable | Purpose |
| --- | --- |
| `PUBLIC_IP` | The server's public IPv4 (and optionally IPv6, comma separated) for the SPF line, when it cannot be detected. |
| `SMTP_URL` | Installation-wide SMTP account, used by stores that have not chosen a mode. Stores can still switch to direct or to their own relay. |
| `MAIL_FROM` | Default sender when nothing else applies. |
| `EMAIL_ALLOW_PRIVATE_HOSTS` | `true` lets relay and MX hosts be on private or loopback addresses (development only). |
