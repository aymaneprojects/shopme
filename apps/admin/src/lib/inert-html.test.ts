import { describe, expect, it } from 'vitest';
import { inertHtml } from './inert-html';

const live = (html: string) => {
  const doc = new DOMParser().parseFromString(inertHtml(html), 'text/html');
  return { doc, out: doc.documentElement.outerHTML };
};

describe('inertHtml', () => {
  it('removes script elements of every type', () => {
    const { doc, out } = live(`<html><head><script>a()</script><script type="module" src="/m.js"></script><script type="importmap">{}</script><script type="application/json">{}</script><SCRIPT SRC=x.js></SCRIPT ></head><body><p>Hi</p><script>b()</script></body></html>`);
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(out).not.toMatch(/a\(\)|b\(\)|m\.js|x\.js/);
    expect(doc.body.textContent).toContain('Hi');
  });

  it('removes an unclosed script, keeps the content before it', () => {
    const { doc } = live('<body><h1>Title</h1><script>evil()');
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(doc.querySelector('h1')?.textContent).toBe('Title');
  });

  it('removes module preloads and script preloads, keeps stylesheets and font preloads', () => {
    const { doc } = live('<head><link rel="modulepreload" href="/a.js"><link rel="preload" as="script" href="/b.js"><link rel="preload" as="font" href="/f.woff2"><link rel="stylesheet" href="/s.css"></head>');
    expect(doc.querySelectorAll('link[rel~="modulepreload"], link[as="script"]')).toHaveLength(0);
    expect(doc.querySelector('link[rel="stylesheet"]')).not.toBeNull();
    expect(doc.querySelector('link[as="font"]')).not.toBeNull();
  });

  it('strips inline event handlers and javascript: URLs, keeps normal attributes and links', () => {
    const { doc } = live(`<body onload="x()"><a href="javascript:alert(1)" onclick="y()" class="b">a</a><a href=" JaVa&#9;Script:z()">b</a><form action="javascript:q()"><button formaction="javascript:r()" onmouseover="w()">ok</button></form><a href="/products/x" data-onx="1">c</a><img src="/i.png" onerror="e()"></body>`);
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      for (const a of Array.from(el.attributes)) {
        expect(a.name.startsWith('on')).toBe(false);
        expect(/javascript:/i.test(a.value.replace(/\s/g, ''))).toBe(false);
      }
    }
    expect(doc.querySelector('a.b')).not.toBeNull();
    expect(doc.querySelector('a[href="/products/x"]')).not.toBeNull();
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('/i.png');
  });

  it('keeps the doctype and the document structure', () => {
    expect(inertHtml('<!doctype html><html lang="fr"><head><title>T</title></head><body>x</body></html>')).toMatch(/^<!DOCTYPE html><html lang="fr"><head><title>T<\/title>/i);
  });
});
