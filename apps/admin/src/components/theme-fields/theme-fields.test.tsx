import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n';
import type { SchemeSet, SettingDef } from '../../lib/settings-schema';
import { SettingField } from '../SettingField';
import { ColorSchemesField } from './ColorSchemesField';
import { SchemesContext, SourcesContext } from './context';
import { DynamicSourceButton } from './DynamicSource';

const def: SettingDef & { id: string } = {
  type: 'color_scheme_group', id: 'color_schemes',
  definition: [{ type: 'text', id: 'name', label: 'Name', default: 'Scheme' }, { type: 'color', id: 'background', label: 'Background', default: '#ffffff' }, { type: 'color', id: 'button', label: 'Button', default: '#1E40AF' }],
};
const id = (x?: string) => x ?? '';

function Schemes({ start }: { start: SchemeSet }) {
  const [v, setV] = useState(start);
  return <><ColorSchemesField def={def} label="Color schemes" optionLabel={id} value={v} onChange={setV} /><output data-testid="count">{Object.keys(v).length}</output></>;
}
const wrap = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

describe('ColorSchemesField', () => {
  const start: SchemeSet = { 'scheme-1': { settings: { name: 'Soft', background: '#eeeeee', button: '#111111' } }, 'scheme-2': { settings: { name: 'Dark', background: '#000000', button: '#ffffff' } } };

  it('adds, duplicates and deletes schemes, and edits the selected one', async () => {
    const user = userEvent.setup();
    wrap(<Schemes start={start} />);
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Add a color scheme' }));
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Duplicate this scheme' }));
    expect(screen.getByTestId('count')).toHaveTextContent('4');
    await user.click(screen.getByRole('button', { name: 'Delete this scheme' }));
    expect(screen.getByTestId('count')).toHaveTextContent('3');
    await user.click(screen.getByRole('option', { name: 'Soft' }));
    const hex = screen.getByLabelText('Background (hex)');
    await user.clear(hex); await user.type(hex, '#abcdef');
    expect(screen.getByRole('option', { name: 'Soft' }).style.background).toBe('rgb(171, 205, 239)');
  });

  it('uses one palette Tab stop and keeps Add reachable', async () => {
    const user = userEvent.setup();
    wrap(<Schemes start={start} />);
    await user.tab();
    expect(screen.getByRole('option', { name: 'Soft' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add a color scheme' })).toHaveFocus();
  });

  it('selects palettes with wrapping arrows and Home/End', async () => {
    const user = userEvent.setup();
    wrap(<Schemes start={start} />);
    screen.getByRole('option', { name: 'Soft' }).focus();
    for (const [key, name] of [['ArrowRight', 'Dark'], ['ArrowDown', 'Soft'], ['ArrowLeft', 'Dark'], ['ArrowUp', 'Soft'], ['End', 'Dark'], ['Home', 'Soft']]) {
      await user.keyboard(`{${key}}`);
      const option = screen.getByRole('option', { name });
      expect(option).toHaveFocus();
      expect(option).toHaveAttribute('aria-selected', 'true');
      expect(screen.getAllByRole('option').filter((el) => el.tabIndex === 0)).toEqual([option]);
    }
  });

  it('keeps the last scheme', async () => {
    wrap(<Schemes start={{ 'scheme-1': start['scheme-1']! }} />);
    expect(screen.getByRole('button', { name: 'Delete this scheme' })).toBeDisabled();
  });
});

describe('SettingField additions', () => {
  it('draws a segmented select as radios and reports the choice', async () => {
    const user = userEvent.setup();
    let got = '';
    const d: SettingDef & { id: string } = { type: 'select', id: 'dir', variant: 'segmented', options: [{ value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }] };
    wrap(<SettingField def={d} label="Layout direction" value="vertical" optionLabel={id} onChange={(v) => { got = String(v); }} />);
    expect(screen.getByRole('radio', { name: 'Vertical' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Horizontal' }));
    expect(got).toBe('horizontal');
  });

  it('lists the theme color schemes for a color_scheme setting, with an inherit choice when the default is empty', () => {
    const d: SettingDef & { id: string } = { type: 'color_scheme', id: 'cs', default: '' };
    wrap(<SchemesContext.Provider value={{ 'scheme-1': { settings: { name: 'Soft' } } }}><SettingField def={d} label="Color scheme" value="" optionLabel={id} onChange={() => {}} /></SchemesContext.Provider>);
    const select = screen.getByLabelText('Color scheme');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Theme colors', 'Soft']);
  });

  it('offers a button to open a link in a new tab once the field has one', () => {
    const d: SettingDef & { id: string } = { type: 'url', id: 'link' };
    const { rerender } = wrap(<SettingField def={d} label="Link" value="" optionLabel={id} onChange={() => {}} />);
    expect(screen.queryByRole('link', { name: 'Open link in a new tab' })).toBeNull();
    rerender(<I18nProvider><SettingField def={d} label="Link" value="/collections/all" optionLabel={id} onChange={() => {}} /></I18nProvider>);
    const a = screen.getByRole('link', { name: 'Open link in a new tab' });
    expect(a).toHaveAttribute('href', '/collections/all');
    expect(a).toHaveAttribute('target', '_blank');
  });

  it('clears a color whose default is empty', async () => {
    const user = userEvent.setup();
    let got: unknown = 'x';
    const d: SettingDef & { id: string } = { type: 'color', id: 'c', default: '' };
    wrap(<SettingField def={d} label="Text color" value="#ff0000" optionLabel={id} onChange={(v) => { got = v; }} />);
    await user.click(screen.getByRole('button', { name: 'Clear color' }));
    expect(got).toBe('');
  });
});

describe('DynamicSourceButton', () => {
  it('connects a source of the page to the setting and disconnects it', async () => {
    const user = userEvent.setup();
    function Host() {
      const [v, setV] = useState('Welcome to');
      return <SourcesContext.Provider value="product"><DynamicSourceButton value={v} onChange={setV} /><output data-testid="v">{v}</output></SourcesContext.Provider>;
    }
    wrap(<Host />);
    await user.click(screen.getByRole('button', { name: 'Connect dynamic source' }));
    await user.click(screen.getByRole('menuitem', { name: 'Product title' }));
    expect(screen.getByTestId('v')).toHaveTextContent('Welcome to {{ closest.product.title }}');
    await user.click(screen.getByRole('button', { name: 'Connect dynamic source' }));
    await user.click(screen.getByRole('menuitem', { name: 'Disconnect dynamic source' }));
    expect(screen.getByTestId('v').textContent?.trim()).toBe('Welcome to');
  });

  it('is not shown where a setting cannot read page data', () => {
    wrap(<DynamicSourceButton value="" onChange={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
