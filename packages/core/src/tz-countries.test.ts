import { describe, expect, it } from 'vitest';
import { countryForTimeZone, TZ_DATA_VERSION } from './services/analytics/visits';

describe('time zone to country', () => {
  it('maps the zones browsers report to ISO countries', () => {
    expect(countryForTimeZone('Europe/Paris')).toBe('FR');
    expect(countryForTimeZone('America/New_York')).toBe('US');
    expect(countryForTimeZone('America/Indiana/Indianapolis')).toBe('US');
    expect(countryForTimeZone('America/Argentina/Buenos_Aires')).toBe('AR');
    expect(countryForTimeZone('Asia/Tokyo')).toBe('JP');
    expect(countryForTimeZone('Australia/Sydney')).toBe('AU');
    expect(countryForTimeZone('Africa/Lagos')).toBe('NG');
    expect(countryForTimeZone('Europe/Vaduz')).toBe('LI');
    expect(countryForTimeZone('Europe/Busingen')).toBe('DE');
  });

  it('understands old names still reported by some browsers, and ignores case and spaces', () => {
    expect(countryForTimeZone('Asia/Calcutta')).toBe('IN');
    expect(countryForTimeZone('Asia/Saigon')).toBe('VN');
    expect(countryForTimeZone('Europe/Kiev')).toBe('UA');
    expect(countryForTimeZone('America/Buenos_Aires')).toBe('AR');
    expect(countryForTimeZone('US/Pacific')).toBe('US');
    expect(countryForTimeZone('GB')).toBe('GB');
    expect(countryForTimeZone(' europe/berlin ')).toBe('DE');
  });

  it('returns null for zones without a country and for anything else', () => {
    for (const v of ['UTC', 'Etc/UTC', 'Etc/GMT+2', 'GMT', 'Mars/Olympus', '', 'x'.repeat(200), null, undefined, 42, { tz: 'Europe/Paris' }]) expect(countryForTimeZone(v), String(v)).toBeNull();
  });

  it('records the tz database version it was built from', () => {
    expect(TZ_DATA_VERSION).toMatch(/^\d{4}[a-z]$/);
  });
});
