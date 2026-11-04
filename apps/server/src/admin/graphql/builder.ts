import SchemaBuilder from '@pothos/core';
import type { GraphQLContext } from './context';

export interface SchemaTypes {
  Context: GraphQLContext;
  Scalars: {
    DateTime: { Input: Date; Output: Date | string };
    Decimal: { Input: string; Output: string };
    Money: { Input: string; Output: string };
    UnsignedInt64: { Input: string; Output: string | number };
    JSON: { Input: unknown; Output: unknown };
    URL: { Input: string; Output: string };
    HTML: { Input: string; Output: string };
  };
}

/** The single schema builder. Feature modules import it and register types/fields on it. */
export const builder = new SchemaBuilder<SchemaTypes>({});

builder.queryType({});
// graphql-js rejects a Mutation type without fields; this deprecated no-op keeps the schema valid until
// the first real mutation module lands. Remove it when `modules/` registers a mutation.
builder.mutationType({
  fields: (t) => ({
    shopmePlaceholder: t.boolean({ nullable: true, deprecationReason: 'Placeholder until mutations are added.', resolve: () => null }),
  }),
});
