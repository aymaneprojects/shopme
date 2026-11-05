import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(emptyToUndef, s.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.preprocess(emptyToUndef, z.string().default('0.0.0.0')),
  PORT: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).max(65535).default(3000)),
  APP_URL: opt(z.url()),
  DATABASE_URL: opt(z.string().regex(/^postgres(ql)?:\/\//, 'must start with postgres:// or postgresql://')),
  DATA_DIR: z.preprocess(emptyToUndef, z.string().default('./data')),
  SESSION_SECRET: opt(z.string().min(32, 'must be at least 32 characters')),
  STORAGE_DIR: opt(z.string()),
  SMTP_URL: opt(z.string().regex(/^smtps?:\/\//, 'must start with smtp:// or smtps://')),
  MAIL_FROM: opt(z.string()),
  STRIPE_SECRET_KEY: opt(z.string()),
  STRIPE_PUBLISHABLE_KEY: opt(z.string()),
  STRIPE_WEBHOOK_SECRET: opt(z.string()),
  /** Extra origins allowed to POST with the session cookie (e.g. the Vite dev server). Comma separated. */
  TRUSTED_ORIGINS: opt(z.string()),
  /** Set true behind a reverse proxy (Caddy, nginx) so X-Forwarded-* headers are trusted. */
  TRUST_PROXY: z.preprocess(emptyToUndef, z.enum(['true', 'false']).default('false')),
  /** Send Strict-Transport-Security (only when APP_URL is https). */
  HSTS: z.preprocess(emptyToUndef, z.enum(['true', 'false']).default('false')),
  LOG_LEVEL: z.preprocess(emptyToUndef, z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')),
});

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  appUrl: string;
  databaseUrl?: string;
  /** Absolute. Holds pglite/, uploads/ (default) and the generated session secret. */
  dataDir: string;
  storageDir: string;
  sessionSecret: string;
  smtpUrl?: string;
  mailFrom: string;
  stripe: { secretKey?: string; publishableKey?: string; webhookSecret?: string };
  trustedOrigins: string[];
  trustProxy: boolean;
  hsts: boolean;
  logLevel: string;
}

export interface LoadConfigOptions {
  /** Base for relative DATA_DIR/STORAGE_DIR. Defaults to INIT_CWD (set by pnpm) or process.cwd(). */
  baseDir?: string;
  /** Overrides applied after env parsing (programmatic embedding, e.g. desktop app). */
  overrides?: Partial<Pick<AppConfig, 'host' | 'port' | 'appUrl' | 'dataDir' | 'storageDir' | 'databaseUrl' | 'sessionSecret'>>;
  warn?: (msg: string) => void;
}

export function loadConfig(env: Record<string, string | undefined> = process.env, opts: LoadConfigOptions = {}): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const o = opts.overrides ?? {};
  const base = path.resolve(opts.baseDir ?? env.INIT_CWD ?? process.cwd());
  const dataDir = path.resolve(base, o.dataDir ?? e.DATA_DIR);
  const storageDir = path.resolve(base, o.storageDir ?? e.STORAGE_DIR ?? path.join(dataDir, 'uploads'));
  const port = o.port ?? e.PORT;
  const warn = opts.warn ?? ((m: string) => console.warn(`[shopme] ${m}`));
  const sessionSecret = o.sessionSecret ?? e.SESSION_SECRET ?? loadOrCreateSecret(dataDir, warn);
  return {
    env: e.NODE_ENV,
    host: o.host ?? e.HOST,
    port,
    appUrl: (o.appUrl ?? e.APP_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    databaseUrl: o.databaseUrl ?? e.DATABASE_URL,
    dataDir,
    storageDir,
    sessionSecret,
    smtpUrl: e.SMTP_URL,
    mailFrom: e.MAIL_FROM ?? 'ShopMe <no-reply@localhost>',
    stripe: { secretKey: e.STRIPE_SECRET_KEY, publishableKey: e.STRIPE_PUBLISHABLE_KEY, webhookSecret: e.STRIPE_WEBHOOK_SECRET },
    trustedOrigins: (e.TRUSTED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: e.TRUST_PROXY === 'true',
    hsts: e.HSTS === 'true',
    logLevel: e.LOG_LEVEL,
  };
}

function loadOrCreateSecret(dataDir: string, warn: (m: string) => void): string {
  const file = path.join(dataDir, 'session-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
  warn(`SESSION_SECRET is not set: generated one and saved it to ${file}. Set SESSION_SECRET explicitly in production.`);
  return secret;
}
