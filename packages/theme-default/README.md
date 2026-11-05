# @shopme/theme-default

Aurora, the default ShopMe theme (MIT). Online Store 2.0 format: JSON templates, section groups, sections and theme blocks.

- Sections: header, footer, announcement bar, hero, slideshow (overlay, inset, full width), scrolling banner, big logo, split showcase,
  collection list (grid, carousel, bento, editorial), collection links, featured collection, featured product, image with text,
  multicolumn, rich text, image gallery, video, testimonials, collapsible content, blog posts, contact form, newsletter sign-up,
  custom Liquid, divider, popup.
- Customer account pages (login, create account, account, order, addresses, activate account, reset password): JSON templates whose main
  sections have a heading, an introduction text, links and fields to show or hide, alignment and width (forms), orders per page and the
  position of the account details, the SKU, address and shipment blocks of the order page, addresses per row, and a color scheme.
- Theme settings: logo and favicon, colors and named color schemes, fonts per role, text presets, layout, product cards, buttons,
  badges, cart, drawers, icons, inputs, popovers and modals, price, search, swatches and animations.
- Strings: `locales/en.default.json` and `locales/fr.json` (storefront), `locales/*.schema.json` (editor labels).

## Fonts

`assets/font-*.woff2` are the Latin subsets of Inter, DM Sans, Manrope, Space Grotesk, Lora and Playfair Display, served from the
store itself (no third-party requests). They are free software under the SIL Open Font License 1.1; the license texts are in
`assets/font-licenses.txt`.
