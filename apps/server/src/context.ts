import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig, Db, DbHandle, JobQueue, Mailer, Storage, StaffUser } from '@shopme/core';
import type { LocaleCache } from './locale-cache';
import type { ServerPaths } from './paths';

/** Everything a route/service needs. Created once in buildApp and available as `app.ctx`. */
export interface AppContext {
  config: AppConfig;
  db: Db;
  dbHandle: DbHandle;
  queue: JobQueue;
  mailer: Mailer;
  storage: Storage;
  paths: ServerPaths;
  log: FastifyBaseLogger;
  locales: LocaleCache;
  /** Version string written into exports. */
  appVersion: string;
}

/** Who is calling. `scopes` contains '*' for staff sessions; api tokens carry their granted scopes. */
export type AuthInfo =
  | { kind: 'session'; shopId: number; user: StaffUser; scopes: string[]; /** The shop requires 2FA and this member has not enrolled: no API access until they do. */ needs2fa?: boolean }
  | { kind: 'token'; shopId: number; tokenId: number; scopes: string[] };

declare module 'fastify' {
  interface FastifyInstance { ctx: AppContext }
  interface FastifyRequest { auth: AuthInfo | null }
}
