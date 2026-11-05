import { describe, expect, it } from 'vitest';
import { sanitizeRichHtml } from './html-sanitize';

describe('sanitizeRichHtml', () => {
  it('removes scripts, handlers and javascript urls', () => {
    const out = sanitizeRichHtml('<p onclick="x()">Hi<script>alert(1)</script><a href="javascript:alert(1)">l</a><img src=x onerror=alert(1)></p>');
    expect(out).not.toMatch(/script|onclick|onerror|javascript:/i);
    expect(out).toContain('Hi');
  });
  it('keeps formatting, lists, links and alignment', () => {
    const html = '<h2 style="text-align:center">T</h2><ul><li><strong>a</strong></li></ul><p style="color:#ff0000;text-align:right">x</p><a href="https://e.com" target="_blank">l</a>';
    const out = sanitizeRichHtml(html);
    expect(out).toContain('<h2 style="text-align:center">');
    expect(out).toContain('color:#ff0000');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('<ul><li><strong>a</strong></li></ul>');
  });
  it('keeps tables with cell attributes', () => {
    const out = sanitizeRichHtml('<table><thead><tr><th colspan="2" align="center">h</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
    expect(out).toContain('<th colspan="2" align="center">');
    expect(out).toContain('<td>1</td>');
  });
  it('drops dangerous styles', () => {
    const out = sanitizeRichHtml('<p style="background:url(javascript:x);color:expression(alert(1));position:fixed;text-align:left">x</p>');
    expect(out).toBe('<p style="text-align:left">x</p>');
  });
  it('allows only YouTube and Vimeo iframes over https', () => {
    expect(sanitizeRichHtml('<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe>')).toContain('youtube.com/embed/abc');
    expect(sanitizeRichHtml('<iframe src="https://player.vimeo.com/video/1"></iframe>')).toContain('player.vimeo.com');
    expect(sanitizeRichHtml('<iframe src="https://evil.com/x"></iframe>')).toBe('');
    expect(sanitizeRichHtml('<iframe src="http://www.youtube.com/embed/a"></iframe>')).toBe('');
    expect(sanitizeRichHtml('<iframe src="//www.youtube.com/embed/a"></iframe>')).toBe('');
    expect(sanitizeRichHtml('<iframe srcdoc="<script>1</script>" src="https://www.youtube.com.evil.com/x"></iframe>')).toBe('');
  });
  it('blocks data: and other schemes', () => {
    expect(sanitizeRichHtml('<img src="data:text/html;base64,AAA">')).not.toContain('data:');
    expect(sanitizeRichHtml('<a href="vbscript:x">a</a>')).not.toContain('vbscript');
  });
});
