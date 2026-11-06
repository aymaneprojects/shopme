import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEVICE_CODE_TTL_MS, TRUSTED_DEVICE_TTL_MS, addPasskey, canCreateStores, deletePasskey, findPasskey, getAccount, getPlatformConfig, getPrimaryShop, getShop, isTrustedDevice, setAccountPassword,
  isTwoFactorEnabled, issueDeviceCode, listPasskeys, publicPasskey, renamePasskey, sendNotification, signChallenge, touchPasskey, trustedDeviceValue, verifyChallenge, verifyDeviceCode, verifyPassword,
  MAX_PASSKEYS, type Account, type StaffUser,
} from '@shopme/core';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq } from 'drizzle-orm';
import { schema } from '@shopme/core';
import { accountMember } from '../plugins/auth';

const accountsTable = schema.platformAccounts;
import { FailureLimiter } from '../plugins/rate-limit';

/**
 * Sign-in methods besides the password:
 *   GET  /admin/api/auth/methods                         what the login screen may offer (passkeys, footer links)
 *   POST /admin/api/auth/login/email-code {challenge, code, trust?}     second step on a device this account has not used yet
 *   POST /admin/api/auth/login/email-code/resend {challenge}
 *   POST /admin/api/auth/passkey/login/options, /verify {id, response} sign in with a passkey (satisfies two-step verification)
 *   GET/POST/PATCH/DELETE /admin/api/auth/passkeys       manage the signed-in account's passkeys (adding one asks for the password)
 */

const DOCS_URL = 'https://github.com/aymaneprojects/shopme/tree/main/docs';
const TRUST_COOKIE = (accountId: number) => `shopme_td_${accountId}`;
const CODE_CHALLENGE_TTL_MS = 15 * 60 * 1000;
const challengeBody = z.object({ challenge: z.string().min(10).max(200) });
const codeBody = challengeBody.extend({ code: z.string().trim().min(6).max(12), trust: z.boolean().optional() });

type LoginDeps = {
  finishLogin: (app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, account: Account, user: StaffUser | null) => Promise<unknown>;
  memberFor: (req: FastifyRequest, account: Account) => Promise<StaffUser | null>;
};

/** The relying party of passkeys: the admin host (the first one of ADMIN_HOST in multi-store mode, else the host of APP_URL). */
export function relyingParty(app: FastifyInstance): { rpID: string; origins: string[] } {
  const { config } = app.ctx;
  const base = new URL(config.appUrl);
  const rpID = config.multiStore ? config.adminHosts[0]! : base.hostname;
  const port = base.port ? `:${base.port}` : '';
  const origins = new Set<string>([base.origin]);
  if (config.multiStore) for (const h of config.adminHosts) origins.add(`${base.protocol}//${h}${port}`);
  for (const o of config.trustedOrigins) {
    try { const h = new URL(o).hostname; if (h === rpID || h.endsWith(`.${rpID}`)) origins.add(new URL(o).origin); } catch { /* ignore malformed entries */ }
  }
  return { rpID, origins: [...origins] };
}

/**
 * The e-mail code is only asked when the installation can actually deliver e-mail (its e-mail health is "ok", for the store the person
 * opens, else the platform): a fresh install, the desktop app or a broken relay must never lock people out.
 */
export async function emailCodeDeliverable(app: FastifyInstance, shopId: number | null): Promise<boolean> {
  try { return (await app.ctx.email.health(shopId)).status === 'ok'; } catch { return false; }
}

async function mailCode(app: FastifyInstance, account: Account, shopId: number | null, code: string, key: 'login_code' | 'password_reset_code' = 'login_code'): Promise<void> {
  const { db } = app.ctx;
  const shop = (shopId != null ? await getShop(db, shopId) : null) ?? (await getPrimaryShop(db));
  if (!shop) throw new Error('no store to send from');
  const fr = shop.locale.toLowerCase().startsWith('fr');
  const date = new Date().toLocaleDateString(fr ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: shop.timezone || 'UTC' });
  await sendNotification(db, app.ctx.mailer, shop, app.ctx.stores.storefrontBase(shop.id), key, account.email, { login: { code, minutes: DEVICE_CODE_TTL_MS / 60_000, date } }, { force: true });
}

/**
 * After a correct password on a device that is not trusted yet: mail a code and return the step to show, or null when the code does
 * not apply (e-mail cannot be delivered, trusted device, no store to send from).
 */
export async function emailCodeStep(app: FastifyInstance, req: FastifyRequest, account: Account, user: StaffUser | null): Promise<{ emailCodeRequired: true; challenge: string; email: string } | null> {
  if (isTrustedDevice(account, trustedCookie(req, account.id))) return null;
  const shopId = user?.shopId ?? null;
  if (!(await emailCodeDeliverable(app, shopId))) return null;
  try {
    const issued = await issueDeviceCode(app.ctx.db, account.id);
    // A code sent a moment ago is still valid: show the step without mailing again.
    if (issued.ok) await mailCode(app, account, shopId, issued.code);
  } catch (err) {
    req.log.warn({ err }, 'sign-in code could not be sent');
    return null;
  }
  return { emailCodeRequired: true, challenge: signChallenge(app.ctx.config.sessionSecret, account.id, CODE_CHALLENGE_TTL_MS), email: account.email };
}

function trustedCookie(req: FastifyRequest, accountId: number): string | null {
  const raw = req.cookies[TRUST_COOKIE(accountId)];
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  return un.valid ? un.value : null;
}

/** One-shot WebAuthn challenges (5 minutes). Held in memory: a restart only asks the person to try again. */
class ChallengeStore {
  private items = new Map<string, { challenge: string; accountId: number | null; exp: number }>();
  put(challenge: string, accountId: number | null): string {
    const now = Date.now();
    for (const [k, v] of this.items) if (v.exp < now) this.items.delete(k);
    if (this.items.size >= 5000) this.items.delete(this.items.keys().next().value as string);
    const id = randomUUID();
    this.items.set(id, { challenge, accountId, exp: now + 5 * 60_000 });
    return id;
  }
  take(id: string): { challenge: string; accountId: number | null } | null {
    const v = this.items.get(id);
    this.items.delete(id);
    return v && v.exp > Date.now() ? v : null;
  }
}

export function registerLoginMethodRoutes(app: FastifyInstance, limiter: FailureLimiter, deps: LoginDeps) {
  const { db, config } = app.ctx;
  const challenges = new ChallengeStore();
  const resendLimiter = new FailureLimiter(5, 15 * 60 * 1000);
  const tooMany = (reply: FastifyReply, key: string, l = limiter) => reply.code(429).header('retry-after', String(l.retryAfter(key))).send({ error: 'Too many failed attempts. Try again later.' });

  app.get('/admin/api/auth/methods', async () => {
    const platform = await getPlatformConfig(db);
    // Resetting a password goes through a mailed code, so it is only offered where e-mail can be delivered.
    const primary = await getPrimaryShop(db);
    return { passwordReset: await emailCodeDeliverable(app, primary?.id ?? null), passkeys: { rpId: relyingParty(app).rpID }, links: { help: platform.helpUrl ?? DOCS_URL, terms: platform.termsUrl ?? null, privacy: platform.privacyUrl ?? null } };
  });

  // ---- e-mail code ---------------------------------------------------------------------------------------------------------------

  app.post('/admin/api/auth/login/email-code', async (req, reply) => {
    const body = codeBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'A code is required' });
    const accountId = verifyChallenge(config.sessionSecret, body.data.challenge);
    if (!accountId) return reply.code(401).send({ error: 'The sign-in expired. Enter your password again.', expired: true });
    const keys = [`ip:${req.ip}`, `code:${accountId}`];
    const limited = keys.find((k) => limiter.isLimited(k));
    if (limited) return tooMany(reply, limited);
    const account = await getAccount(db, accountId);
    // An account with an authenticator app keeps that step; a mailed code never replaces it.
    if (!account?.active || (await isTwoFactorEnabled(db, accountId))) return reply.code(401).send({ error: 'Invalid code' });
    const result = await verifyDeviceCode(db, accountId, body.data.code);
    if (result === 'expired') return reply.code(401).send({ error: 'The code expired. Request a new one.', codeExpired: true });
    if (result === 'locked') { keys.forEach((k) => limiter.fail(k)); return reply.code(401).send({ error: 'Too many wrong codes. Request a new one.', codeLocked: true }); }
    if (result !== 'ok') { keys.forEach((k) => limiter.fail(k)); return reply.code(401).send({ error: 'Invalid code' }); }
    keys.forEach((k) => limiter.reset(k));
    const user = await deps.memberFor(req, account);
    if (!user && !(config.multiStore && (await canCreateStores(db, account)))) return reply.code(401).send({ error: 'Invalid code' });
    if (body.data.trust !== false) {
      reply.setCookie(TRUST_COOKIE(account.id), trustedDeviceValue(account), { path: '/', httpOnly: true, sameSite: 'lax', signed: true, maxAge: TRUSTED_DEVICE_TTL_MS / 1000, secure: config.appUrl.startsWith('https://') });
    }
    return deps.finishLogin(app, req, reply, account, user);
  });

  app.post('/admin/api/auth/login/email-code/resend', async (req, reply) => {
    const body = challengeBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'Invalid request' });
    const accountId = verifyChallenge(config.sessionSecret, body.data.challenge);
    if (!accountId) return reply.code(401).send({ error: 'The sign-in expired. Enter your password again.', expired: true });
    const keys = [`ip:${req.ip}`, `resend:${accountId}`];
    const limited = keys.find((k) => resendLimiter.isLimited(k));
    if (limited) return tooMany(reply, limited, resendLimiter);
    const account = await getAccount(db, accountId);
    if (!account?.active || (await isTwoFactorEnabled(db, accountId))) return reply.code(401).send({ error: 'The sign-in expired. Enter your password again.', expired: true });
    const issued = await issueDeviceCode(db, accountId);
    if (!issued.ok) return reply.code(429).header('retry-after', String(issued.retryAfter)).send({ error: 'Wait a moment before asking for another code.', retryAfter: issued.retryAfter });
    keys.forEach((k) => resendLimiter.fail(k));
    const member = await deps.memberFor(req, account);
    try { await mailCode(app, account, member?.shopId ?? null, issued.code); } catch (err) { req.log.warn({ err }, 'sign-in code could not be sent'); return reply.code(502).send({ error: 'The code could not be sent.' }); }
    return { ok: true, retryAfter: 30 };
  });

  // ---- forgotten password ------------------------------------------------------------------------------------------------------------

  /** Always answers the same, whether or not the e-mail belongs to an account. */
  app.post('/admin/api/auth/password/forgot', async (req, reply) => {
    const body = z.object({ email: z.string().trim().email().max(254) }).safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'A valid e-mail is required' });
    const email = body.data.email.toLowerCase();
    const keys = [`ip:${req.ip}`, `forgot:${email}`];
    const limited = keys.find((k) => resendLimiter.isLimited(k));
    if (limited) return tooMany(reply, limited, resendLimiter);
    keys.forEach((k) => resendLimiter.fail(k));
    const accounts = await db.select().from(accountsTable).where(and(eq(accountsTable.email, email), eq(accountsTable.active, true)));
    for (const account of accounts) {
      try {
        const member = await deps.memberFor(req, account);
        if (!(await emailCodeDeliverable(app, member?.shopId ?? null))) continue;
        const issued = await issueDeviceCode(db, account.id);
        if (issued.ok) await mailCode(app, account, member?.shopId ?? null, issued.code, 'password_reset_code');
      } catch (err) { req.log.warn({ err }, 'password reset code could not be sent'); }
    }
    return { ok: true };
  });

  app.post('/admin/api/auth/password/reset', async (req, reply) => {
    const body = z.object({ email: z.string().trim().email().max(254), code: z.string().trim().min(6).max(12), password: z.string().min(8).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'Invalid input' });
    const email = body.data.email.toLowerCase();
    const keys = [`ip:${req.ip}`, `reset:${email}`];
    const limited = keys.find((k) => limiter.isLimited(k));
    if (limited) return tooMany(reply, limited);
    const accounts = await db.select().from(accountsTable).where(and(eq(accountsTable.email, email), eq(accountsTable.active, true)));
    for (const account of accounts) {
      if ((await verifyDeviceCode(db, account.id, body.data.code)) === 'ok') {
        // The mailed code proves the mailbox, which is what the accounts sharing this e-mail have in common (members migrated from
        // separate stores): all of them get the new password, otherwise the one that signs in could be left on its old one.
        for (const a of accounts) await setAccountPassword(db, a.id, body.data.password);
        keys.forEach((k) => limiter.reset(k));
        return { ok: true };
      }
    }
    keys.forEach((k) => limiter.fail(k));
    return reply.code(401).send({ error: 'Invalid or expired code' });
  });

  // ---- passkey sign-in ---------------------------------------------------------------------------------------------------------------

  app.post('/admin/api/auth/passkey/login/options', async () => {
    const { rpID } = relyingParty(app);
    // Discoverable credentials: the authenticator offers the passkeys it holds for this site, so no e-mail is needed (and none is revealed).
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    return { id: challenges.put(options.challenge, null), options };
  });

  const verifyLoginBody = z.object({ id: z.string().min(10).max(80), response: z.custom<AuthenticationResponseJSON>((v) => typeof v === 'object' && v != null && typeof (v as { id?: unknown }).id === 'string') });
  app.post('/admin/api/auth/passkey/login/verify', async (req, reply) => {
    const body = verifyLoginBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'Passkey sign-in failed' });
    const key = `ip:${req.ip}`;
    if (limiter.isLimited(key)) return tooMany(reply, key);
    const stored = challenges.take(body.data.id);
    const passkey = stored ? await findPasskey(db, body.data.response.id) : null;
    const fail = () => { limiter.fail(key); return reply.code(401).send({ error: 'Passkey sign-in failed' }); };
    if (!stored || !passkey) return fail();
    const { rpID, origins } = relyingParty(app);
    let info;
    try {
      info = await verifyAuthenticationResponse({
        response: body.data.response, expectedChallenge: stored.challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: passkey.credentialId, publicKey: Buffer.from(passkey.publicKey, 'base64url'), counter: passkey.counter, transports: passkey.transports as never },
      });
    } catch (err) { req.log.info({ err }, 'passkey verification failed'); return fail(); }
    if (!info.verified) return fail();
    const account = await getAccount(db, passkey.accountId);
    const user = account?.active ? await deps.memberFor(req, account) : null;
    if (!account?.active || (!user && !(config.multiStore && (await canCreateStores(db, account))))) return fail();
    limiter.reset(key);
    await touchPasskey(db, passkey.id, info.authenticationInfo.newCounter, info.authenticationInfo.credentialBackedUp);
    // A verified passkey is phishing-resistant and user-verified (PIN, fingerprint, face): it stands in for the password, the e-mail code and two-step verification.
    return deps.finishLogin(app, req, reply, account, user);
  });

  // ---- managing passkeys ---------------------------------------------------------------------------------------------------------------

  const member = (req: FastifyRequest, reply: FastifyReply) => accountMember(req, reply);
  /** Adding a passkey creates a way in that skips every other check, so it needs the password again (like turning two-step verification off). */
  const passwordOk = async (accountId: number, password: unknown) => {
    const account = await getAccount(db, accountId);
    return !!account && typeof password === 'string' && password.length > 0 && verifyPassword(account.passwordHash, password);
  };

  app.get('/admin/api/auth/passkeys', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    return { passkeys: (await listPasskeys(db, m.accountId)).map(publicPasskey) };
  });

  app.post('/admin/api/auth/passkeys/options', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    if (!(await passwordOk(m.accountId, (req.body as { password?: unknown } | null)?.password))) return reply.code(403).send({ error: 'Incorrect password' });
    const existing = await listPasskeys(db, m.accountId);
    if (existing.length >= MAX_PASSKEYS) return reply.code(409).send({ error: `You can register up to ${MAX_PASSKEYS} passkeys` });
    const { rpID } = relyingParty(app);
    const account = (await getAccount(db, m.accountId))!;
    const options = await generateRegistrationOptions({
      rpName: 'ShopMe', rpID, userName: account.email, userDisplayName: [account.firstName, account.lastName].filter(Boolean).join(' ') || account.email,
      userID: new TextEncoder().encode(`shopme-account-${account.id}`), attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as never })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    return { id: challenges.put(options.challenge, m.accountId), options };
  });

  const registerBody = z.object({ id: z.string().min(10).max(80), name: z.string().trim().max(60).optional(), response: z.custom<RegistrationResponseJSON>((v) => typeof v === 'object' && v != null && typeof (v as { id?: unknown }).id === 'string') });
  app.post('/admin/api/auth/passkeys', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    const body = registerBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'Invalid request' });
    const stored = challenges.take(body.data.id);
    if (!stored || stored.accountId !== m.accountId) return reply.code(422).send({ error: 'The request expired. Try again.' });
    const { rpID, origins } = relyingParty(app);
    let info;
    try { info = await verifyRegistrationResponse({ response: body.data.response, expectedChallenge: stored.challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true }); }
    catch (err) { req.log.info({ err }, 'passkey registration failed'); return reply.code(422).send({ error: 'The passkey could not be verified' }); }
    if (!info.verified || !info.registrationInfo) return reply.code(422).send({ error: 'The passkey could not be verified' });
    const c = info.registrationInfo.credential;
    const row = await addPasskey(db, m.accountId, {
      credentialId: c.id, publicKey: Buffer.from(c.publicKey).toString('base64url'), counter: c.counter, transports: c.transports ?? [],
      deviceType: info.registrationInfo.credentialDeviceType, backedUp: info.registrationInfo.credentialBackedUp, name: body.data.name || 'Passkey',
    });
    if (!row) return reply.code(409).send({ error: 'This passkey is already registered' });
    return reply.code(201).send({ passkey: publicPasskey(row) });
  });

  app.patch('/admin/api/auth/passkeys/:id', async (req, reply) => {
    const m = await member(req, reply);
    const body = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!m) return;
    if (!body.success) return reply.code(422).send({ error: 'A name is required' });
    return (await renamePasskey(db, m.accountId, Number((req.params as { id: string }).id), body.data.name)) ? { ok: true } : reply.code(404).send({ error: 'Passkey not found' });
  });

  app.delete('/admin/api/auth/passkeys/:id', async (req, reply) => {
    const m = await member(req, reply);
    if (!m) return;
    return (await deletePasskey(db, m.accountId, Number((req.params as { id: string }).id))) ? { ok: true } : reply.code(404).send({ error: 'Passkey not found' });
  });
}
