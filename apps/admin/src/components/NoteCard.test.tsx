import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { NoteCard } from './NoteCard';
import { PaymentLogos } from './PaymentLogos';

function Harness({ initial }: { initial: string }) {
  const [note, setNote] = useState(initial);
  return <I18nProvider><NoteCard title="Notes" value={note} onSave={setNote} /></I18nProvider>;
}

// jsdom has no <dialog> modal support.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
});

describe('note card', () => {
  it('blocks edits during saving and restores the draft after failure for retry', async () => {
    const user = userEvent.setup();
    let reject!: (reason: Error) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; })).mockResolvedValueOnce(undefined);
    render(<I18nProvider><NoteCard title="Notes" value="" onSave={save} /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    const box = screen.getByRole('textbox', { name: 'Notes' });
    await user.type(box, 'Original draft');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(box).toBeDisabled();
    await user.type(box, ' lost edits');
    expect(box).toHaveValue('Original draft');
    await act(async () => { reject(new Error('Could not save')); });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(box).toBeEnabled();
    await user.type(box, ' revised');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenLastCalledWith('Original draft revised');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the note collapsed behind a plus and edits it in a dialog', async () => {
    const user = userEvent.setup();
    render(<Harness initial="" />);
    expect(screen.getByText('No notes')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    const box = await screen.findByRole('textbox', { name: 'Notes' });
    await user.type(box, 'Leave at the door');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Leave at the door')).toBeInTheDocument());
    // With a note, the button becomes a pencil.
    expect(screen.getByRole('button', { name: 'Edit note' })).toBeInTheDocument();
  });
});

describe('accepted payment methods', () => {
  it('draws the Stripe card brands and the other methods as labelled marks, and says so when there is none', () => {
    const { rerender } = render(<I18nProvider><PaymentLogos stripe brands={['visa', 'cartes_bancaires']} methods={['Bank transfer']} /></I18nProvider>);
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('aria-label'))).toEqual(['Visa', 'CB', 'Bank transfer']);
    rerender(<I18nProvider><PaymentLogos stripe={false} brands={['visa']} methods={[]} /></I18nProvider>);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getByText('No payment method is enabled yet.')).toBeInTheDocument();
  });
});
