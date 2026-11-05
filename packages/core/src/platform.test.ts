import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, newTotpSecret, normalizeLocale, otpauthUri, setPath, signChallenge, totpCode, verifyChallenge, verifyTotp, flattenStrings } from './services';

// RFC 6238 appendix B (SHA-1): secret "12345678901234567890"; the 6-digit codes are the last six digits of the published 8-digit ones.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpCode(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totpCode(RFC_SECRET, 1_111_111_111_000)).toBe('050471');
    expect(totpCode(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(totpCode(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });
  it('accepts one step of clock drift and nothing else', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 90_000), now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false);
  });
  it('round-trips base32 and builds an otpauth URI', () => {
    const s = newTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(otpauthUri(s, 'a@b.c', 'My Shop')).toBe(`otpauth://totp/My%20Shop%3Aa%40b.c?secret=${s}&issuer=My%20Shop&algorithm=SHA1&digits=6&period=30`);
  });
  it('encrypts the stored secret and signs login challenges', () => {
    const blob = encryptSecret('JBSWY3DPEHPK3PXP', 'key-1');
    expect(blob).not.toContain('JBSWY');
    expect(decryptSecret(blob, 'key-1')).toBe('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(blob, 'key-2')).toBeNull();
    const c = signChallenge('secret', 42);
    expect(verifyChallenge('secret', c)).toBe(42);
    expect(verifyChallenge('other', c)).toBeNull();
    expect(verifyChallenge('secret', signChallenge('secret', 42, -1))).toBeNull();
    expect(verifyChallenge('secret', c.replace(/^42/, '43'))).toBeNull();
  });
});

describe('locales and translation helpers', () => {
  it('normalises locale codes', () => {
    expect(normalizeLocale('FR')).toBe('fr');
    expect(normalizeLocale('pt_br')).toBe('pt-BR');
    expect(normalizeLocale('not a locale')).toBeNull();
  });
  it('flattens and sets nested theme strings', () => {
    expect(flattenStrings({ a: { b: 'x', c: { d: 'y' } }, e: 'z', n: 3 })).toEqual({ 'a.b': 'x', 'a.c.d': 'y', e: 'z' });
    const t: Record<string, unknown> = { a: { b: 'x' } };
    setPath(t, 'a.c.d', 'y');
    setPath(t, 'e', 'z');
    expect(t).toEqual({ a: { b: 'x', c: { d: 'y' } }, e: 'z' });
  });
});
