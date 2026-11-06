import type { Key } from '../i18n';

/** Pages of the checkout and customer accounts editor, in the page selector's order. */
export type EditorPage = 'checkout' | 'thank-you' | 'login' | 'orders' | 'order' | 'profile';

export const EDITOR_GROUPS: Array<{ id: 'checkout' | 'postPurchase' | 'accounts'; label: Key; pages: EditorPage[] }> = [
  { id: 'checkout', label: 'ckeditor.group.checkout', pages: ['checkout'] },
  { id: 'postPurchase', label: 'ckeditor.group.postPurchase', pages: ['thank-you'] },
  { id: 'accounts', label: 'ckeditor.group.accounts', pages: ['login', 'orders', 'order', 'profile'] },
];

/** The theme template of each customer account page (the live theme's own sections are edited there). */
export const ACCOUNT_TEMPLATE: Partial<Record<EditorPage, string>> = {
  login: 'customers/login', orders: 'customers/account', order: 'customers/order', profile: 'customers/addresses',
};

export const isEditorPage = (v: unknown): v is EditorPage => typeof v === 'string' && EDITOR_GROUPS.some((g) => (g.pages as string[]).includes(v));
export const pageOfTemplate = (template: string): EditorPage | null => (Object.entries(ACCOUNT_TEMPLATE).find(([, t]) => t === template.split('.')[0])?.[0] as EditorPage | undefined) ?? null;
export const isAccountPage = (p: EditorPage) => p in ACCOUNT_TEMPLATE;

/** A block of the left panel. `preview` is the `data-co` name of the block in the live preview (outlined when picked). */
export interface TreeNode { id: string; label: Key; icon: 'logo' | 'link' | 'user' | 'truck' | 'card' | 'action' | 'cart' | 'tag' | 'total' | 'policy' | 'check' | 'info' | 'sub'; preview?: string; children?: TreeNode[] }
export interface TreeGroup { id: string; label: Key; /** The group's own settings (the chevron next to its title). */ panel?: string; preview?: string; nodes: TreeNode[] }

const node = (id: string, label: Key, icon: TreeNode['icon'], preview?: string, children?: TreeNode[]): TreeNode => ({ id, label, icon, preview, children });
const sub = (id: string, label: Key, preview?: string) => node(id, label, 'sub', preview);

export const CHECKOUT_TREE: TreeGroup[] = [
  { id: 'header', label: 'ckeditor.tree.header', panel: 'header', preview: 'header', nodes: [node('logo', 'ckeditor.tree.logo', 'logo', 'logo'), node('cartLink', 'ckeditor.tree.cartLink', 'link', 'header')] },
  { id: 'main', label: 'ckeditor.tree.main', nodes: [
    node('contact', 'ckeditor.tree.contact', 'user', 'contact', [sub('contactMethod', 'ckeditor.tree.contactMethod', 'contact')]),
    node('delivery', 'ckeditor.tree.delivery', 'truck', 'address', [sub('address', 'ckeditor.tree.address', 'address'), node('shippingMode', 'ckeditor.tree.shippingMode', 'sub', 'shipping', [sub('shippingList', 'ckeditor.tree.shippingList', 'shipping')])]),
    node('payment', 'ckeditor.tree.payment', 'card', 'payment', [sub('paymentOption', 'ckeditor.tree.paymentOption', 'payment')]),
    node('action', 'ckeditor.tree.action', 'action', 'action', [sub('payNow', 'ckeditor.tree.payNow', 'action')]),
  ] },
  { id: 'summary', label: 'ckeditor.tree.summary', preview: 'summary', nodes: [
    node('cart', 'ckeditor.tree.cart', 'cart', 'cart', [sub('cartItems', 'ckeditor.tree.cartItems', 'cart')]),
    node('discount', 'ckeditor.tree.discounts', 'tag', 'discount', [sub('discountField', 'ckeditor.tree.discountField', 'discount')]),
    node('total', 'ckeditor.tree.total', 'total', 'total'),
  ] },
  { id: 'footer', label: 'ckeditor.tree.footer', panel: 'footer', preview: 'footer', nodes: [node('policies', 'ckeditor.tree.policies', 'policy', 'policies')] },
];

export const THANK_YOU_TREE: TreeGroup[] = [
  { id: 'header', label: 'ckeditor.tree.header', panel: 'header', preview: 'header', nodes: [node('logo', 'ckeditor.tree.logo', 'logo', 'logo')] },
  { id: 'main', label: 'ckeditor.tree.main', nodes: [
    node('confirmation', 'ckeditor.tree.confirmation', 'check', 'confirmation'),
    node('status', 'ckeditor.tree.status', 'info', 'status'),
    node('details', 'ckeditor.tree.details', 'cart', 'details', [sub('customerInfo', 'ckeditor.tree.customerInfo', 'details')]),
    node('action', 'ckeditor.tree.action', 'action', 'action'),
  ] },
  { id: 'summary', label: 'ckeditor.tree.summary', preview: 'summary', nodes: [
    node('cart', 'ckeditor.tree.cart', 'cart', 'summary', [sub('cartItems', 'ckeditor.tree.cartItems', 'cart')]),
    node('total', 'ckeditor.tree.total', 'total', 'total'),
  ] },
  { id: 'footer', label: 'ckeditor.tree.footer', panel: 'footer', preview: 'footer', nodes: [node('policies', 'ckeditor.tree.policies', 'policy', 'policies')] },
];

export const treeOf = (page: EditorPage): TreeGroup[] => (page === 'thank-you' ? THANK_YOU_TREE : CHECKOUT_TREE);

/** Every selectable block of a page (groups with settings, nodes and their children), by id. */
export function findBlock(page: EditorPage, id: string): { label: Key; preview?: string } | null {
  for (const g of treeOf(page)) {
    if (g.panel === id) return { label: g.label, preview: g.preview };
    const walk = (list: TreeNode[]): TreeNode | null => { for (const n of list) { if (n.id === id) return n; const c = n.children && walk(n.children); if (c) return c; } return null; };
    const n = walk(g.nodes);
    if (n) return { label: n.label, preview: n.preview };
  }
  return null;
}

// ---- undo / redo of the editor's draft

export interface History<T> { past: T[]; present: T; future: T[]; /** Tag and time of the last edit: edits of the same field in a row are one undo step. */ last?: { tag: string; at: number } }
export type HistoryAction<T> = { kind: 'set'; value: T; tag?: string; at: number } | { kind: 'undo' } | { kind: 'redo' } | { kind: 'reset'; value: T };

export const startHistory = <T,>(value: T): History<T> => ({ past: [], present: value, future: [] });

export function historyReducer<T>(h: History<T>, a: HistoryAction<T>): History<T> {
  switch (a.kind) {
    case 'reset': return startHistory(a.value);
    case 'undo': return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] } : h;
    case 'redo': return h.future.length ? { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) } : h;
    case 'set': {
      if (JSON.stringify(a.value) === JSON.stringify(h.present)) return h;
      const merge = a.tag && h.last?.tag === a.tag && a.at - h.last.at < 1000 && h.past.length > 0;
      return { past: merge ? h.past : [...h.past, h.present], present: a.value, future: [], last: a.tag ? { tag: a.tag, at: a.at } : undefined };
    }
  }
}
