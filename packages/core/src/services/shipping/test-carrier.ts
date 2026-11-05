import { randomInt } from 'node:crypto';
import { CarrierError, type CarrierLabelSupport, type LabelAddress, type LabelShipment } from './carrier-types';

/**
 * The built-in test carrier: lets a store try carrier-calculated rates and the whole "buy a shipping label" flow (demo stores, tests)
 * without a carrier contract. Prices are samples, tracking numbers start with `TEST` and track nothing, and the PDF label says in large
 * letters that it is not valid for shipping. Nothing leaves the server.
 */
const SERVICES = {
  standard: { name: 'Test Standard', base: 490, perKg: 110, days: 3 },
  express: { name: 'Test Express', base: 990, perKg: 190, days: 1 },
} as const;
type Service = keyof typeof SERVICES;
const serviceOf = (v: string): Service | null => (v === 'standard' || v === 'express' ? v : null);
const priceOf = (s: Service, grams: number) => SERVICES[s].base + SERVICES[s].perKg * Math.max(1, Math.ceil(grams / 1000));

/** Checkout price of a test-carrier rate (minor units). */
export const testQuote = (service: string, grams: number): number => priceOf(serviceOf(service.trim().toLowerCase()) ?? 'standard', grams);

export const isTestTracking = (n: string | null | undefined) => !!n && /^TEST\d{12}$/.test(n);

export const testLabels: CarrierLabelSupport = {
  async rates(_account, shipment) {
    if (!shipment.shipTo.countryCode) throw new CarrierError('Test carrier: the shipping address has no country');
    return (Object.keys(SERVICES) as Service[]).map((s) => ({ id: `test-${s}`, service: s, name: SERVICES[s].name, price: priceOf(s, shipment.parcel.weightGrams), currency: shipment.currency, estimatedDays: SERVICES[s].days }));
  },
  async purchase(_account, shipment, rateId) {
    const s = serviceOf(rateId.replace(/^test-/, ''));
    if (!s) throw new CarrierError('Test carrier: this rate does not exist');
    if (!shipment.shipTo.countryCode) throw new CarrierError('Test carrier: the shipping address has no country');
    const trackingNumber = `TEST${String(randomInt(0, 1e6)).padStart(6, '0')}${String(randomInt(0, 1e6)).padStart(6, '0')}`;
    const pdf = testLabelPdf({ shipment, service: SERVICES[s].name, trackingNumber, date: new Date() });
    return {
      labelId: `test_${trackingNumber.slice(4)}`, trackingNumber, trackingUrl: null, service: s, name: SERVICES[s].name, price: priceOf(s, shipment.parcel.weightGrams), currency: shipment.currency,
      label: { format: 'PDF', url: null, data: pdf.toString('base64') },
    };
  },
  async void() { return { refunded: true }; },
};

/* ------------------------------ sample PDF label ------------------------------ */

/** Text for a PDF string in WinAnsi encoding (Latin-1 range kept, anything else replaced). */
const pdfText = (s: string) => s.normalize('NFC').replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/[\\()]/g, (c) => `\\${c}`);

const addressLines = (a: LabelAddress) => [a.name, a.company, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), [a.provinceCode, a.countryCode].filter(Boolean).join(' ')].filter((x): x is string => !!x && x.trim() !== '').slice(0, 6);

/** Bars that look like a barcode, derived from the tracking number (decorative: a test label is never scanned). */
function bars(code: string, x: number, y: number, width: number, height: number): string {
  const pattern = [...code].flatMap((c) => { const n = c.charCodeAt(0); return [1 + (n % 3), 1 + ((n >> 2) % 2), 1 + ((n >> 3) % 3), 1 + ((n >> 1) % 2)]; });
  const total = pattern.reduce((a, b) => a + b, 0) + 20;
  const unit = width / total;
  let at = x + 10 * unit;
  const out: string[] = [];
  pattern.forEach((w, i) => { if (i % 2 === 0) out.push(`${at.toFixed(2)} ${y} ${(w * unit).toFixed(2)} ${height} re`); at += w * unit; });
  return `${out.join('\n')}\nf`;
}

/** A 4 x 6 inch PDF label (one page, built-in Helvetica fonts) clearly marked as a test. */
export function testLabelPdf(o: { shipment: LabelShipment; service: string; trackingNumber: string; date: Date }): Buffer {
  const W = 288; const H = 432;
  const ops: string[] = [];
  const text = (x: number, y: number, size: number, s: string, bold = false, white = false) => ops.push(`BT ${white ? '1 g' : '0 g'} /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfText(s)}) Tj ET`);
  ops.push('0 G 1.5 w 8 8 272 416 re S');
  // test banner
  ops.push('0 g 8 384 272 40 re f');
  text(18, 408, 12, 'TEST LABEL - NOT VALID FOR SHIPPING', true, true);
  text(18, 392, 9, 'Sample label from the ShopMe test carrier', false, true);
  text(18, 366, 8, 'FROM', true);
  addressLines(o.shipment.shipFrom).forEach((l, i) => text(18, 354 - i * 10, 8, l));
  ops.push('0.5 w 8 290 m 280 290 l S');
  text(18, 274, 8, 'SHIP TO', true);
  addressLines(o.shipment.shipTo).forEach((l, i) => text(18, 258 - i * 15, i === 0 ? 13 : 11, l, i === 0));
  ops.push('0.5 w 8 160 m 280 160 l S');
  text(18, 144, 10, o.service, true);
  text(18, 130, 8, `Weight: ${(o.shipment.parcel.weightGrams / 1000).toFixed(2)} kg   Ref: ${o.shipment.reference}   ${o.date.toISOString().slice(0, 10)}`);
  ops.push(bars(o.trackingNumber, 18, 62, 252, 56));
  text(Math.round((W - o.trackingNumber.length * 6.6) / 2), 46, 11, o.trackingNumber, true);
  text(18, 24, 7, 'Tracking numbers starting with TEST are fake and track nothing.');
  const content = Buffer.from(ops.join('\n'), 'latin1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let size = parts[0]!.length;
  objects.forEach((body, i) => {
    offsets.push(size);
    const chunk = body === null
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream\nendobj\n', 'latin1')])
      : Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1');
    parts.push(chunk); size += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}
