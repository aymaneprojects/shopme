import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import { channelChanges, channelStates } from './Channels';
import { Combobox } from './Combobox';

const pubs = [{ id: 'gid://shopify/Publication/1', name: 'Online Store', shopmeKind: 'ONLINE_STORE' }, { id: 'gid://shopify/Publication/2', name: 'Kiosk', shopmeKind: 'CUSTOM' }];

describe('channel state of a resource', () => {
  it('starts published everywhere for a new resource and reads stored publications otherwise', () => {
    expect(channelStates(pubs, null).map((c) => c.published)).toEqual([true, true]);
    const stored = [
      { isPublished: true, publishDate: '2020-01-01T00:00:00Z', publication: { id: pubs[0]!.id, name: 'Online Store' } },
      { isPublished: true, publishDate: '2999-01-01T09:00:00Z', publication: { id: pubs[1]!.id, name: 'Kiosk' } },
    ];
    const states = channelStates(pubs, stored);
    expect(states[0]).toMatchObject({ online: true, published: true, publishDate: '' });
    expect(states[1]!.publishDate).not.toBe('');
    expect(channelStates(pubs, []).map((c) => c.published)).toEqual([false, false]);
  });

  it('turns edits into publish and unpublish calls', () => {
    const before = channelStates(pubs, [{ isPublished: true, publishDate: '2020-01-01T00:00:00Z', publication: { id: pubs[0]!.id, name: 'Online Store' } }]);
    const after = before.map((c) => (c.online ? { ...c, published: false } : { ...c, published: true, publishDate: '2999-05-05T10:00' }));
    const { publish, unpublish } = channelChanges(before, after);
    expect(unpublish).toEqual([{ publicationId: pubs[0]!.id }]);
    expect(publish).toHaveLength(1);
    expect(publish[0]).toMatchObject({ publicationId: pubs[1]!.id });
    expect(publish[0]!.publishDate).toMatch(/^2999-05-05T/);
    expect(channelChanges(before, before)).toEqual({ publish: [], unpublish: [] });
  });
});

function Harness({ options }: { options: string[] }) {
  const [v, setV] = useState('');
  return <><Combobox id="vendor" value={v} onChange={setV} options={options} placeholder="none" /><output data-testid="out">{v}</output></>;
}

describe('Combobox', () => {
  it('lists existing values, filters while typing and offers to use a new one', async () => {
    const user = userEvent.setup();
    render(<I18nProvider><Harness options={['Acme', 'Globex', 'Acme Labs']} /></I18nProvider>);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await user.type(screen.getByRole('combobox'), 'acme');
    expect(screen.getAllByRole('option')).toHaveLength(2); // Acme and Acme Labs (an exact match offers no new value)
    await user.click(screen.getByRole('button', { name: 'Acme Labs' }));
    expect(screen.getByTestId('out').textContent).toBe('Acme Labs');
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'Zed');
    expect(screen.getByRole('button', { name: /Zed/ })).toBeTruthy();
  });
});
