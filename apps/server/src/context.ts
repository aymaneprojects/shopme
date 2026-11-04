import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig, Db, DbHandle, JobQueue, Mailer, Storage, StaffUser } from '@shopme/core';
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
}

/** Who is calling. `scopes` contains '*' for staff sessions; api tokens carry their granted scopes. */
export type AuthInfo =
  | { kind: 'session'; shopId: number; user: StaffUser; scopes: string[] }
  | { kind: 'token'; shopId: number; tokenId: number; scopes: string[] };

declare module 'fastify' {
  interface FastifyInstance { ctx: AppContext }
  interface FastifyRequest { auth: AuthInfo | null }
}
