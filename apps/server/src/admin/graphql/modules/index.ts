/**
 * Module registry. Each feature adds ONE file in this directory and imports it here (side-effect import).
 * A module registers its types and root fields on the shared `builder`:
 *
 *   import { builder } from '../builder';
 *   builder.queryFields((t) => ({ products: t.field({ ... }) }));
 *   builder.mutationFields((t) => ({ productCreate: t.field({ ... }) }));
 *
 * Conventions: see docs/dev/admin-graphql.md.
 */
import './core';
import './shop';
import './files';
import './metafields';
import './locations';
import './inventory';
import './collections';
import './products';
import './product-set';
import './catalog-ext';
import './catalog-parity';
import './files-ext';
import './metafield-definitions';
import './metaobjects';

import './orders';
import './customers';
import './customers-ext';
import './segments';
import './saved-searches';
import './discounts';
import './jobs';
import './discounts-bulk';
import './settings';
import './content';
import './blogs';
import './redirects';
import './themes';
import './analytics';
import './draft-orders';
import './staff';
import './notifications';
import './policies';
import './webhooks';
import './locales';
import './gift-cards';
import './abandoned';
import './orders-parity';
import './order-edit';
import './checkout-settings';
import './delivery';
import './inventory-transfers';
import './purchase-orders';
import './bulk-operations';
import './markets';
