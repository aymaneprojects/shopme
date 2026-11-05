import { createEngine, Theme } from '@shopme/liquid-compat';

export interface ThemeDiagnostic { filename: string; line: number; column: number; severity: 'error' | 'warning'; message: string }

let engine: ReturnType<typeof createEngine> | undefined;
const liquid = () => (engine ??= createEngine(new Theme(new Map())));

const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;
/** `{% schema %}` and `{% doc %}` bodies are JSON and documentation, not Liquid: blank them like the renderer does. */
const blankBodies = (src: string) => src.replace(/(\{%-?\s*(schema|doc)\s*-?%\})[\s\S]*?(\{%-?\s*end\2\s*-?%\})/g, (m, open: string, _n: string, close: string) => open + m.slice(open.length, m.length - close.length).replace(/[^\n]/g, ' ') + close);

const lineCol = (text: string, offset: number): [number, number] => {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const line = before.split('\n').length;
  return [line, offset - (before.lastIndexOf('\n') + 1) + 1];
};

/** Where the JSON text stops being valid: the shortest prefix whose error is not just "the text ended too early". */
function errorOffset(json: string): number {
  const early = (n: number) => { try { JSON.parse(json.slice(0, n)); return false; } catch (e) { return /end of JSON|Unterminated|Expected|unexpected end/i.test(String((e as Error).message)) && !/Unexpected token/.test(String((e as Error).message)); } };
  let lo = 0; let hi = json.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (early(mid)) lo = mid + 1; else hi = mid; }
  return Math.max(0, lo - 1);
}

function jsonDiagnostic(filename: string, text: string, body: string, offset: number): ThemeDiagnostic[] {
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/^(\s*)\/\/.*$/gm, (c) => c.replace(/[^\n]/g, ' '));
  try { JSON.parse(clean); return []; } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const at = /position (\d+)/.exec(msg);
    const [line, column] = lineCol(text, offset + (at ? Number(at[1]) : errorOffset(clean)));
    return [{ filename, line, column, severity: 'error', message: `Invalid JSON: ${msg.split('\n')[0]!.replace(/ in JSON at position \d+.*$/, '')}` }];
  }
}

/** Check a text theme file: JSON syntax for `.json`, Liquid syntax (and the JSON of a section's schema) for `.liquid`. Other types are never rejected. */
export function lintThemeFile(filename: string, text: string): ThemeDiagnostic[] {
  if (filename.endsWith('.json')) return jsonDiagnostic(filename, text, text, 0);
  if (!filename.endsWith('.liquid')) return [];
  const out: ThemeDiagnostic[] = [];
  try { liquid().parse(blankBodies(text), filename); } catch (e) {
    const err = e as { message?: string; token?: { begin?: number }; line?: number; col?: number };
    const msg = String(err.message ?? e).split('\n')[0]!;
    const m = /line:(\d+), col:(\d+)/.exec(String(err.message ?? ''));
    const [line, column] = m ? [Number(m[1]), Number(m[2])] : typeof err.token?.begin === 'number' ? lineCol(text, err.token.begin) : [err.line ?? 1, err.col ?? 1];
    const message = msg.replace(/,\s*line:\d+, col:\d+$/, '');
    // A tag this engine does not implement is reported, but does not stop a save: the file may come from a theme written for another engine.
    out.push({ filename, line, column, severity: /tag ".*" not found/.test(message) ? 'warning' : 'error', message });
  }
  const schema = SCHEMA_RE.exec(text);
  if (schema) out.push(...jsonDiagnostic(filename, text, schema[1]!, schema.index + schema[0].indexOf(schema[1]!)).map((d) => ({ ...d, message: d.message.replace('Invalid JSON', 'Invalid JSON in {% schema %}') })));
  return out;
}

/** The first blocking problem of each file, as the text of an API error. */
export function blockingProblems(files: { filename: string; body: string }[]): { filename: string; message: string }[] {
  const out: { filename: string; message: string }[] = [];
  for (const f of files) {
    const d = lintThemeFile(f.filename, f.body).find((x) => x.severity === 'error');
    if (d) out.push({ filename: f.filename, message: `${f.filename} line ${d.line}, column ${d.column}: ${d.message}` });
  }
  return out;
}
