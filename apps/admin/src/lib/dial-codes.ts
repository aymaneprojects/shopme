/** International dialling codes offered in the phone field of the customer form, by ISO country code. */
export const DIAL_CODES: ReadonlyArray<{ country: string; code: string }> = [
  { country: 'FR', code: '33' }, { country: 'BE', code: '32' }, { country: 'CH', code: '41' }, { country: 'LU', code: '352' }, { country: 'MC', code: '377' }, { country: 'DE', code: '49' },
  { country: 'AT', code: '43' }, { country: 'ES', code: '34' }, { country: 'PT', code: '351' }, { country: 'IT', code: '39' }, { country: 'NL', code: '31' }, { country: 'GB', code: '44' },
  { country: 'IE', code: '353' }, { country: 'DK', code: '45' }, { country: 'SE', code: '46' }, { country: 'NO', code: '47' }, { country: 'FI', code: '358' }, { country: 'IS', code: '354' },
  { country: 'PL', code: '48' }, { country: 'CZ', code: '420' }, { country: 'HU', code: '36' }, { country: 'GR', code: '30' }, { country: 'RO', code: '40' }, { country: 'BG', code: '359' },
  { country: 'HR', code: '385' }, { country: 'US', code: '1' }, { country: 'CA', code: '1' }, { country: 'MX', code: '52' }, { country: 'BR', code: '55' }, { country: 'MA', code: '212' },
  { country: 'DZ', code: '213' }, { country: 'TN', code: '216' }, { country: 'SN', code: '221' }, { country: 'CI', code: '225' }, { country: 'AE', code: '971' }, { country: 'IN', code: '91' },
  { country: 'CN', code: '86' }, { country: 'JP', code: '81' }, { country: 'KR', code: '82' }, { country: 'SG', code: '65' }, { country: 'AU', code: '61' }, { country: 'NZ', code: '64' },
];

/** The country that stands for a dial code in the select (the first one listed: `1` is US, not CA). */
const firstOf = (code: string) => DIAL_CODES.find((d) => d.code === code)?.country ?? '';

/** Split a stored phone (`+33612345678`) into a country of the dial-code select and the national part. Unknown prefixes stay in the national part. */
export function splitPhone(phone: string): { country: string; national: string } {
  const p = phone.trim();
  if (!p.startsWith('+')) return { country: '', national: p };
  const digits = p.slice(1).replace(/[^0-9]/g, '');
  const match = [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length).find((d) => digits.startsWith(d.code));
  if (!match) return { country: '', national: p };
  return { country: firstOf(match.code), national: digits.slice(match.code.length) };
}

/** Join the select and the national number into `+<code><digits>`; a leading 0 of the national number is dropped. Without a country the text is kept as typed. */
export function joinPhone(country: string, national: string): string {
  const n = national.trim();
  if (!n) return '';
  const entry = DIAL_CODES.find((d) => d.country === country);
  if (!entry || n.startsWith('+')) return n;
  const digits = n.replace(/[^0-9]/g, '').replace(/^0+/, '');
  return digits ? `+${entry.code}${digits}` : '';
}
