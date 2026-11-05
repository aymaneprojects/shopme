import SchemaBuilder from '@pothos/core';
import type { GraphQLContext } from './context';

export interface SchemaTypes {
  Context: GraphQLContext;
  DefaultFieldNullability: false;
  Scalars: {
    DateTime: { Input: Date; Output: Date | string };
    Date: { Input: Date; Output: Date | string };
    Decimal: { Input: string; Output: string };
    Money: { Input: string; Output: string };
    UnsignedInt64: { Input: string; Output: string | number };
    JSON: { Input: unknown; Output: unknown };
    URL: { Input: string; Output: string };
    HTML: { Input: string; Output: string };
  };
}

/** The single schema builder. Feature modules import it and register types/fields on it. */
/** Output fields are non-null unless declared `nullable: true` (the Shopify convention; see docs/dev/admin-graphql.md). */
export const builder = new SchemaBuilder<SchemaTypes>({ defaultFieldNullability: false });

builder.queryType({});
builder.mutationType({});
