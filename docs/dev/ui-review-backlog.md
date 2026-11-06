# UI reference review

Use the merchant-supplied screenshots and recordings to improve ShopMe's own implementation. Follow `docs/legal/clean-room.md`; keep raw references, recordings and session data outside this repository.

## Review order

Take one reproducible issue or small visual improvement per pass. Check open pull requests and this list before starting. Add the observed trigger, change, validation and PR link to the progress section after each pass. A screenshot alone does not prove a functional bug.

- [x] Review dropdown clipping and placement near viewport edges and inside scrollable tables. Fixed in #4; keep testing additional consumers as they change.
- [ ] Compare product editor metadata selectors, scrolling and save feedback with the recordings.
- [ ] Review dialog sizing and opening/closing motion, preserving native focus and reduced-motion support.
- [ ] Review table density, action placement and long translated labels on small screens. The shared mobile save-bar overflow is addressed separately below.
- [ ] Review theme editor section menus, preview switching and sidebar transitions.
- [ ] Review storefront/cart/checkout mobile layouts using synthetic local data.
- [ ] Investigate the reported Marketing error only when a failing case can be reproduced; a fresh local store currently loads successfully.
- [ ] Review original empty-state imagery for a consistent visual style.

## Progress

PRs #1–#4 remain open drafts as of this pass; their completed work is tracked here but has not been merged into main. Main advanced independently to `584ce9d`. The mobile save-bar pass starts from that main revision and does not include or overwrite those draft branches.

- #1: shared table keyboard activation, independent cell controls, disabled bulk menus and dialog labels. Admin tests/type checks/build passed.
- #2: desktop content placement, mobile sidebar behavior, language selector, button edges and stale password-reset feedback. 253 admin tests passed; Chromium checks covered layout, collapse, mobile navigation, Escape/focus restoration and language selection.
- #3: neutral light palette, charcoal controls, original ShopMe ribbon logo/favicon, section navigation and dropdown focus/keyboard behavior. 262 admin tests, type check and production build passed; Chromium checks covered desktop/mobile layout and navigation. Review PR #3 before choosing overlapping work.
- Recordings 3–6 are available and sampled at 0.1-second intervals. Recording 3 covers theme preview/editor controls; 4 covers analytics/content/action menus; 5 covers payment/settings and theme workspace transitions; 6 covers settings navigation and lists. These are observations of the supplied overview frames, not a complete interaction audit. Raw slices remain outside the repository.
- #4: Dropdown/Popover escape scroll-container clipping through the native popover top layer, with bounded placement and preserved modal/focus scope; refined the ShopMe S-ribbon logo for small sizes. See PR validation before overlapping work.

- #5: French unsaved-changes controls overflowed at 320/375 px (bar left edge −29 px at 320 px). The shared save bar now stays within an 8 px viewport gutter and uses a separate message row below 640 px, retaining the single-row desktop pill. Chromium checks passed in English/French at 320, 375 and 1280 px, including visible action bounds and discard/reset behavior; production build and diff check passed. No save/navigation-guard logic changed.

## Bounded continuation

Keep changes on review branches and draft PRs. Do not merge or deploy automatically. Prefer the smallest relevant checks, reusing prior verification where the code has not changed. Use at most two narrowly scoped agents when their work is independent. Stop after one completed, reviewable change, or early if there is no actionable evidence. Report a real usage-limit response accurately; do not estimate the user's remaining allowance. If reference files or the execution environment are unavailable, record the limitation instead of claiming a visual comparison.
