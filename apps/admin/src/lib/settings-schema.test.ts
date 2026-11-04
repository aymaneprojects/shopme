import { describe, expect, it } from 'vitest';
import { buildValues, coerceValue, isInput, parseCurrent, parseDict, parseSchema, resolveLabel, serializeData } from './settings-schema';

const schema = JSON.stringify([
  { name: 'theme_info', theme_name: 'Aurora' },
  { name: 't:settings_schema.colors.name', settings: [
    { type: 'header', content: 'Palette' },
    { type: 'color', id: 'color_primary', label: 't:settings_schema.colors.primary', default: '#1E40AF' },
    { type: 'checkbox', id: 'show_vendor', label: 'Show vendor' },
  ] },
  { name: 'Layout', settings: [
    { type: 'range', id: 'page_width', label: 'Width', min: 960, max: 1600, step: 40, default: 1280 },
    { type: 'select', id: 'font', label: 'Font', options: [{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }], default: 'sans' },
    { type: 'image_picker', id: 'logo', label: 'Logo' },
  ] },
]);

describe('settings schema form generator', () => {
  const groups = parseSchema(schema);

  it('skips theme_info and keeps groups with their settings', () => {
    expect(groups.map((g) => g.name)).toEqual(['t:settings_schema.colors.name', 'Layout']);
    expect(groups[0]!.settings.filter(isInput).map((s) => s.id)).toEqual(['color_primary', 'show_vendor']);
  });

  it('returns no groups for invalid JSON', () => {
    expect(parseSchema('nope')).toEqual([]);
    expect(parseSchema('{}')).toEqual([]);
  });

  it('builds values from stored data, falling back to defaults per type', () => {
    const v = buildValues(groups, { color_primary: '#000000', page_width: 5000, font: 'mono' });
    expect(v).toEqual({ color_primary: '#000000', show_vendor: false, page_width: 1600, font: 'sans', logo: '' });
  });

  it('coerces by type', () => {
    const range = groups[1]!.settings[0]!;
    expect(coerceValue(range, '1000')).toBe(1000);
    expect(coerceValue(range, 'abc')).toBe(1280);
    expect(coerceValue(groups[0]!.settings[2]!, 'true')).toBe(true);
  });

  it('resolves t: labels with a readable fallback', () => {
    const dict = parseDict(JSON.stringify({ settings_schema: { colors: { name: 'Colors', primary: 'Primary color' } } }));
    expect(resolveLabel('t:settings_schema.colors.primary', dict)).toBe('Primary color');
    expect(resolveLabel('t:settings_schema.colors.sale_price', dict)).toBe('Sale price');
    expect(resolveLabel('Plain label', dict)).toBe('Plain label');
  });

  it('writes values into settings_data.json without losing presets', () => {
    const data = JSON.stringify({ current: { color_primary: '#fff', other: 1 }, presets: { Aurora: { color_primary: '#111' } } });
    const out = JSON.parse(serializeData(data, { color_primary: '#123456', show_vendor: true })) as Record<string, Record<string, unknown>>;
    expect(out.current).toEqual({ color_primary: '#123456', other: 1, show_vendor: true });
    expect(out.presets).toEqual({ Aurora: { color_primary: '#111' } });
    expect(parseCurrent(serializeData(undefined, { a: 1 }))).toEqual({ a: 1 });
  });
});
