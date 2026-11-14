import type { PaymentProvider, PaymentSettings } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Read `a.b.c` from nested settings, falling back to a flat `"a.b.c"` key (the admin may store either). */
export function readSetting(settings: Record<string, unknown>, path: string): unknown {
  if (path in settings) return settings[path];
  let cur: unknown = settings;
  for (const part of path.split('.')) {
    if (!isObj(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Parse the payment keys of the shop settings. Methods are enabled unless explicitly turned off. */
export function parsePaymentSettings(settings: Record<string, unknown>): PaymentSettings {
  const bt = readSetting(settings, 'payments.manual.bankTransfer');
  const cod = readSetting(settings, 'payments.manual.cod');
  const st = readSetting(settings, 'payments.stripe');
  const pp = readSetting(settings, 'payments.paypal');
  const mo = readSetting(settings, 'payments.mollie');
  const enabled = (v: unknown) => !(isObj(v) && v.enabled === false);
  return {
    bankTransfer: { enabled: enabled(bt), instructions: isObj(bt) && typeof bt.instructions === 'string' ? bt.instructions : '' },
    cod: { enabled: enabled(cod) },
    stripe: { enabled: enabled(st) },
    paypal: { enabled: isObj(pp) && pp.enabled === true },
    mollie: { enabled: isObj(mo) && mo.enabled === true },
  };
}

/** The manual providers that are enabled. */
export function manualProviders(s: PaymentSettings): PaymentProvider[] {
  const out: PaymentProvider[] = [];
  if (s.bankTransfer.enabled) out.push({ id: 'bank_transfer', kind: 'manual', instructions: s.bankTransfer.instructions });
  if (s.cod.enabled) out.push({ id: 'cod', kind: 'manual' });
  return out;
}
