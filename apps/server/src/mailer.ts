import { createMailer, type AppConfig, type Mailer } from '@shopme/core';
import type { FastifyBaseLogger } from 'fastify';

/** `"Name" <a@b.c>` / `Name <a@b.c>` / `a@b.c` -> parts. */
export function parseAddress(v: string): { name: string | null; address: string } {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(v);
  if (m) return { name: m[1]?.trim() || null, address: m[2]!.trim() };
  return { name: null, address: v.trim() };
}

const quote = (name: string) => `"${name.replace(/["\\\r\n]/g, '')}"`;

/**
 * The installation's mailer. Single-store mode: unchanged. Multi-store mode: every store shares the SMTP account, so the
 * envelope sender stays the platform address (MAIL_FROM) and each store's sender settings become the display name and the
 * Reply-To: buyers see the store and their replies reach it, while no store can send as a domain the platform does not own.
 */
export function createPlatformMailer(config: AppConfig, log: FastifyBaseLogger): Mailer {
  const base = createMailer({ smtpUrl: config.smtpUrl, from: config.mailFrom, logger: log });
  if (!config.multiStore) return base;
  const platform = parseAddress(config.mailFrom);
  return {
    async send(m) {
      if (!m.from) return base.send(m.fromName ? { ...m, from: `${quote(m.fromName)} <${platform.address}>` } : m);
      const store = parseAddress(m.from);
      if (store.address.toLowerCase() === platform.address.toLowerCase()) return base.send(m);
      const name = store.name ?? platform.name;
      return base.send({ ...m, from: name ? `${quote(name)} <${platform.address}>` : platform.address, replyTo: m.replyTo ?? store.address });
    },
  };
}
