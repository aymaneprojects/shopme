import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { setDiagnostics } from '@codemirror/lint';
import type { Diagnostic } from '@codemirror/lint';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import type { Language } from '../lib/theme-files';

export interface CodeProblem { line: number; column: number; severity: 'error' | 'warning'; message: string }
export interface CodeEditorHandle {
  /** Replace the whole text (an edit the user can undo). */
  replace: (text: string) => void;
  /** Move the cursor to a line and column and scroll it into view. */
  goTo: (line: number, column?: number) => void;
  focus: () => void;
}

/** Liquid tags and outputs (`{% ... %}`, `{{ ... }}`) drawn on top of the HTML grammar. */
const LIQUID = /\{%-?[\s\S]*?-?%\}|\{\{-?[\s\S]*?-?\}\}/g;
const tag = Decoration.mark({ class: 'cm-liquid-tag' });
const out = Decoration.mark({ class: 'cm-liquid-output' });
function liquidMarks(view: EditorView): DecorationSet {
  const ranges: Array<ReturnType<typeof tag.range>> = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const m of text.matchAll(LIQUID)) ranges.push((m[0].startsWith('{%') ? tag : out).range(from + m.index!, from + m.index! + m[0].length));
  }
  return Decoration.set(ranges, true);
}
const liquidPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = liquidMarks(view); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = liquidMarks(u.view); }
}, { decorations: (v) => v.decorations });

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--color-accent)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--color-success)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--color-attention)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--color-text-muted)', fontStyle: 'italic' },
  { tag: [t.tagName, t.typeName, t.className], color: 'var(--color-info)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--color-warning)' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: 'var(--color-info)' },
  { tag: [t.punctuation, t.bracket, t.angleBracket], color: 'var(--color-text-muted)' },
  { tag: t.invalid, color: 'var(--color-critical)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--color-text)', backgroundColor: 'var(--color-bg)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', border: 'none', borderRight: '1px solid var(--color-border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-border) 35%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 28%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--color-text)' },
  '.cm-liquid-tag': { color: 'var(--color-attention)', backgroundColor: 'color-mix(in srgb, var(--color-attention) 10%, transparent)' },
  '.cm-liquid-output': { color: 'var(--color-success)', backgroundColor: 'color-mix(in srgb, var(--color-success) 10%, transparent)' },
  '.cm-tooltip': { border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' },
  '.cm-panels': { backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-warning) 30%, transparent)' },
});

const language = (lang: Language): Extension => {
  switch (lang) {
    case 'liquid': return [html({ matchClosingTags: true, autoCloseTags: true }), liquidPlugin];
    case 'html': return html();
    case 'json': return json();
    case 'css': return css();
    case 'js': return javascript();
    default: return [];
  }
};

const toDiagnostics = (view: EditorView, problems: CodeProblem[]): Diagnostic[] => {
  const doc = view.state.doc;
  return problems.map((p) => {
    const line = doc.line(Math.min(Math.max(1, p.line), doc.lines));
    const from = Math.min(line.from + Math.max(0, p.column - 1), line.to);
    return { from, to: Math.max(from, line.to), severity: p.severity, message: p.message };
  });
};

/**
 * CodeMirror 6 editor with one state per file (so every open file keeps its own cursor and undo history). Reports the text
 * on change; problems from the server are drawn as underlines and gutter marks.
 */
export function CodeEditor({ docKey, initial, lang, problems, onChange, onSave, ref, readOnly }: {
  docKey: string; initial: string; lang: Language; problems: CodeProblem[]; onChange: (text: string) => void; onSave: () => void; ref?: Ref<CodeEditorHandle>; readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const key = useRef(docKey);
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };
  const editable = useRef(new Compartment());

  const make = (text: string, l: Language): EditorState => EditorState.create({
    doc: text,
    extensions: [
      basicSetup, keymap.of([indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => { cb.current.onSave(); return true; } }]),
      language(l), syntaxHighlighting(highlight), theme,
      editable.current.of(EditorView.editable.of(!readOnly)),
      EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()); }),
    ],
  });

  useEffect(() => {
    const v = new EditorView({ state: make(initial, lang), parent: host.current! });
    view.current = v;
    return () => { v.destroy(); view.current = null; states.current.clear(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Another file: park the state of the current one and open (or create) the state of the next.
  useEffect(() => {
    const v = view.current;
    if (!v || key.current === docKey) return;
    states.current.set(key.current, v.state);
    key.current = docKey;
    v.setState(states.current.get(docKey) ?? make(initial, lang));
  }, [docKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!readOnly)) }); }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (v) v.dispatch(setDiagnostics(v.state, toDiagnostics(v, problems)));
  }, [problems, docKey]);

  useImperativeHandle(ref, () => ({
    replace: (text) => { const v = view.current; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } }); },
    goTo: (line, column = 1) => {
      const v = view.current; if (!v) return;
      const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
      const pos = Math.min(l.from + Math.max(0, column - 1), l.to);
      v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) }); v.focus();
    },
    focus: () => view.current?.focus(),
  }), []);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" data-testid="code-editor" />;
}
