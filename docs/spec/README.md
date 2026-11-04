# Interoperability specs

These documents describe the interfaces Shoppen implements to be compatible with Shopify-format themes and with a subset
of the Shopify Admin GraphQL API. They are the written contract between "what other tools expect" and "what our code does".

> Shoppen is not affiliated with, endorsed by, or sponsored by Shopify Inc. Product and API names appear only to state
> compatibility facts.

## Index

| Spec | What it covers |
|---|---|
| [theme-format.md](theme-format.md) | Directory layout, JSON templates, section groups, sections, theme blocks, snippets, schema keys, setting types, global settings, locales, assets, layout requirements. Includes counts from two real themes. |
| [liquid-compat.md](liquid-compat.md) | Inventory of Liquid tags, filters and objects used by those themes, with usage counts, "standard Liquid vs Shopify-specific" classification and P0/P1/P2 priorities for `packages/liquid-compat`. |
| [admin-api-mvp.md](admin-api-mvp.md) | Admin GraphQL conventions (ids, connections, user errors, money, versions, throttling, scope errors) and the MVP subset: types, fields, enums, root queries, mutations and input types. |
| [data-model.md](data-model.md) | Our proposed PostgreSQL schema (multi-tenant with row-level security) able to back the MVP API subset and theme rendering. |
| [ajax-cart-api.md](ajax-cart-api.md) | Cart endpoints used by themes (maintained separately; may not exist yet). |
| [storefront-routes.md](storefront-routes.md) | Storefront URL routes and renderer contract (maintained separately; may not exist yet). |

Suggested reading order for a new contributor: `theme-format.md`, `liquid-compat.md`, `admin-api-mvp.md`, `data-model.md`.

## Method (clean room)

The policy is in [../legal/clean-room.md](../legal/clean-room.md). In short:

1. **Sources.** Only (a) public documentation and (b) observations of **our own development store**: its GraphQL
   introspection result, recorded query responses, the theme files downloaded from that store, and (for the storefront
   specs) recorded HTTP exchanges. No third-party code, no stores we do not own.
2. **Our words.** Specs are written in English in our own words. We list names that interoperability requires (types,
   fields, enums, tags, filters, objects, file paths, JSON keys). We do not copy source code, markup, stylesheet rules,
   schema descriptions, or documentation prose. Examples in specs are written from scratch.
3. **Private captures.** Raw captures live outside the repository (default `~/shoppen-re`) and are never committed.
   Specs contain numbers and structure derived from them (counts, key sets, type/field names), not the captures themselves.
4. **Derived counts.** Counts in `theme-format.md` and `liquid-compat.md` come from throwaway analysis scripts run over the
   private theme downloads (a tokenizer for Liquid tags/outputs, a JSON walker for templates, schemas and settings) and from a
   GraphQL-schema walker for `admin-api-mvp.md`. These scripts are not part of the repository; the methods and their limits
   are described in each spec so the numbers can be reproduced.
5. **Verification.** Statements marked "public docs", "to verify" or "to confirm" are not yet backed by an observation on our
   store. They become conformance tests (request/response pairs reduced to synthetic data) before the behavior is relied on.

## Regenerating the private captures

You need your own development store, an app installed on it with read-only scopes, and credentials in `.env`
(see [../../scripts/re/README.md](../../scripts/re/README.md) for setup).

```bash
bash scripts/re/run-all.sh
```

This fetches a token, saves the schema (`raw/admin-<version>/schema.graphql` and an introspection JSON), the sample
responses (`raw/samples/{shop,products,collections,customers,orders}.json`), the theme files
(`raw/theme/<theme-name>/...`) and, when present, the storefront capture. Output goes to `$RE_OUT` (default
`~/shoppen-re`), which must be outside any git repository. `API_VERSION` defaults to `2026-10`.

## Status and versioning of the specs

All documents are drafts for the pre-alpha phase. Each states which API version and which sample themes it was derived
from. When a new quarterly API version appears, re-run the captures and diff the type/field lists for the MVP set.
