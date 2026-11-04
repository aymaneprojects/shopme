import type { Liquid } from 'liquidjs';
import type { Theme } from './theme';

export interface CompatReport {
  files: number;
  parsed: number;
  parseFailures: { file: string; error: string }[];
  unknownTags: Record<string, number>;
  unknownFilters: Record<string, number>;
}

const INNER_TAGS = new Set(['else', 'elsif', 'when', 'break', 'continue', 'endif', 'endunless', 'endcase', 'endfor', 'endcapture', 'endcomment', 'endraw', 'endform', 'endpaginate', 'endstyle', 'endschema', 'endstylesheet', 'endjavascript', 'enddoc', 'endtablerow', 'endliquid', 'endifchanged', 'endblock']);

/** Static scan: which tags/filters used by the theme's Liquid files the engine does not know, and which files fail to parse. */
export function analyzeTheme(theme: Theme, engine: Liquid): CompatReport {
  const knownTags = new Set(Object.keys(engine.tags));
  const knownFilters = new Set(Object.keys(engine.filters));
  const report: CompatReport = { files: 0, parsed: 0, parseFailures: [], unknownTags: {}, unknownFilters: {} };
  const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  for (const path of theme.paths()) {
    if (!path.endsWith('.liquid') || /^(assets|locales|config)\//.test(path)) continue;
    const src = theme.source(path)!;
    report.files++;
    try { engine.parse(src, path); report.parsed++; } catch (e) { report.parseFailures.push({ file: path, error: (e instanceof Error ? e.message : String(e)).split('\n')[0]! }); }
    // Strip raw-ish blocks, then collect tags and filters.
    const code = src.replace(/\{%-?\s*(schema|doc|comment|raw|stylesheet|javascript)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}/g, '');
    for (const m of code.matchAll(/\{%-?\s*([\s\S]*?)\s*-?%\}/g)) {
      const body = m[1]!;
      const lines = /^liquid\b/.test(body) ? body.replace(/^liquid\s*/, '').split('\n') : [body];
      let inComment = false;
      for (const line of lines) {
        const t = /^\s*([a-z_#]+)/.exec(line)?.[1];
        if (!t) continue;
        if (t === 'comment') { inComment = true; continue; }
        if (t === 'endcomment') { inComment = false; continue; }
        if (inComment || t.startsWith('#')) continue;
        if (!knownTags.has(t) && !INNER_TAGS.has(t) && !t.startsWith('end')) bump(report.unknownTags, t);
        scanFilters(line, knownFilters, (f) => bump(report.unknownFilters, f));
      }
    }
    for (const m of code.matchAll(/\{\{-?\s*([\s\S]*?)\s*-?\}\}/g)) scanFilters(m[1]!, knownFilters, (f) => bump(report.unknownFilters, f));
  }
  return report;
}

function scanFilters(expr: string, known: Set<string>, onUnknown: (f: string) => void): void {
  const noStrings = expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  for (const m of noStrings.matchAll(/\|\s*([a-z_][a-z0-9_]*)/g)) if (!known.has(m[1]!)) onUnknown(m[1]!);
}
