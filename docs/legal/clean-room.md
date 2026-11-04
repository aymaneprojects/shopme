# Clean-room policy

Shoppen aims to be compatible with Shopify-format themes and a subset of Shopify's APIs. To stay legally and
ethically clean, every contributor follows these rules.

1. **Reproduce behavior, not code.** We implement what an interface does, in our own code, from our own understanding.
2. **Specs are written in our own words**, from public documentation and from observing our own development store.
3. **Never commit third-party material**: no Shopify source code, theme files, schema dumps, documentation text,
   Polaris components, icons, logos, or other brand assets.
4. **Names for interoperability only.** API, type, field, object, tag, and endpoint names may appear because
   compatibility requires them. They are not an endorsement or a claim of affiliation.
5. **Raw captures stay private.** HTTP captures, introspection output, theme downloads, and sample data live outside
   the repository (default `~/shoppen-re`). `.gitignore` covers common cases, but you are responsible for checking.
6. **Only test against stores you own.** Use your own development store and your own credentials. Never probe,
   scrape, or authenticate against stores belonging to others.
7. **Conformance tests** are derived from request/response pairs recorded against our own store, reduced to
   synthetic data, and contain no third-party code or text.
8. **Brand.** "Shopify" may only appear in factual compatibility statements ("compatible with Shopify themes").
   Shoppen is not affiliated with, endorsed by, or sponsored by Shopify Inc.

If you are unsure whether something is allowed, ask in an issue before committing it.
