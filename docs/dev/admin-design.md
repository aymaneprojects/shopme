# Admin design system

Own implementation: tokens in `packages/ui/src/tokens.css`, Tailwind bridge and component CSS in `packages/ui/src/theme.css`, React components in `packages/ui/src`. Geometry (control heights, radii, sidebar width, row height, type scale) was measured from observed screenshots of a modern commerce admin and re-expressed under our own token names; colours, icons, font choice and motion curves are ours. No third-party admin source, CSS or assets are used.

## Tokens

- **Theme**: dark navy by default (`:root`), `[data-theme="light"]` and `[data-theme="system"]` override. The account menu stores the choice in `localStorage` (`shopme.theme`).
- **Surfaces**: `--color-page` (sheet), `--color-bg` (cards), `--color-surface` (hover/inset), `--color-field` (inputs), `--color-border`, chrome via `--color-frame*`.
- **Brand**: `--color-primary` navy fill (`#1E3A8A` dark, `#1E40AF` light) with `-hover`, `-pressed`, `-top` (gradient highlight); `--color-accent` is the readable link/focus colour (`#7C9CFF` dark).
- **Status**: success, attention, warning, critical, info, each a text + subtle-background pair tuned for AA contrast; `*-fill` for solid buttons.
- **Geometry**: buttons 24 / 28 / 36 px, inputs 32 px, rows 44 px, sidebar 200 px, radii 6 / 8 / 12 px, base text 13 px, font Geist Variable.
- **Motion**: `--dur-fast` 100 ms (press, hover), `--dur` 160 ms (menus, fades), overlays 180-220 ms, curve `--ease-out`. `prefers-reduced-motion` collapses every animation and transition to ~0.

## Components

`Button` (primary, secondary, plain, critical, critical-outline, success; sm/md/lg; `icon`; `loading` keeps width), `ButtonGroup`, `SplitButton`, `Dropdown` (arrow keys), `Popover`, `Tooltip` (450 ms delay), `Modal`/`ConfirmDialog` (native dialog: focus trap, Esc), `Tabs`, `Badge` (optional status dot), `Card`/`CardSection`, `Skeleton`, `EmptyState`, `IndexTable` (hover tint, clickable rows, sticky bulk bar with "Select all N", sortable headers, skeleton rows), `ToastProvider` (bottom-centre pill, 5 s, action, error variant). Admin-only: `SaveBar` (contextual dark bar sliding over the top bar, shakes when navigation is blocked), `CommandPalette` (Ctrl/Cmd+K, uses the existing `PRODUCTS`, `ORDERS`, `CUSTOMERS` queries), route progress bar, page skeleton.

## Before / after notes

1. **Buttons.** Before: flat fills with an opacity hover. After: a gradient with a light top edge and soft shadow; pressing moves the button down 1 px and swaps in an inset shadow within 100 ms. Each variant has its own colour treatment in both themes, and the spinner replaces the label without changing the width.
2. **Shell and save bar.** Before: a white sidebar, a disabled search box, and a plain strip pinned to the top when a form was dirty. After: a navy chrome frame holding the sidebar and top bar, with the page as a rounded sheet inside it. Sub-navigation reveals under the active section, and the theme editor goes full window. The save bar slides over the top bar and shakes when the user tries to leave. The existing leave-confirmation dialog is unchanged.
3. **Feedback.** Before: toasts were static banners and tables had no loading shimmer. After: toasts are pills that slide up, menus and dialogs fade and scale in, tables show shimmering skeleton rows, and a thin progress bar runs on every route change. Selecting rows reveals a sticky bulk-action bar.

Screenshots: `docs/assets/screenshots/admin-*.png` (dark by default, `admin-product-editor-light.png` for light), regenerated with `pnpm --filter @shopme/admin screenshots`.
