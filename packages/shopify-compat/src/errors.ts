/** `userErrors` helpers: mutation validation problems are data, not thrown GraphQL errors. */
export interface UserError {
  field: string[] | null;
  message: string;
  code?: string;
}

export function userError(field: string | string[] | null, message: string, code?: string): UserError {
  const f = field === null ? null : Array.isArray(field) ? field : field.split('.');
  return code ? { field: f, message, code } : { field: f, message };
}


/** Success payload: resource fields plus empty `userErrors`. */
export function ok<T extends object>(data: T): T & { userErrors: UserError[] } {
  return { ...data, userErrors: [] };
}

/** Failure payload: resource fields null, given errors. */
export function failed<K extends string>(errors: UserError | UserError[], nulls: K[] = []): { userErrors: UserError[] } & Record<K, null> {
  const out: Record<string, unknown> = { userErrors: Array.isArray(errors) ? errors : [errors] };
  for (const k of nulls) out[k] = null;
  return out as { userErrors: UserError[] } & Record<K, null>;
}
