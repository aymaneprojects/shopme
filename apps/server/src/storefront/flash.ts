import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Post/redirect/get state for storefront forms: the POST handler stores the outcome of one form (errors, the values the
 * visitor typed, or success) in a short-lived signed cookie, redirects, and the next page render turns it into `form.errors`,
 * `form.posted_successfully?` and the form's input values.
 */
export interface Flash { type: string; errors?: Record<string, string>; values?: Record<string, string>; success?: boolean }

const COOKIE = 'shopme_flash';

export function setFlash(reply: FastifyReply, flash: Flash, secure: boolean): void {
  const values = Object.fromEntries(Object.entries(flash.values ?? {}).map(([k, v]) => [k, String(v).slice(0, 1500)]));
  reply.setCookie(COOKIE, JSON.stringify({ ...flash, values }), { path: '/', httpOnly: true, sameSite: 'lax', signed: true, maxAge: 120, secure });
}

/** Read and clear the flash of this request. */
export function takeFlash(req: FastifyRequest, reply: FastifyReply): Flash | null {
  const raw = req.cookies[COOKIE];
  if (!raw) return null;
  reply.clearCookie(COOKIE, { path: '/' });
  const un = req.unsignCookie(raw);
  if (!un.valid || !un.value) return null;
  try { return JSON.parse(un.value) as Flash; } catch { return null; }
}

/** `{ type: ... }` maps the Liquid `form` tag reads (`__form_errors`, `__form_success`, `__form_values`). */
export function flashGlobals(f: Flash | null): Record<string, unknown> {
  if (!f) return {};
  return { __form_errors: { [f.type]: f.errors ?? null }, __form_success: { [f.type]: !!f.success }, __form_values: { [f.type]: f.values ?? {} } };
}
