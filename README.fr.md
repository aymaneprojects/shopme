# ShopMe

**La simplicité de Shopify, la liberté de l'open source. Migrez votre boutique en un clic.**

ShopMe est une plateforme e-commerce open source qui exécute les thèmes Liquid au format Shopify, expose un
sous-ensemble compatible des API Admin et Storefront de Shopify, et proposera un outil de migration en un clic.

> **Statut : pré-alpha.** Les fondations (serveur, base de données, authentification) fonctionnent ; les fonctionnalités arrivent. Voir la [ROADMAP](ROADMAP.md).

## Architecture

ShopMe tient dans **un seul conteneur** : un unique processus Node.js plus PostgreSQL (ou une base embarquée en local).
Redis n'est pas nécessaire pour le MVP ; les tâches de fond s'exécutent dans le processus, derrière une petite
interface de file d'attente.

Monorepo TypeScript (pnpm + Turborepo). `apps/server` (Fastify) sert l'API GraphQL Admin, l'authentification,
l'admin (SPA React/Vite) sur `/admin`, la vitrine (moteur de thèmes LiquidJS), l'API panier, le paiement et les
webhooks. PostgreSQL via Drizzle ORM (PGlite embarqué si `DATABASE_URL` est absente). Une boutique par installation,
avec un `shop_id` sur les tables pour garder la porte ouverte à un « ShopMe Cloud » multi-boutiques.
API GraphQL (Yoga + Pothos), adaptateurs Stripe / Mollie / PayPal avec champs de carte hébergés.

## Structure

`apps/` (server, admin), `packages/` (core, liquid-compat, shopify-compat, payments, theme-default, sdk, cli,
migrate, ui), `scripts/re` (scripts d'étude sur votre propre boutique de développement), `docs/` (spécifications,
notes développeur, guides d'installation, politique clean-room).

## Démarrage

```bash
corepack enable
pnpm install
pnpm dev          # http://localhost:3000/admin ouvre l'assistant de configuration
```

Aucune base à installer : sans `DATABASE_URL`, les données sont stockées dans une base PostgreSQL embarquée (PGlite)
sous `./data`. Données de démonstration (optionnel) : arrêtez le serveur puis `pnpm seed`.
Docker, VPS et sauvegardes : [docs/install](docs/install/README.fr.md).

## Licence

Le cœur est sous **AGPL-3.0** ([LICENSE](LICENSE)). `packages/theme-default`, `packages/sdk` et `packages/ui`
sont sous **MIT**.

## Avertissement

ShopMe n'est **ni affilié, ni approuvé, ni sponsorisé par Shopify Inc.** Le nom « Shopify » n'est cité que pour
décrire la compatibilité avec les thèmes et API au format Shopify.
