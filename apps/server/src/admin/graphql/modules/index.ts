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

import './orders';
import './customers';
import './discounts';
import './settings';
import './content';
import './themes';
import './analytics';
