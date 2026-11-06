import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { rest } from '../api';

/** Passkeys work on the host that registered them (the RP ID) and its subdomains; elsewhere the browser would refuse, so the button is hidden. */
export function passkeysUsable(rpId: string | undefined, host = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  if (!rpId || !browserSupportsWebAuthn()) return false;
  return host === rpId || host.endsWith(`.${rpId}`);
}

// ---- "Last used" badge: which method this browser signed in with last (kept per browser, never sent anywhere) -------------------------------

const LAST_KEY = 'shopme.lastSignIn';
export type SignInMethod = 'password' | 'passkey';
export function lastSignInMethod(): SignInMethod | null {
  try { const v = localStorage.getItem(LAST_KEY); return v === 'password' || v === 'passkey' ? v : null; } catch { return null; }
}
export function rememberSignInMethod(method: SignInMethod): void {
  try { localStorage.setItem(LAST_KEY, method); } catch { /* storage unavailable: the badge is only a convenience */ }
}

/** True when the person closed or refused the browser's passkey prompt (not an error worth showing). */
export const isCancelled = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError');

/** Discoverable-credential sign-in: no e-mail needed. Resolves with the same payload as a password sign-in. */
export async function signInWithPasskey<T>(): Promise<T> {
  const { id, options } = await rest<{ id: string; options: PublicKeyCredentialRequestOptionsJSON }>('/auth/passkey/login/options', { body: {} });
  const response = await startAuthentication({ optionsJSON: options });
  return rest<T>('/auth/passkey/login/verify', { body: { id, response } });
}

/** Add a passkey to the signed-in account (the password is asked again first). */
export async function registerPasskey(password: string, name: string): Promise<void> {
  const { id, options } = await rest<{ id: string; options: PublicKeyCredentialCreationOptionsJSON }>('/auth/passkeys/options', { body: { password } });
  const response = await startRegistration({ optionsJSON: options });
  await rest('/auth/passkeys', { body: { id, name, response } });
}
