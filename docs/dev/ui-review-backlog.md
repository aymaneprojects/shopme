# UI reference review

Use the merchant-supplied screenshots and recordings to improve ShopMe's own implementation. Follow `docs/legal/clean-room.md`; keep raw references, recordings and session data outside this repository.

## Review order

Take one reproducible issue or small visual improvement per pass. Check open pull requests and this list before starting. Add the observed trigger, change, validation and PR link to the progress section after each pass. A screenshot alone does not prove a functional bug.

- [ ] Review dropdown clipping and placement near viewport edges and inside scrollable tables.
- [ ] Compare product editor metadata selectors, scrolling and save feedback with the recordings.
- [ ] Review dialog sizing and opening/closing motion, preserving native focus and reduced-motion support.
- [ ] Review table density, action placement and long translated labels on small screens.
- [ ] Review theme editor section menus, preview switching and sidebar transitions.
- [ ] Review storefront/cart/checkout mobile layouts using synthetic local data.
- [ ] Investigate the reported Marketing error only when a failing case can be reproduced; a fresh local store currently loads successfully.
- [ ] Review original empty-state imagery for a consistent visual style.

## Progress

- #1: shared table keyboard activation, independent cell controls, disabled bulk menus and dialog labels. Admin tests/type checks/build passed.
- #2: desktop content placement, mobile sidebar behavior, language selector, button edges and stale password-reset feedback. 253 admin tests passed; Chromium checks covered layout, collapse, mobile navigation, Escape/focus restoration and language selection.
- #3: neutral light palette, charcoal controls, original ShopMe ribbon logo/favicon, section navigation and dropdown focus/keyboard behavior. 262 admin tests, type check and production build passed; Chromium checks covered desktop/mobile layout and navigation. Review PR #3 before choosing overlapping work.
- Two additional merchant recordings are queued for a later pass. One exceeds the current 32 MiB attachment transfer limit; do not claim it was inspected.

## Bounded continuation

Keep changes on review branches and draft PRs. Do not merge or deploy automatically. Prefer the smallest relevant checks, reusing prior verification where the code has not changed. Use at most two narrowly scoped agents when their work is independent. Stop after one completed, reviewable change, or early if there is no actionable evidence. Report a real usage-limit response accurately; do not estimate the user's remaining allowance. If reference files or the execution environment are unavailable, record the limitation instead of claiming a visual comparison.
