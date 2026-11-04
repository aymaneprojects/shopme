export class ApiError extends Error {
  constructor(message: string, public status: number, public issues?: unknown) { super(message); }
}

export interface UserError { field?: string[] | null; message: string }
/** Thrown by `mutate` when a payload carries `userErrors` (HTTP 200 validation problems). */
export class UserErrors extends Error {
  constructor(public errors: UserError[]) { super(errors.map((e) => e.message).join('; ')); }
  /** Message for a form field path such as `title` (matches the end of `['product','title']`). */
  forField(name: string): string | undefined { return this.errors.find((e) => e.field?.[e.field.length - 1] === name)?.message; }
}

export const UNAUTHORIZED_EVENT = 'shopme:unauthorized';

export async function rest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/admin/api${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; issues?: unknown };
  if (!res.ok) throw new ApiError(json.error ?? `HTTP ${res.status}`, res.status, json.issues);
  return json as T;
}

export const GRAPHQL_URL = '/admin/api/2026-10/graphql.json';

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) { window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)); throw new ApiError('Unauthorized', 401); }
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new ApiError(json.errors.map((e) => e.message).join('; '), res.status);
  if (!res.ok || !json.data) throw new ApiError(`HTTP ${res.status}`, res.status);
  return json.data;
}

/** Run a mutation and throw `UserErrors` if `data[root].userErrors` is non-empty. Returns the payload. */
export async function mutate<P = Record<string, unknown>>(query: string, variables: Record<string, unknown>, root: string): Promise<P> {
  const data = await gql<Record<string, P & { userErrors?: UserError[] }>>(query, variables);
  const payload = data[root] as P & { userErrors?: UserError[] };
  if (payload?.userErrors?.length) throw new UserErrors(payload.userErrors);
  return payload;
}
