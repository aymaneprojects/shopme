import { describe, expect, it } from 'vitest';
import { ACCOUNT_TEMPLATE, CHECKOUT_TREE, THANK_YOU_TREE, findBlock, historyReducer, isAccountPage, isEditorPage, pageOfTemplate, startHistory, treeOf, type TreeNode } from './checkout-editor';

describe('checkout editor pages', () => {
  it('knows the pages of the selector and which ones are the theme account pages', () => {
    for (const p of ['checkout', 'thank-you', 'login', 'orders', 'order', 'profile']) expect(isEditorPage(p), p).toBe(true);
    expect(isEditorPage('cart')).toBe(false);
    expect(isEditorPage(null)).toBe(false);
    expect(['checkout', 'thank-you'].some((p) => isAccountPage(p as 'checkout'))).toBe(false);
    expect(ACCOUNT_TEMPLATE).toEqual({ login: 'customers/login', orders: 'customers/account', order: 'customers/order', profile: 'customers/addresses' });
    expect(pageOfTemplate('customers/order')).toBe('order');
    expect(pageOfTemplate('customers/addresses.alt')).toBe('profile');
    expect(pageOfTemplate('index')).toBeNull();
  });

  it('has a block tree per previewable page, with unique ids and a preview name for every block', () => {
    expect(treeOf('checkout')).toBe(CHECKOUT_TREE);
    expect(treeOf('thank-you')).toBe(THANK_YOU_TREE);
    for (const tree of [CHECKOUT_TREE, THANK_YOU_TREE]) {
      const ids: string[] = [];
      const walk = (n: TreeNode) => { ids.push(n.id); expect(n.preview, n.id).toBeTruthy(); n.children?.forEach(walk); };
      for (const g of tree) { if (g.panel) ids.push(g.panel); g.nodes.forEach(walk); }
      expect(new Set(ids).size).toBe(ids.length);
    }
    // the reference's order: header, main (contact, delivery, payment, action), order summary, footer
    expect(CHECKOUT_TREE.map((g) => g.id)).toEqual(['header', 'main', 'summary', 'footer']);
    expect(CHECKOUT_TREE[1]!.nodes.map((n) => n.id)).toEqual(['contact', 'delivery', 'payment', 'action']);
    expect(THANK_YOU_TREE[1]!.nodes.map((n) => n.id)).toEqual(['confirmation', 'status', 'details', 'action']);
  });

  it('finds a block by id, including group panels and nested blocks', () => {
    expect(findBlock('checkout', 'shippingList')).toEqual({ label: 'ckeditor.tree.shippingList', preview: 'shipping' });
    expect(findBlock('checkout', 'footer')).toEqual({ label: 'ckeditor.tree.footer', preview: 'footer' });
    expect(findBlock('thank-you', 'customerInfo')?.preview).toBe('details');
    expect(findBlock('thank-you', 'contact')).toBeNull();
  });
});

describe('undo / redo of the editor draft', () => {
  const set = (value: string, at: number, tag?: string) => ({ kind: 'set' as const, value, at, tag });
  it('undoes and redoes, and a new edit drops the redo stack', () => {
    let h = startHistory('a');
    h = historyReducer(h, set('b', 1));
    h = historyReducer(h, set('c', 2));
    expect(h.past).toEqual(['a', 'b']);
    h = historyReducer(h, { kind: 'undo' });
    expect(h.present).toBe('b');
    h = historyReducer(h, { kind: 'redo' });
    expect(h.present).toBe('c');
    h = historyReducer(h, { kind: 'undo' });
    h = historyReducer(h, set('d', 3));
    expect(h.future).toEqual([]);
    expect(h.past).toEqual(['a', 'b']);
  });

  it('ignores an edit that changes nothing, and nothing to undo or redo', () => {
    const h = startHistory({ x: 1 });
    expect(historyReducer(h, { kind: 'set', value: { x: 1 }, at: 1 })).toBe(h);
    expect(historyReducer(h, { kind: 'undo' })).toBe(h);
    expect(historyReducer(h, { kind: 'redo' })).toBe(h);
  });

  it('keeps typing in one field as one undo step', () => {
    let h = startHistory('');
    h = historyReducer(h, set('a', 100, 'logo'));
    h = historyReducer(h, set('ab', 300, 'logo'));
    h = historyReducer(h, set('abc', 500, 'logo'));
    expect(h.past).toEqual(['']);
    h = historyReducer(h, set('abcd', 2_000, 'logo')); // a pause starts a new step
    expect(h.past).toEqual(['', 'abc']);
    h = historyReducer(h, set('abcde', 2_100, 'footer')); // another field too
    expect(h.past).toEqual(['', 'abc', 'abcd']);
    expect(historyReducer(h, { kind: 'reset', value: 'z' })).toEqual(startHistory('z'));
  });
});
