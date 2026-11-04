# Shoppen

**La simplicité de Shopify, la liberté de l'open source. Migrez votre boutique en un clic.**

Shoppen est une plateforme e-commerce open source qui exécute les thèmes Liquid au format Shopify, expose un
sous-ensemble compatible des API Admin et Storefront de Shopify, et proposera un outil de migration en un clic.

> **Statut : pré-alpha.** Rien n'est encore utilisable. Voir la [ROADMAP](ROADMAP.md).

## Architecture

Monorepo TypeScript (pnpm + Turborepo), PostgreSQL avec RLS (multi-tenant), Redis/BullMQ, API GraphQL
(Yoga + Pothos), admin Next.js, moteur de thèmes basé sur LiquidJS, adaptateurs Stripe / Mollie / PayPal avec
champs de carte hébergés.

## Structure

`apps/` (api, admin, storefront, checkout, worker), `packages/` (core, liquid-compat, shopify-compat, payments,
theme-default, sdk, cli, migrate, ui), `scripts/re` (scripts d'étude sur votre propre boutique de développement),
`docs/legal` (politique clean-room).

## Démarrage

_Bientôt._ Pour l'instant : `corepack enable && pnpm install && pnpm typecheck`.

## Licence

Le cœur est sous **AGPL-3.0** ([LICENSE](LICENSE)). `packages/theme-default`, `packages/sdk` et `packages/ui`
sont sous **MIT**.

## Avertissement

Shoppen n'est **ni affilié, ni approuvé, ni sponsorisé par Shopify Inc.** Le nom « Shopify » n'est cité que pour
décrire la compatibilité avec les thèmes et API au format Shopify.
