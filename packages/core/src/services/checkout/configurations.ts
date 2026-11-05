import { eq } from 'drizzle-orm';
import { shops } from '../../db/schema';
import type { Executor } from '../../db/client';
import { errR, okR, type Result } from '../catalog/common';
import type { Shop } from '../shops';
import { CONFIG_SCHEMAS, configOf, uniqueId, type CheckoutConfig } from '../settings/config';
import { checkoutSettingsOf, mergeCheckoutSettings, withCheckoutSettings, type CheckoutSettings, type CheckoutSettingsInput } from './settings';

/**
 * Several checkout configurations (Settings > Checkout). The configuration marked active is the one the storefront checkout uses, and
 * its values live where the checkout already reads them (`settings.checkout` for the fields, `settings.config.checkout` for the look),
 * so nothing at checkout time changes. Every other configuration is a stored snapshot in `settings.checkoutConfigs`; setting one active
 * saves the live values back into the previous active entry and makes the snapshot live.
 */
export interface CheckoutConfiguration { id: string; name: string; active: boolean; settings: CheckoutSettings; config: CheckoutConfig }

interface Stored { id: string; name: string; settings: Omit<CheckoutSettings, 'accountMode'>; config: CheckoutConfig }
interface Store { activeId: string; items: Stored[] }

const DEFAULT_ID = 'default';
const MAX_CONFIGURATIONS = 20;

const storeOf = (shop: Pick<Shop, 'settings'>): Store => {
  const raw = (shop.settings as Record<string, unknown>).checkoutConfigs as Partial<Store> | undefined;
  const items = Array.isArray(raw?.items) ? raw!.items.filter((i): i is Stored => !!i && typeof i.id === 'string' && typeof i.name === 'string') : [];
  return { activeId: typeof raw?.activeId === 'string' ? raw.activeId : DEFAULT_ID, items };
};

const stripAccount = ({ accountMode: _a, ...rest }: CheckoutSettings) => rest;

/** Every configuration; the active one first, reflecting the live values. */
export function listCheckoutConfigurations(shop: Shop): CheckoutConfiguration[] {
  const store = storeOf(shop);
  const live = checkoutSettingsOf(shop);
  const others: CheckoutConfiguration[] = store.items.filter((i) => i.id !== store.activeId).map((i) => ({
    id: i.id, name: i.name, active: false, settings: { ...live, ...i.settings, accountMode: live.accountMode }, config: CONFIG_SCHEMAS.CHECKOUT.parse(i.config ?? {}),
  }));
  const activeName = store.items.find((i) => i.id === store.activeId)?.name ?? 'Default configuration';
  return [{ id: store.activeId, name: activeName, active: true, settings: live, config: configOf(shop, 'CHECKOUT') }, ...others];
}

const fullItems = (shop: Shop): Stored[] => listCheckoutConfigurations(shop).map((c) => ({ id: c.id, name: c.name, settings: stripAccount(c.settings), config: c.config }));
const cleanName = (name: string): string => name.trim().replace(/\s+/g, ' ').slice(0, 60);

async function save(db: Executor, shop: Shop, store: Store, settings: Record<string, unknown> = shop.settings) {
  await db.update(shops).set({ settings: { ...settings, checkoutConfigs: store }, updatedAt: new Date() }).where(eq(shops.id, shop.id));
}

export async function createCheckoutConfiguration(db: Executor, shop: Shop, input: { name: string; fromId?: string | null }): Promise<Result<CheckoutConfiguration>> {
  const name = cleanName(input.name);
  if (!name) return errR(['name'], 'Name can’t be blank', 'BLANK');
  const items = fullItems(shop);
  const store = storeOf(shop);
  if (items.length >= MAX_CONFIGURATIONS) return errR(['name'], `At most ${MAX_CONFIGURATIONS} configurations`, 'TOO_LONG');
  if (items.some((i) => i.name.toLowerCase() === name.toLowerCase())) return errR(['name'], 'A configuration with this name already exists', 'TAKEN');
  const source = items.find((i) => i.id === (input.fromId ?? store.activeId));
  if (!source) return errR(['fromId'], 'Configuration not found', 'NOT_FOUND');
  const created: Stored = { id: uniqueId(name, items.map((i) => i.id)), name, settings: structuredClone(source.settings), config: structuredClone(source.config) };
  await save(db, shop, { activeId: store.activeId, items: [...items, created] });
  return okR({ id: created.id, name, active: false, settings: { ...created.settings, accountMode: checkoutSettingsOf(shop).accountMode }, config: created.config });
}

export async function renameCheckoutConfiguration(db: Executor, shop: Shop, id: string, nameInput: string): Promise<Result<{ id: string; name: string }>> {
  const name = cleanName(nameInput);
  if (!name) return errR(['name'], 'Name can’t be blank', 'BLANK');
  const items = fullItems(shop);
  const item = items.find((i) => i.id === id);
  if (!item) return errR(['id'], 'Configuration not found', 'NOT_FOUND');
  if (items.some((i) => i.id !== id && i.name.toLowerCase() === name.toLowerCase())) return errR(['name'], 'A configuration with this name already exists', 'TAKEN');
  item.name = name;
  await save(db, shop, { activeId: storeOf(shop).activeId, items });
  return okR({ id, name });
}

/** Edit a configuration: the checkout fields (and tipping) and/or the look. Editing the active one changes what the checkout uses. */
export async function updateCheckoutConfiguration(db: Executor, shop: Shop, id: string, input: { settings?: CheckoutSettingsInput; config?: unknown }): Promise<Result<CheckoutConfiguration>> {
  const store = storeOf(shop);
  const items = fullItems(shop);
  const item = items.find((i) => i.id === id);
  if (!item) return errR(['id'], 'Configuration not found', 'NOT_FOUND');
  const live = checkoutSettingsOf(shop);
  let config = item.config;
  if (input.config !== undefined) {
    const parsed = CONFIG_SCHEMAS.CHECKOUT.safeParse(input.config ?? {});
    if (!parsed.success) return errR(['config', ...parsed.error.issues[0]!.path.map(String)], parsed.error.issues[0]!.message, 'INVALID');
    config = parsed.data;
  }
  const active = id === store.activeId;
  const merged = mergeCheckoutSettings({ ...live, ...item.settings, accountMode: live.accountMode }, active ? (input.settings ?? {}) : { ...input.settings, accountMode: undefined });
  if (!merged.ok) return merged;
  item.settings = stripAccount(merged.value);
  item.config = config;
  if (active) {
    const base = withCheckoutSettings(shop, merged.value);
    await save(db, shop, { activeId: id, items }, { ...base, config: { ...((shop.settings.config ?? {}) as Record<string, unknown>), checkout: config } });
  } else await save(db, shop, { activeId: store.activeId, items });
  return okR({ id, name: item.name, active, settings: merged.value, config });
}

export async function activateCheckoutConfiguration(db: Executor, shop: Shop, id: string): Promise<Result<CheckoutConfiguration>> {
  const items = fullItems(shop);
  const target = items.find((i) => i.id === id);
  if (!target) return errR(['id'], 'Configuration not found', 'NOT_FOUND');
  const next: CheckoutSettings = { ...checkoutSettingsOf(shop), ...target.settings };
  await save(db, shop, { activeId: id, items }, { ...withCheckoutSettings(shop, next), config: { ...((shop.settings.config ?? {}) as Record<string, unknown>), checkout: target.config } });
  return okR({ id, name: target.name, active: true, settings: next, config: target.config });
}

export async function deleteCheckoutConfiguration(db: Executor, shop: Shop, id: string): Promise<Result<{ id: string }>> {
  const store = storeOf(shop);
  if (id === store.activeId) return errR(['id'], 'The active configuration can’t be deleted. Set another one active first.', 'INVALID');
  const items = fullItems(shop);
  if (!items.some((i) => i.id === id)) return errR(['id'], 'Configuration not found', 'NOT_FOUND');
  await save(db, shop, { activeId: store.activeId, items: items.filter((i) => i.id !== id) });
  return okR({ id });
}
