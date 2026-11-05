// One undo/redo history for the whole theme editor session: section templates (any template visited) and theme settings.
// The history holds only what the merchant touched; untouched files come from the server.
import type { SettingValue } from './settings-schema';
import type { Template } from './theme-template';

export interface Overrides { docs: Record<string, Template>; settings: Record<string, SettingValue> }
export const NO_OVERRIDES: Overrides = { docs: {}, settings: {} };

export type SessionAction =
  | { kind: 'doc'; file: string; doc: Template; at: number; tag?: string }
  | { kind: 'setting'; id: string; value: SettingValue; at: number }
  | { kind: 'undo' } | { kind: 'redo' } | { kind: 'reset' };

export interface Session { past: Overrides[]; present: Overrides; future: Overrides[]; tag?: string; at?: number }
export const emptySession = (): Session => ({ past: [], present: NO_OVERRIDES, future: [] });

const COALESCE_MS = 900;
const LIMIT = 100;

/** History reducer: consecutive edits of the same field within a moment (typing, dragging a slider) form one undo step. */
export function sessionReducer(s: Session, a: SessionAction): Session {
  switch (a.kind) {
    case 'reset': return emptySession();
    case 'undo': return s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1]!, future: [s.present, ...s.future] } : s;
    case 'redo': return s.future.length ? { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) } : s;
    case 'doc': case 'setting': {
      const tag = a.kind === 'doc' ? a.tag : `setting:${a.id}`;
      let present: Overrides;
      if (a.kind === 'doc') present = s.present.docs[a.file] === a.doc ? s.present : { ...s.present, docs: { ...s.present.docs, [a.file]: a.doc } };
      else present = s.present.settings[a.id] === a.value ? s.present : { ...s.present, settings: { ...s.present.settings, [a.id]: a.value } };
      if (present === s.present) return s;
      if (tag && s.tag === tag && s.at !== undefined && a.at - s.at < COALESCE_MS && s.past.length) return { ...s, present, future: [], at: a.at };
      return { past: [...s.past, s.present].slice(-LIMIT), present, future: [], tag, at: a.at };
    }
  }
}

/** Files whose edited template differs from the stored one. */
export function changedDocs(base: Record<string, Template>, o: Overrides): string[] {
  return Object.keys(o.docs).filter((f) => JSON.stringify(o.docs[f]) !== JSON.stringify(base[f]));
}

/** Settings whose edited value differs from the stored one. */
export function changedSettings(base: Record<string, SettingValue>, o: Overrides): string[] {
  return Object.keys(o.settings).filter((k) => o.settings[k] !== base[k]);
}
