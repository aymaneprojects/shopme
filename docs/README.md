# Documentation

## Install and operate

- [Install and deploy](install/README.md) (also in [French](install/README.fr.md)): local run, Docker Compose, VPS with HTTPS, backups, upgrades.
- [Sending e-mail](install/email.md) (also in [French](install/email.fr.md)): direct sending from your server or an SMTP relay, the DNS records, checks and limits.
- [Caddyfile](install/Caddyfile): reverse proxy example used by the VPS guide.
- [Desktop apps](install/desktop.md): Windows, macOS and Linux apps (beta), attached to each GitHub Release.

## Developer notes

- [Foundation](dev/foundation.md): repository layout, conventions for services and the server.
- [Admin GraphQL](dev/admin-graphql.md): how to add a module to the Admin API.
- [Admin settings API](dev/admin-settings-api.md): ShopMe-specific settings and analytics operations.
- [Admin authentication](dev/admin-auth.md): REST contract for setup, login and sessions.
- [Checkout and payments](dev/payments.md): checkout flow, pricing rules, payment providers.
- [Carrier accounts: rates and shipping labels](dev/carrier-labels.md): the HTTP contract for carrier-calculated rates and label purchase, and the built-in test carrier.
- [Accounts, privacy, events and store credit](dev/privacy-and-credit.md): consent model and region table (data to review, not legal advice), cookie banner and `Shopify.customerPrivacy`, event bus and sandboxed pixels, email-code sign-in, store credit and its checkout tender.
- [Platform](dev/platform.md): analytics reports, staff 2FA and sessions, security headers and caching, store export/import and backups, languages and translations.

## Specifications

Interoperability specs, written in our own words. See the [spec index](spec/README.md).

- [Theme format](spec/theme-format.md)
- [Liquid compatibility](spec/liquid-compat.md)
- [Storefront routes](spec/storefront-routes.md)
- [Ajax cart API](spec/ajax-cart-api.md)
- [Admin API subset](spec/admin-api-mvp.md)
- [Admin UX inventory](spec/admin-ux.md)
- [Data model](spec/data-model.md)

## Legal

- [Clean-room policy](legal/clean-room.md): how we build compatibility without copying third-party code or text.

## Project files

- [Roadmap](../ROADMAP.md) · [Changelog](../CHANGELOG.md) · [Contributing](../CONTRIBUTING.md) · [Security policy](../SECURITY.md) · [Code of conduct](../CODE_OF_CONDUCT.md)
