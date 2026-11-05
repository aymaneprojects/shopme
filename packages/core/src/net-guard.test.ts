import { describe, expect, it } from 'vitest';
import { isPrivateAddress, resolvesToPrivate } from './services/net-guard';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '[::ffff:10.0.0.1]', '64:ff9b::7f00:1',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip.replace(/[[\]]/g, ''))).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it('refuses anything that is not an IP literal', () => {
    expect(isPrivateAddress('example.com')).toBe(true);
  });
});

describe('resolvesToPrivate', () => {
  it('judges IP literals without DNS', async () => {
    expect(await resolvesToPrivate('127.0.0.1')).toBe(true);
    expect(await resolvesToPrivate('[::1]')).toBe(true);
    expect(await resolvesToPrivate('8.8.8.8')).toBe(false);
  });

  it('resolves names and refuses ones that point inward', async () => {
    expect(await resolvesToPrivate('localhost')).toBe(true);
  });
});
