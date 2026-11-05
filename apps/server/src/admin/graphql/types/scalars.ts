import { builder } from '../builder';

/** `DateTime`: ISO 8601 UTC with second precision ("2026-11-04T10:35:59Z"). */
export const formatDateTime = (v: Date | string): string => new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z');

builder.scalarType('DateTime', {
  serialize: (v) => formatDateTime(v),
  parseValue: (v) => {
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new TypeError('Invalid DateTime');
    return d;
  },
});
// `Decimal` = trailing zeros trimmed ("19.9"); `Money` = fixed decimals ("19.90"). Use @shopme/shopify-compat formatters.
builder.scalarType('Decimal', { serialize: (v) => String(v), parseValue: (v) => String(v) });
builder.scalarType('Money', { serialize: (v) => String(v), parseValue: (v) => String(v) });
builder.scalarType('UnsignedInt64', { serialize: (v) => String(v), parseValue: (v) => String(v) });
builder.scalarType('JSON', { serialize: (v) => v, parseValue: (v) => v });
builder.scalarType('URL', { serialize: (v) => String(v), parseValue: (v) => String(v) });
builder.scalarType('HTML', { serialize: (v) => String(v), parseValue: (v) => String(v) });
/** `Date`: calendar date ("2026-11-04"); parsed as UTC midnight. */
builder.scalarType('Date', {
  serialize: (v) => new Date(v).toISOString().slice(0, 10),
  parseValue: (v) => {
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new TypeError('Invalid Date');
    return d;
  },
});
