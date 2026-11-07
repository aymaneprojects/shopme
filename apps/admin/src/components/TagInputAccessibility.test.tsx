import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TagInput } from '@shopme/ui';

function TagsSection() {
  const [tags, setTags] = useState<string[]>([]);
  return <section><h2>Tags</h2><TagInput aria-label="Tags" value={tags} onChange={setTags} /></section>;
}

describe('TagInput accessible names', () => {
  it('names an input beneath an external heading and preserves tag editing', async () => {
    const user = userEvent.setup();
    render(<TagsSection />);
    const input = screen.getByRole('combobox', { name: 'Tags' });
    await user.type(input, 'priority{Enter}');
    expect(screen.getByRole('button', { name: 'Remove priority' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove priority' }));
    expect(screen.queryByRole('button', { name: 'Remove priority' })).not.toBeInTheDocument();
  });

  it('keeps the visible label associated with the input', () => {
    render(<TagInput label="Tags" value={[]} onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Tags' })).toBe(screen.getByLabelText('Tags'));
  });
});
