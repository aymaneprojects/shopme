export class ApiError extends Error {
  constructor(message: string, public status: number, public issues?: unknown, public body?: Record<string, unknown>) { super(message); }
}

// ---- store in the URL (multi-store mode) ------------------------------------------------------------------------------------

const STORE_PATH_RE = /^\/admin\/store\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)(?=\/|$)/;
/** Store handle named by an admin path (`/admin/store/<handle>/...`), if any. */
export const handleFromPath = (pathname: string): string | null => STORE_PATH_RE.exec(pathname)?.[1] ?? null;

let storeHandle: string | null = typeof window === 'undefined' ? null : handleFromPath(window.location.pathname);
/** The store every request of this tab works on (multi-store mode); null: the installation's only store. */
export const currentStoreHandle = () => storeHandle;
export const setStoreHandle = (h: string | null) => { storeHandle = h; };
/** Base path of this tab's admin: `/admin/store/<handle>` (multi-store) or `/admin`. */
export const adminBase = () => (storeHandle ? `/admin/store/${storeHandle}` : '/admin');
/** URL of an admin API path (`/products` -> `/admin/store/<handle>/api/products` or `/admin/api/products`), for links and downloads too. */
export const apiUrl = (path: string) => `${adminBase()}/api${path}`;

export interface UserError { field?: string[] | null; message: string }
/** Thrown by `mutate` when a payload carries `userErrors` (HTTP 200 validation problems). */
export class UserErrors extends Error {
  constructor(public errors: UserError[]) { super(errors.map((e) => e.message).join('; ')); }
  /** Message for a form field path such as `title` (matches the end of `['product','title']`). */
  forField(name: string): string | undefined { return this.errors.find((e) => e.field?.[e.field.length - 1] === name)?.message; }
}

export const UNAUTHORIZED_EVENT = 'shopme:unauthorized';

export async function rest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; issues?: unknown };
  if (!res.ok) throw new ApiError(json.error ?? `HTTP ${res.status}`, res.status, json.issues, json as Record<string, unknown>);
  return json as T;
}

/** Multipart file upload (CSV import, theme zip). Extra fields go in the query string. */
export async function upload<T>(path: string, file: File, query: Record<string, string> = {}): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${apiUrl(path)}${qs ? `?${qs}` : ''}`, { method: 'POST', credentials: 'same-origin', body });
  const json = (await res.json().catch(() => ({}))) as { error?: string; issues?: unknown };
  if (!res.ok) throw new ApiError(json.error ?? `HTTP ${res.status}`, res.status, json.issues);
  return json as T;
}

export const GRAPHQL_PATH = '/2026-10/graphql.json';

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(apiUrl(GRAPHQL_PATH), {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) { window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)); throw new ApiError('Unauthorized', 401); }
  if (res.status === 403 || res.status === 423) { const j = (await res.json().catch(() => ({}))) as { errors?: unknown; error?: unknown }; throw new ApiError(String(j.error ?? j.errors ?? 'Forbidden'), res.status); }
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
