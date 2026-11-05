import { describe, expect, it } from 'vitest';
import { printHtml, printHtmlMany } from './print';
import type { PrintLabels, PrintableOrder } from './print';

const labels: PrintLabels = { order: 'Order', packing: 'Packing slip', invoice: 'Invoice', date: 'Date', item: 'Item', sku: 'SKU', quantity: 'Qty', price: 'Price', total: 'Total', shipTo: 'Ship to', billTo: 'Bill to', blocked: '' };
const order = (name: string): PrintableOrder => ({ name, createdAt: '2026-11-05T10:00:00Z', email: 'a@b.c', lines: [{ title: 'Candle', variantTitle: null, sku: 'C-1', quantity: 2, unitPrice: '€5', total: '€10' }], totals: [['Total', '€10']], shipping: ['Ada'], billing: ['Ada'] });

describe('printHtmlMany', () => {
  it('prints every document of every order, order by order', () => {
    const html = printHtmlMany([order('#1001'), order('#1002')], ['order', 'packing'], labels, 'en');
    expect(html.match(/<section>/g)).toHaveLength(4);
    expect(html.indexOf('Order #1001')).toBeLessThan(html.indexOf('Packing slip #1001'));
    expect(html.indexOf('Packing slip #1001')).toBeLessThan(html.indexOf('Order #1002'));
  });
  it('titles the invoice and leaves prices off the packing slip', () => {
    const html = printHtmlMany([order('#1001')], ['invoice', 'packing'], labels, 'en');
    expect(html).toContain('Invoice #1001');
    const packing = html.slice(html.indexOf('Packing slip'));
    expect(packing).not.toContain('<th class="r">Price</th>');
  });
  it('keeps the single order helper', () => expect(printHtml(order('#7'), ['order'], labels, 'en')).toContain('Order #7'));
  it('escapes what the shop owner typed', () => {
    const o = order('#1');
    o.lines[0]!.title = '<img src=x onerror=alert(1)>';
    expect(printHtmlMany([o], ['order'], labels, 'en')).not.toContain('<img');
  });
});
