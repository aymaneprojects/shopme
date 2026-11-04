import type { UserError as UserErrorShape } from '@shopme/shopify-compat';
import { builder } from '../builder';

/**
 * Mutation error pattern. Every mutation payload has `userErrors: [UserError!]!`; validation problems are
 * returned there (HTTP 200, main field null) instead of being thrown. Build errors with `userError()` from
 * @shopme/shopify-compat and payloads with `definePayload`.
 */
export const DisplayableError = builder.interfaceRef<UserErrorShape>('DisplayableError').implement({
  fields: (t) => ({
    field: t.stringList({ nullable: true, resolve: (e) => e.field }),
    message: t.exposeString('message'),
  }),
});

export const UserError = builder.objectRef<UserErrorShape>('UserError').implement({
  interfaces: [DisplayableError],
  fields: () => ({}),
});

type PayloadBase = { userErrors: UserErrorShape[] };

/**
 * Define `<Name>Payload` with a `userErrors` field appended.
 *   const ProductCreatePayload = definePayload<{ product: Product | null }>('ProductCreatePayload',
 *     (t) => ({ product: t.field({ type: ProductRef, nullable: true, resolve: (p) => p.product }) }));
 */
export function definePayload<Shape extends object>(
  name: string,
  fields: (t: PothosSchemaTypes.ObjectFieldBuilder<PothosSchemaTypes.ExtendDefaultTypes<import('../builder').SchemaTypes>, Shape & PayloadBase>) => Record<string, any>,
) {
  const ref = builder.objectRef<Shape & PayloadBase>(name);
  ref.implement({
    fields: (t) => ({
      ...fields(t as never),
      userErrors: t.field({ type: [UserError], resolve: (p) => p.userErrors }),
    }),
  });
  return ref;
}
