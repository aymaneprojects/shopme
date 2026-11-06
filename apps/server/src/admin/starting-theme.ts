import type { FastifyInstance } from 'fastify';
import { ensureDefaultTheme, findBundledTheme, installStartingTheme } from '@shopme/core';
import { themeRoots } from '../paths';

/** Whether `handle` names a bundled theme of this server. */
export const startingThemeExists = (app: FastifyInstance, handle: string) => !!findBundledTheme(themeRoots(app.ctx.paths), handle);

/** Install the theme a new store starts with as its published theme: the chosen bundled theme, else Aurora. */
export async function applyStartingTheme(app: FastifyInstance, shopId: number, handle?: string): Promise<void> {
  const { db, paths } = app.ctx;
  const storage = app.ctx.storageFor(shopId);
  const chosen = handle && handle !== 'aurora' ? findBundledTheme(themeRoots(paths), handle) : null;
  if (chosen) await installStartingTheme(db, storage, shopId, chosen);
  else await ensureDefaultTheme(db, shopId, paths.themeDefaultDir, storage);
}
