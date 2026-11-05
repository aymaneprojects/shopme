# Metaobjects

Status: draft for implementation. API version studied: 2026-10. Names are listed for interoperability; behavior text is ours.
Admin screens were observed on our own development store (section 3.1).

## 1. Purpose

Let merchants and apps define their own structured content types (a "definition" with typed fields) and create entries of
them, reference entries from product/collection/page/shop metafields and from other entries, read them in themes, and
optionally publish entries as storefront pages. This is the basis for FAQ lists, size charts, store locators, team members,
ingredient lists, etc.

Existing in ShopMe: typed metafields (`metafields`, `metafield_definitions`, `METAFIELD_BASE_TYPES` already lists
`metaobject_reference` and `mixed_reference` but nothing resolves them), translations for pages/products/collections, pages and
templates. Missing: definitions, entries, references, Liquid access, admin UI, page routes, translations of entries.

## 2. Concepts

- **Definition** (`MetaobjectDefinition`): `type` (unique handle-like string, 3 to 255 chars, letters, digits, hyphen,
  underscore; app-reserved types start with `app--<id>--`), `name`, `description`, ordered list of **field definitions**
  (key, name, description, type, required, validations), `displayNameKey` (which text field names an entry; "auto-generated"
  when absent), access settings, and **capabilities**.
- **Entry** (`Metaobject`): belongs to one definition, has a `handle` unique within its type, a map of field values (strings as
  stored for metafields), `displayName`, timestamps, and capability data.
- **Capabilities**: `publishable` (entries have status ACTIVE or DRAFT; drafts are invisible to buyers), `translatable`
  (entry text fields can be translated per locale), `renderable` (SEO title/description take their value from named fields),
  `onlineStore` (entries get a storefront URL `/pages/<urlHandle>/<handle>` rendered with a theme template; implies renderable).
  Only the `publishable` and `translatable` flags are required by this feature's brief; `onlineStore` and `renderable` are in the
  MVP+1 and specified here because the admin toggle exists.
- **Reference** fields: field types `metaobject_reference` (validation `metaobject_definition_id` pins the target definition),
  `list.metaobject_reference` (validation `metaobject_definition_ids` or the single form), `mixed_reference` (several allowed
  definitions); these types also work in ordinary metafields (owner types product, variant, collection, customer, order, location,
  shop, page, article, blog).
- **Access**: `admin` (`PRIVATE`, `MERCHANT_READ`, `MERCHANT_READ_WRITE`, `PUBLIC_READ`, `PUBLIC_READ_WRITE`: who may see/edit in the
  admin and API), `storefront` (`NONE` or `PUBLIC_READ`: whether Liquid and storefront APIs expose it), `customerAccount` (`NONE`, `READ`).
  The admin toggles "Storefront API access" and "Customer account API access" map to these.

## 3. Merchant-facing behavior

### 3.1 Admin screens (observed)

**Content > Metaobjects (landing page).**
- Header: back arrow, title, a "Manage" button (opens the settings area where definitions are listed and edited, see below) and a
  primary "Add definition" button.
- Four summary tiles in a grid: "Available on the online store" (number of entries published as web pages), "Web pages"
  (entries with page URLs), "Active" (entries with ACTIVE status, here 4) and "Draft" (here 0). Each tile counts entries and is a
  shortcut that opens the entry list filtered by that condition.
- A card "Recent entries" listing the latest entries (entry display name on the left, owning definition name on the right) with a
  link "View all N entries".
- Below, a toolbar: a saved-view selector (tab named "Custom" in the capture), a search field over definition names, a column
  chooser button and a visibility (eye) button. The list under it shows definitions (name, entry count, ...). In the capture it
  showed "No definition found" because the only definition was owned by an app and hidden from the merchant-owned list;
  that implies the list filters by owner and hides app-reserved definitions unless an app filter is used.
- Footer link "Learn more about metaobjects".

**Add a metaobject definition** (page under Settings > Custom data, breadcrumb "Metafields and metaobjects"):
- Card 1: Name field (placeholder gives examples such as "Cart upsell", "Fabric colors", "Product bundle"); beneath it a line
  "Type:" that fills with the generated type once a name is entered (type can be changed only at creation, via a small edit link);
  an "Add description" link.
- Card "Fields": a list of field rows, each with a drag handle, a required label input (asterisk), a one/list switch ("One" or "List")
  and a field type dropdown ("Select the field type"), plus an expand chevron revealing the field's key, description, required
  checkbox and type-specific validations (min/max, choices, allowed definitions, file types); "Add a field" below.
- Card "Metaobject options" (with info icon) with five switches: Active/Draft status (publishable capability, on by default),
  Translations (translatable, on by default), Publish entries as web pages (online store capability; switched off and disabled until
  prerequisites are met: a display-name text field and a template), Storefront API access (storefront access, on by default),
  Customer account API access (off).
- Card "Field options": "Display name" selector (default "Auto-generated": the first single-line text field is used; or pick a
  specific text field) and "Fields used as filters" with an "Add fields" button (the admin filterable capability; disabled until
  fields exist).
- Save bar (not visible in the capture): Save / Discard.

**Entry page** (from an entry row; breadcrumb "Metaobjects / Entries"):
- Title = entry display name; subtitle "Added by <app or staff>" when created by an app.
- Top right: a "Duplicate" button and an "Other actions" menu (delete; others not observed).
- Main card: one row per field, label on the left (asterisk when required, small info icon when it has a description), value
  editor on the right: text chip/inputs, "Add" buttons for empty optional values, a True/False segmented toggle for booleans, a
  selector chip for choice lists, reference pickers. Field order follows the definition.
- Right column: card with the definition name (overflow menu: go to the definition, view all entries) and the creator name;
  card "Anchor" showing the entry handle in a chip with a copy button (the handle is what Liquid and URLs use).
- Entries of definitions with publishable capability show a Status control (Active/Draft) at the top of the side column; with
  online store capability they show the page URL and SEO fields.

**Entry list** (not captured): table of entries per definition (display name, status, first few fields, updated), bulk actions
(delete, set active/draft), search, filters (status, filterable fields), "Add entry" button on the definition page.

### 3.2 Behaviors

- Creating an entry validates each field by type and validations; required fields must be non-empty. Unknown keys are rejected.
- Handle: derived from the display name (slug, unique within the type; suffix `-1`, `-2` on conflict) unless provided.
  Changing the handle of an entry with an online-store URL can create a redirect (`redirectNewHandle`).
- Deleting an entry referenced by another entry or metafield: the reference becomes empty (the referencing value is cleaned) and the
  referencing definitions with the field required refuse the delete (`REFERENCE_EXISTS_ERROR`).
- Deleting a definition deletes all its entries (job) after confirmation; refuses when another definition's reference field pins
  it unless that field is removed first.
- Draft entries: not returned to storefront Liquid/AJAX/storefront APIs; shown in the theme editor preview and to staff.
- Translating an entry: fields flagged by type (text, rich text, url, json strings) appear as translatable resources of type
  `METAOBJECT` with keys equal to field keys; reuses the existing `translations` table with `resourceType = 'METAOBJECT'`.
- Market-specific values (`MarketLocalization`): later.
- Limits (configurable defaults): 128 definitions, 40 fields per definition, 1 million entries per shop, 128 KB per text value,
  250 entries per bulk operation. Return `MAX_DEFINITIONS_EXCEEDED`, `MAX_OBJECTS_EXCEEDED`, `INPUT_LIMIT_EXCEEDED`.
- Standard definitions (templates the merchant can enable with one click, `standardMetaobjectDefinitionEnable(type)`): later; we ship none
  in the MVP.

## 4. Data model proposal (Drizzle)

```ts
export const metaobjectDefinitions = pgTable('metaobject_definitions', {
  id: pk(), shopId: shopFk(),
  type: text('type').notNull(),
  name: text('name').notNull(), description: text('description'),
  fieldDefinitions: jsonb('field_definitions').$type<MetaobjectFieldDef[]>().notNull().default([]),  // ordered
  displayNameKey: text('display_name_key'),
  accessAdmin: text('access_admin').notNull().default('PUBLIC_READ_WRITE'),
  accessStorefront: text('access_storefront').notNull().default('PUBLIC_READ'),
  accessCustomerAccount: text('access_customer_account').notNull().default('NONE'),
  capPublishable: boolean('cap_publishable').notNull().default(true),
  capTranslatable: boolean('cap_translatable').notNull().default(true),
  capRenderable: boolean('cap_renderable').notNull().default(false),
  renderableMetaTitleKey: text('renderable_meta_title_key'), renderableMetaDescKey: text('renderable_meta_desc_key'),
  capOnlineStore: boolean('cap_online_store').notNull().default(false),
  onlineStoreUrlHandle: text('online_store_url_handle'),
  ownerApp: text('owner_app'),                           // null = merchant; 'app--<id>' for app-reserved
  entryCount: integer('entry_count').notNull().default(0),
  ...timestamps(),
}, (t) => [uniqueIndex('metaobject_defs_type_uq').on(t.shopId, t.type), uniqueIndex('metaobject_defs_urlhandle_uq').on(t.shopId, t.onlineStoreUrlHandle)]);
// MetaobjectFieldDef = { key, name, description?, type, required, validations: [{name, value}], adminFilterable?: boolean }

export const metaobjects = pgTable('metaobjects', {
  id: pk(), shopId: shopFk(),
  definitionId: ref('definition_id').notNull().references(() => metaobjectDefinitions.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),                          // denormalized from the definition for lookups
  handle: text('handle').notNull(),
  status: text('status').notNull().default('ACTIVE'),   // ACTIVE | DRAFT (capability publishable)
  displayName: text('display_name').notNull().default(''),
  values: jsonb('values').$type<Record<string, string>>().notNull().default({}),   // key -> stored string value (same encoding as metafields)
  templateSuffix: text('template_suffix'),               // onlineStore capability data
  createdByStaffId: ref('created_by_staff_id'), createdByApp: text('created_by_app'),
  ...timestamps(),
}, (t) => [uniqueIndex('metaobjects_handle_uq').on(t.shopId, t.type, t.handle), index('metaobjects_def_idx').on(t.definitionId, t.updatedAt)]);

export const metaobjectReferences = pgTable('metaobject_references', {   // reverse index for referencedBy and delete checks
  id: pk(), shopId: shopFk(),
  targetId: ref('target_id').notNull().references(() => metaobjects.id, { onDelete: 'cascade' }),
  sourceKind: text('source_kind').notNull(),              // 'METAOBJECT' | 'METAFIELD'
  sourceId: bigint('source_id', { mode: 'number' }).notNull(),
  fieldKey: text('field_key').notNull(),                  // metaobject field key or metafield namespace.key
}, (t) => [index('metaobject_refs_target_idx').on(t.targetId)]);
```

Entry values stay in a `jsonb` map (one row per entry) rather than a values table: simple, easy to validate and render, and
Postgres GIN indexing on `values` supports admin filters. If per-field querying (sort by a field) becomes a need, add an expression
index. Reference integrity is enforced in the service (the reverse index is rebuilt in the same transaction as every write).
Translatable resources: reuse `translations` (`resourceType: 'METAOBJECT'`, `resourceId: String(entryId)`, `key: fieldKey`) and add
`METAOBJECT` to the translatable resource list; digest as for other resources.

Metafield references: `metafields.value` for `metaobject_reference` stores the GID; for `list.metaobject_reference` a JSON array of GIDs.
When a metafield owner row is written or removed, also write the reverse index.

## 5. Admin GraphQL surface

### 5.1 Types (MVP)
`Metaobject` (id, type, handle, displayName, fields, field(key), values (JSON map), definition, capabilities
(`MetaobjectCapabilityData { publishable { status } onlineStore { templateSuffix } }`), createdAt, updatedAt, createdBy and
createdByApp/Staff (return the app or staff snapshot; MVP returns a stub App), referencedBy (`MetafieldRelationConnection`),
thumbnailField), `MetaobjectField` (key, type, value, jsonValue, definition, reference, references, thumbnail),
`MetaobjectDefinition` (id, type, name, description, displayNameKey, fieldDefinitions, access, capabilities, hasThumbnailField,
metaobjectsCount, metaobjects(connection), standardTemplate, createdAt, updatedAt), `MetaobjectFieldDefinition` (key, name,
description, required, type: `MetafieldDefinitionType`, validations, capabilities { adminFilterable }), `MetaobjectAccess`,
`MetaobjectCapabilities` (publishable, translatable, renderable, onlineStore, each with `enabled` and `data`),
`MetafieldRelation` (key, name, namespace, referencer, target). `MetafieldReference` union must include `Metaobject`.

Enums: `MetaobjectStatus` (DRAFT, ACTIVE), `MetaobjectAdminAccess`, `MetaobjectAdminAccessInput`, `MetaobjectStorefrontAccess`
(NONE, PUBLIC_READ), `MetaobjectCustomerAccountAccess` (NONE, READ), `MetaobjectCapabilityType` (PUBLISHABLE, TRANSLATABLE, RENDERABLE,
ONLINE_STORE), `MetaobjectUserErrorCode`. Also add owner/translation type `METAOBJECT` where enums list resource types.

### 5.2 Root fields
`metaobject(id)`, `metaobjectByHandle(handle: MetaobjectHandleInput {type, handle})`, `metaobjects(type!, sortKey, first, ..., query)`,
`metaobjectDefinition(id)`, `metaobjectDefinitionByType(type)`, `metaobjectDefinitions(first, ...)`. Query syntax for `metaobjects`:
`display_name:`, `handle:`, `id:`, `updated_at:`, `fields.<key>:value` (text contains, numbers comparison); free text matches display
name and text fields. `sortKey` values: `id`, `type`, `updated_at`, `display_name`.

### 5.3 Mutations
MVP: `metaobjectDefinitionCreate(definition)`, `metaobjectDefinitionUpdate(id, definition)`, `metaobjectDefinitionDelete(id)`,
`metaobjectCreate(metaobject)`, `metaobjectUpdate(id, metaobject)`, `metaobjectUpsert(handle, metaobject, values)`,
`metaobjectDelete(id)`, `metaobjectBulkDelete(where: { type | ids })` (returns `job`).
Later: `standardMetaobjectDefinitionEnable(type)`, market localizations, `metafieldDefinitionCreate` accepting
`metaobject_definition_id` validations (extend the existing metafield definition mutation now so references can be pinned).

Inputs: `MetaobjectDefinitionCreateInput { type, name, description, fieldDefinitions: [MetaobjectFieldDefinitionCreateInput { key, type,
name, description, required, validations: [{name, value}], capabilities: { adminFilterable: { enabled } } }], access, displayNameKey,
capabilities: { publishable: {enabled}, translatable: {enabled}, renderable: {enabled, data: {metaTitleKey, metaDescriptionKey}},
onlineStore: {enabled, data: {urlHandle, createRedirects}} } }`. `MetaobjectDefinitionUpdateInput { name, description,
fieldDefinitions: [{ create | update | delete }], access, displayNameKey, resetFieldOrder, capabilities }`.
`MetaobjectCreateInput { type, handle, fields: [{key, value}], capabilities: { publishable: {status}, onlineStore: {templateSuffix} },
values (JSON) }` where `fields` and `values` are alternatives. `MetaobjectUpdateInput { handle, fields, capabilities,
redirectNewHandle, values }`. `MetaobjectUpsertInput { handle, fields, capabilities }`.

### 5.4 userErrors
`MetaobjectUserError { field message code elementKey elementIndex }`. Codes emitted: `INVALID`, `INCLUSION`, `TAKEN` (type or handle),
`TOO_LONG`, `TOO_SHORT`, `PRESENT`, `BLANK`, `INVALID_TYPE`, `INVALID_VALUE`, `INVALID_OPTION`, `DUPLICATE_FIELD_INPUT`,
`UNDEFINED_OBJECT_TYPE`, `UNDEFINED_OBJECT_FIELD`, `OBJECT_FIELD_TAKEN`, `OBJECT_FIELD_REQUIRED`, `RECORD_NOT_FOUND`, `MAX_DEFINITIONS_EXCEEDED`,
`MAX_OBJECTS_EXCEEDED`, `INPUT_LIMIT_EXCEEDED`, `IMMUTABLE` (changing a type or a field's type after creation), `NOT_AUTHORIZED`,
`RESERVED_NAME`, `DISPLAY_NAME_CONFLICT`, `ADMIN_ACCESS_INPUT_NOT_ALLOWED`, `CAPABILITY_NOT_ENABLED`, `URL_HANDLE_TAKEN`,
`URL_HANDLE_INVALID`, `URL_HANDLE_BLANK`, `FIELD_TYPE_INVALID`, `MISSING_REQUIRED_KEYS`, `REFERENCE_EXISTS_ERROR`, `INTERNAL_ERROR`.
Not emitted: `APP_CONFIG_MANAGED`, `STANDARD_METAOBJECT_DEFINITION_DEPENDENT_ON_APP` until app ownership is implemented.

MVP vs later:
- MVP: definitions with scalar and reference field types, display name, publishable and translatable capabilities, entries CRUD and upsert,
  bulk delete job, reference fields in metafields and entries with referencedBy, Liquid access, admin pages (landing, definition editor,
  entry list/editor), translations of entries, REST-free GraphQL only.
- MVP+1: renderable and onlineStore capabilities with storefront page routes and theme templates, admin filters on fields, saved views.
- Later: standard definitions, market localizations, app-owned definitions with access rules, customer-account access, import/export CSV.

## 6. Liquid and storefront impact

- Global object `metaobjects`: `metaobjects.<type>.<handle>` returns the entry (nil when absent, draft, or storefront access is NONE);
  `metaobjects.<type>.values` returns the iterable of active entries (limit 250, ordered by creation) and `metaobjects.<type>.system`
  not provided. Also expose it as `shop.metaobjects` (same data) because themes use that spelling too.
- Entry object: field values by key (`entry.title`), plus `entry.system` with `id`, `handle`, `type`, `url` (when onlineStore), `updated_at`.
  Field values behave like metafield values: text types render as strings; `rich_text_field` as the rendered HTML (with `metafield_tag` /
  `metafield_text` filters applied by theme code); numbers and booleans native; `product_reference` returns a product drop,
  `collection_reference`, `page_reference`, `variant_reference`, `file_reference` (image/file drops), `metaobject_reference` returns the
  nested entry, lists return arrays, `mixed_reference` returns the mixed typed drops; money, weight, volume, dimension return value-objects
  with `.value`/`.unit` as today for metafields. Access to `entry.field.type`, `entry.field.value` via `metafield`-style wrappers is not used
  (that is metafield syntax); fields are direct properties.
- Metafields of reference types on products/collections/pages/shop: `product.metafields.custom.size_chart.value` returns the entry.
- Pages: with the `onlineStore` capability, route `/pages/<urlHandle>/<handle>` renders `templates/metaobject/<type>.json` (or a suffix
  from the entry's `templateSuffix`; fallback 404 if the template is missing). Liquid objects in that page: `metaobject` (the entry), `page_title`
  (from the renderable title key or display name), `page_description`. Sitemap includes active entries of such definitions.
  Canonical, hreflang and meta tags like pages.
- Theme editor: dynamic sources (a setting can bind to a metaobject field) are a later item; `metaobject` and `metaobject_list` setting
  types (in `config/settings_schema.json` and section schemas) store GIDs or handles and resolve to entry drops: include in MVP
  since themes use them (add to theme-format coverage).
- AJAX: no public JSON endpoint for entries. The Storefront API is not part of this spec.
- Cache: invalidate cached HTML for pages using an entry when it changes (tag entries by type in the page cache).

## 7. Edge cases

- Field type changes are impossible after creation; to change, delete and recreate the field (data loss prompt).
- Removing a field definition drops values for that key lazily (ignored when reading; physically removed by a background job).
- Reordering fields only changes presentation (`resetFieldOrder` resets to creation order).
- A reference to a deleted entry reads as null in Liquid and as empty in the API; lists drop the missing items.
- Self-reference and cycles are allowed in data; Liquid rendering stops expanding at depth 5 (return nil beyond).
- `displayName` recomputed on every write; a definition's `displayNameKey` change recomputes all entries (job).
- Draft entries referenced from active content: still resolvable in the admin, hidden in the storefront.
- Handle uniqueness is per type and compared case-insensitively; handles are lowercase slugs.
- Required field added to a definition with existing entries: allowed, existing entries are flagged invalid in the admin list and
  edits require filling it (API reads still succeed).
- Concurrency: entry updates use last write wins per request but field-level merge for `fields` input (only provided keys change).
- Money values need currency in the value JSON, dates must be ISO 8601, colors `#RRGGBB`, ratings carry scale min/max validations.
- Import via migrate package: entries and definitions are not imported today; Later work.

## 8. Test plan

- Unit: value validation per type (all base types and list variants, validations min/max/choices/regex/allowed definitions), handle
  generation, display-name derivation, reference index maintenance.
- API conformance: create definition with each capability combination, update fields via create/update/delete operations, create/update/upsert
  entries, bulk delete job result, user error codes with `elementKey`/`elementIndex`, query syntax and sort keys, pagination.
- Referential: delete referenced entry, delete definition with referencing field, `referencedBy`.
- Liquid: `metaobjects.type.handle`, `.values`, nested references, list fields, rich text, draft hiding, depth limit, `shop.metaobjects` alias.
- Routes: onlineStore page rendering, 404s for drafts/missing templates, handle change redirect, sitemap entries.
- Translation: register/read translation for a text field, outdated digest after edit.

## 9. Open questions (captures still needed)

Observed: landing page, definition creation page, entry page with its side column.
1. **Manage** button destination (the definitions list under Settings > Custom data > Metaobjects): columns, row actions, how app-owned
   definitions are shown.
2. A **definition detail page** after creation: entry table columns, "Add entry" flow, bulk actions menu, filters.
3. The expanded **field settings** panel (chevron on a field row): key field, required checkbox, validation inputs per type, and the
   list of field types shown in the type dropdown.
4. "Publish entries as web pages" enabled state: what appears (URL handle input, redirect option, template picker, SEO field mapping).
5. Entry page with status control and with the online-store and SEO cards.
6. The delete-definition confirmation text (does it mention entry counts and redirects?).
