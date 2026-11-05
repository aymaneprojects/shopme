/** Minimal streaming CSV (RFC 4180): quoted fields, doubled quotes, CRLF/LF/CR, optional UTF-8 BOM. */

type Chunk = string | Uint8Array;

/** Parse a stream of chunks into rows of fields. Blank lines are skipped. Memory use is one row. */
export async function* parseCsv(input: AsyncIterable<Chunk> | Iterable<Chunk>): AsyncGenerator<string[]> {
  const decoder = new TextDecoder('utf-8');
  let row: string[] = [];
  let field = '';
  let quoted = false; // inside quotes
  let afterQuote = false; // a closing quote was just seen (a following quote means an escaped quote)
  let started = false; // current row has content (distinguishes blank lines)
  let first = true;
  let pendingCr = false; // a "\r" ended the previous chunk: swallow a following "\n"

  function* feed(text: string): Generator<string[]> {
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (pendingCr) { pendingCr = false; if (c === '\n') continue; }
      if (quoted) {
        if (c === '"') { quoted = false; afterQuote = true; } else field += c;
        continue;
      }
      if (afterQuote && c === '"') { field += '"'; quoted = true; afterQuote = false; continue; }
      afterQuote = false;
      if (c === '"' && field === '') { quoted = true; started = true; }
      else if (c === ',') { row.push(field); field = ''; started = true; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r') pendingCr = true;
        if (started || field !== '') { row.push(field); yield row; }
        row = []; field = ''; started = false;
      } else { field += c; started = true; }
    }
  }

  for await (const chunk of input as AsyncIterable<Chunk>) {
    let text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    if (first && text) { first = false; if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); }
    yield* feed(text);
  }
  const tail = decoder.decode();
  if (tail) yield* feed(tail);
  if (started || field !== '') { row.push(field); yield row; }
}

/** Rows as objects keyed by (trimmed) header; `line` counts records (header = 1). */
export async function* parseCsvObjects(input: AsyncIterable<Chunk> | Iterable<Chunk>): AsyncGenerator<{ line: number; row: Record<string, string> }, void, undefined> {
  let header: string[] | null = null;
  let line = 0;
  for await (const fields of parseCsv(input)) {
    line++;
    if (!header) { header = fields.map((h) => h.trim()); continue; }
    const row: Record<string, string> = {};
    header.forEach((h, i) => { if (h) row[h] = fields[i] ?? ''; });
    yield { line, row };
  }
}

export function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (values: unknown[]): string => `${values.map(csvField).join(',')}\r\n`;
