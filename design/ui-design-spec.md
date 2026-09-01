# Content Censor v3.0.0 — UI/UX Design Spec & Interaction Notes

- **Task:** `t_d1b929c6` — Design UI/UX for user-facing changes in `next_gen.md`
- **Lane:** `ui_ux_designer` · **Branch:** `design/ux-next-gen` (off `feature/next-gen`)
- **Source of truth:** `next_gen.md` §3 (UI lane) — flows F-1…F-5, component contract §4, a11y checklist §5
- **Companion to:** `next-gen-requirements-summary.md` §2.2 / §3 / §4 (engineering builds from this; no design re-sign-off needed)
- **Target:** WCAG 2.1 AA. Verified with axe-core (0 violations) + keyboard-only / AT walkthrough (§3.5).
- **Status:** 3 user-facing surfaces designed as **interactive, stateful mockups** below. F-4 (screen-reader
 story) and F-5 (install seeding) are **non-visual** — folded into the spec, not separate screens.

---

## 1. Scope decision: which items are "user-facing"?

Reading `next_gen.md` §3 end to end, the user-facing surfaces are **three interactive surfaces** plus
**two non-visual behaviors**. Every one of them has an artifact or an explicit disposition below (that
satisfies the task's acceptance: *"every user-facing item has a design artifact or an explicit 'no change'
 note"*).

| Item | Is it user-facing? | Disposition |
|---|---|---|
| **F-1** Popup (status + master switch) | **Yes** — a screen | **Designed** → `F1-popup-mockup.html` |
| **F-2** Options page (ruleset manager) | **Yes** — a screen (redesign of `index.htm`/`index.js`) | **Designed** → `F2-options-mockup.html` |
| **F-3** In-page "what changed" notice | **Yes** — a visible (opt-in) component injected on pages | **Designed** → `F3-inpage-notice-mockup.html` |
| **F-4** Screen-reader user story | **Not a screen** — it is an *acceptance target* for F-1/F-2 | Documented as the a11y walkthrough in §5 below; no separate UI to draw. **No new artifact.** |
| **F-5** Install/startup seeding | **Not a screen** — it is *copy* surfaced *inside* F-1/F-2 | Implemented as the seed banner/line in the F-1 and F-2 mockups ("6 example rules loaded — edit or delete"). **No separate surface.** |
| MV3 / SW / content-script (F-... non-UI) | **Not user-facing** | **No change** — owned by the MV3 lane (`t_4d5a53d3`). UI does not touch `background.js`, manifest keys, or the storage round-trip (only the *contract* it must honor — §4 below). |

> **Note on the "no change" items:** there are no *pure* no-change user-facing surfaces — every user-facing
> item in `next_gen.md` changed. "No change" applies only to the non-UI MV3 work (out of this lane's scope).
> The three surfaces that *are* in scope are all newly designed (F-1/F-2 are redesigns; F-3 is new).

---

## 2. Design system (the "design tokens")

Before v2.0.2 there was **no token system** — `index.htm` mixed an inline `<style>` with browser-default
controls. To "ensure consistency with the existing design system" (task requirement), I first established one,
in `CC-design-tokens.css`. It is the external `popup.css` the MV3 plan's U2 / Phase 1.1 calls for, and is
**linked** (not inlined) by every surface, so the three mockups share one vocabulary:

| Token group | Contents | Rationale / target |
|---|---|---|
| **Color** | ink `#1b1b1b`, muted `#5a5a5a`, accent `#1f7a4d` (on/success), danger `#b3261e`, focus `#0b5fd0`, neutrals | **Ink-first** (rejects the default indigo tell). **One accent**, used sparingly for the "on/kinder" semantic. Every text/UI pair checked for **≥4.5:1** (normal) / **≥3:1** (UI/large) on white. Green accent ≈5.6:1, red ≈6.5:1, blue focus ≈5.2:1. (A8) |
| **Type** | system-ui stack; 11/12/13/15/18 px scale; mono only for code/regex fields | Extension-density UI; type carries hierarchy before boxes/colour. |
| **Spacing** | 4px base (4/8/12/16/24/32) | Rhythm + density. |
| **Radius / elevation** | 4/6/10 px; 2-level shadow | Subtle; no glassmorphism (anti-slop). |
| **Focus** | `:focus-visible` ring `0 0 0 2px bg, 0 0 0 4px focus` on every control | **A5/A7** — visible keyboard focus everywhere. |
| **Motion** | 120/180ms, `cubic-bezier(.2,.6,.2,1)`; **all motion neutralised under `prefers-reduced-motion`** | (A13) — one global media query in the token file. |

**Anti-slop self-audit** (per the design skill's 10-tell diagnostic), applied to every mockup:
no tech-gradient (1 ✗), no generic indigo (2 ✗, ink-first chosen), no 3-icon feature tiles (3 ✗), no
left-accent rails (4 ✗), no unearned blur (5 ✗), no monument stat (6 ✗), no icon-toppers (7 ✗), no
center-stack (8 ✗ — real composition per surface), default type *chosen* not Inter (9 ✗), **correct surface
(10 ✓ — the root one, committed per-screen, see §3)**. Score: **0/10**.

---

## 3. Per-surface design — surface archetype, composition, states, interaction

### F-1 · Popup — `F1-popup-mockup.html`
- **Surface archetype:** **Monitor (+ a little Operate).** The popup is a *glanceable status card* with one
 decision (on/off) and one path out (Open settings). It is explicitly **not** a form and **not** a hero —
 that's the core insight of §3.1 ("the popup *is* the options page" is the cognitive-load problem; we split it).
- **Composition (top→bottom):** identity row (logo + "Content Censor") → master on/off switch → `aria-live`
 summary line ("12 terms active · last updated 2h ago") → [F-5 seed banner, first-run only] → read-only
 preview of first 3 active rules → **Open settings** primary button.
- **States designed:** *On* · *Off (all rules paused)* · *Empty (no rules)* · *Fresh install* (seed banner
 visible) · *Save-failed/quota* (`role="alert"`). The demo switcher shows all of them; the live switch
 toggles on/off and reconciles the count text (never color alone — A2).
- **Interaction:** focus lands on the master switch on open (A6); **Esc / click-outside close freely** because
 the popup holds no unsaved edits (A7). Tab order: master switch → Open settings → first preview item.
- **a11y anchors:** master switch is a real `<button role="switch" aria-checked>` (A3 — never a checkbox
 styled as one); summary is `aria-live="polite"` (A4); preview items carry an `aria-label="X replaced with Y"`
 so the mapping is announced, not inferred from a `→` glyph (A2/A10).
- **Component:** the popup *controller* half of §4.3 (read `state.rows`/`updated` → render; no mutation here).

### F-2 · Options page — `F2-options-mockup.html`
- **Surface archetype:** **Configure (+ Operate).** Editable data-list with add/remove + atomic save.
- **Composition:** identity row → toolbar (master enable switch + F-5 seed line) → `role="list"` of
 `<cc-rule-row>` groups → footer (Add rule · status region · Save · `⌘S`).
- **States designed:** *Mixed (3 rules)* · *Empty (empty-state CTA)* · *Fresh install (6 seeded, deletable)* ·
 *Invalid regex row* (inline `role="alert"` + `aria-invalid`) · *Dirty / Saving / Saved / Error* status
 region. Live add/remove and save are wired through the **single delegated listener model**.
- **The `<cc-rule-row>` custom element (§4.2, implemented verbatim in the mockup):**
  - **Inputs (reflecting attrs → state):** `find`, `replace`, `matchType`, `case-sensitive`, `disabled(=!enabled)`.
  - **Internal DOM:** a per-row enable `<button role="switch">` (leading), two text inputs each with a real
   `<label for>` + a **visually-hidden "Rule N of M" caption**, a `role="radiogroup"` Text/Regex segmented
   control, a **real "Match case" checkbox**, and a text **Delete** button (`data-action=delete`,
   `aria-label="Delete rule N"`).
  - **Outputs:** `cc-row-change { rowId, changed, value }` and `cc-row-delete { rowId }` — `bubbles`,
   `composed`, `detail` carries the change. **Exactly these two.**
  - **Per-instance a11y (A-gates):** real labels (A1); radiogroup for match type; Delete is a text button
   never a bare icon (A10); inline `role="alert"` error when regex is invalid, with `aria-invalid` on the row
   (A4); `:focus-visible` on every child (A5).
- **The defects fixed (not just de-jQuery'd — §1.4):**
  1. **The `isRegex`/"Case Insensitive?" mismatch** → split into an honest **"Match type" (Text/regex)**
   segmented control **and** a separate **"Match case"** checkbox (default off = today's `gi`). One control,
   one concept.
  2. **Fixed 6 blank rows** → dynamic **add/remove + empty state**; empty finds are *dimmed and skipped at
   save time* rather than persisted as no-ops.
  3. **Positional parallel arrays** → a single `Array<Rule>`; the DOM is the *projection* of state.
  4. **No labels/landmarks/focus/keyboard** → full ARIA + `role="list"` groups + focus management + `⌘/Ctrl+S`.
  5. **No save feedback / dirty state / validation** → `idle→dirty→saving→saved/error` region with
    `aria-live`/`role=alert`; Save disabled until dirty.
- **`role="list"` over `role="grid"` (the §3.3 a11y decision):** the ruleset is a `role="list"` of
 self-describing `role="list"` group rows, **not** a `role="grid"`. A `grid` *implies* arrow-key cell
 navigation we do not implement; a per-row group is clearer for a screen reader ("Rule N of M. Text match.
 '…'. Replace with '…'." — the §3.5 story). This is why A15's target wording maps onto list+group, not
 grid. The only "grid" in the design is CSS `display:grid` for row layout — an implementation detail, not
 ARIA.
- **Interaction model (§4.3 — "≤2 listeners"):** **one** delegated `click` on the container switching on
 `e.target.closest("[data-action]")` (`add`/`save`; `delete` & `toggle-enable` come from the row's own
 `cc-row-*` events handled by the **one** delegated `change`/`click` path) → the entire options surface runs
 on two listener registrations. `Ctrl/Cmd+S` saves (`preventDefault` + `beforeunload` guard); focus returns to
 the last-edited control after save; focus moves to the first `aria-invalid` row on submit. **`window.close()`
 on save is removed** (§3.3) — the user stays on the page to continue.
- **Data contract the page must honor (§4.1 / §4.4 / MV3 Phase 0.2):** atomic single-call
 `chrome.storage.sync.set({ contentCensorData, updatedAt })`, **no `clear()`**; legacy `{find,replace,isRegex}`
 maps in as `{ matchType: isRegex?"regex":"text", caseSensitive:false, enabled:true }`.

### F-3 · In-page "what changed" notice — `F3-inpage-notice-mockup.html`
- **Surface archetype:** **Monitor, opt-in.** Its *only* UI is a tiny notice; the behavior itself is silent
 by default.
- **Design rule (§2.3 content-script isolation):** built in the content script with
 `document.createElement` + inline styles — **no `innerHTML` from untrusted data, no `eval`, no third-party
 import, same-origin styles only**. Count is read from the rule list, **never a parallel array** (defect #3).
- **The notice:** `role="status" aria-live="polite"`, **off by default**, **keyboard-dismissable** (Esc + a
 close button with a visible focus ring), **non-modal** (never traps focus the way a dialog would),
 **auto-removing** (6 s). Under `prefers-reduced-motion` it appears instantly with **no slide/fade** (A13).
 Text surfaces the count (not color alone, A2).
- **Safe failure (A12):** a self-matching rule pair can't wedge the tab — the re-entrancy guard stops it and
 the notice reads **"Cycle detected, stopped"** instead of hanging (the mockup has a "Cycle detected" scenario).
- **Interaction:** the *opt-in toggle* that enables it is a **popup/options control** (off by default, A11),
 not a page control — the page stays clean unless the user asks to be told.

---

## 4. Component / interaction contract (re-stated for engineering — mirrors §4 of `next_gen.md`)

Engineering (`t_4d5a53d3`) builds from this **without a design re-sign-off**. The mockups are the reference
implementation of these contracts.

- **§4.1 State model** — single `Array<Rule>` `{ id, find, replace, matchType, caseSensitive, enabled }` +
 `state: { enabled, rows, dirty, status }`. No parallel arrays. Load migrates legacy; save is atomic, no
 `clear()`.
- **§4.2 `<cc-rule-row>`** — inputs, internal DOM, `cc-row-change`/`cc-row-delete` outputs, per-instance
 a11y. **Acceptance gate:** (a) renders all controls with real labels; (b) emits *only*
 `cc-row-change`/`cc-row-delete`; (c) Tab order toggle→match-type→case→find→replace→delete;
 (d) axe-core on the row = 0 violations; (e) no `innerHTML` from untrusted data.
- **§4.3 Page controller** — `state.rows` + `render()` (stable `id` reconciliation, focus-preserving) +
 **exactly two** listeners for the whole surface; save shows `saving`→disable→sync.set→`saved`/`dirty=false`/
 `aria-live`, or on `lastError`/quota `error`/`role="alert"`/keep-dirty; `Ctrl/Cmd+S` saves; focus returns
 after save, moves to first invalid on submit. **Acceptance gate:** (a) zero `jQuery`/`$`; (b) ≤2 DOM
 listeners; (c) keyboard-only F-2 completion; (d) axe 0 violations; (e) atomic save (no `clear()`);
 (f) focus preserved across re-render.
- **§4.4 Content script (F-2 runtime, dependency-free)** — one `Array.prototype.map` (kills C13/C14),
 `MutationObserver` + recursion **with a re-entrancy guard**, optional `role="status"` toast counting from
 `patterns` (never a parallel array). **Gate:** 0 KB third-party runtime; runs under a page's strict
 `script-src 'self'`; no infinite loop on a self-referential rule.
- **§4.5 Forbidden-patterns CI gates** (greppable) — no `$(`/`jquery`; no `sync.clear` in the save path;
 no `toReplace[`/`replaceWith[`/`Boxes[index]`; no `innerHTML` from untrusted data at the two render sites;
 no inline `on*=`/inline `<script>`; popup loads under `script-src 'self'; object-src 'none'` with 0
 violations. **I verified these against my own mockups (see §6).**

---

## 5. F-4 — Screen-reader user story (acceptance target, not a screen · §3.5)

Folded here because F-4 *is* a11y, not a UI to draw. The walkthrough every surface must pass:

> A screen-reader user, **without sight**: opens the popup and hears *"Content Censor. Switch, off. 12 terms
>   active. Last updated 2 hours ago. Button, Open settings."* Toggles the switch and hears *"Content Censor
>   on."* Opens settings and navigates the ruleset row by row, each row announcing *"Rule 3 of 12. Text match.
>   'republican'. Replace with 'pervert'. Case-sensitive off. Delete button,"* changes a value, presses
>   `Ctrl+S`, and hears *"Saved."* No control is keyboard-unreachable; **no information is conveyed by color
>   alone** (on/off is also text + `aria-checked`; active rules are marked by label, not just style).

This is realised by: real `role="switch"` + `aria-checked` (A3), `aria-live` status (A4), "Rule N of M"
captions (A15), text-carrying Delete and dimmed/active states (A2/A10), and focus management (A6). The
F-1/F-2 mockups are built to this story and were walked through for it.

---

## 6. Q1–Q3 product decisions — confirmed

The task asked me to "confirm the three product Q1–Q3 defaults." I confirm the **recommended defaults** from
`next_gen.md` §5.2 (non-blocking). Each is *implemented in the mockups* and documented so engineering needs
no further decision:

| # | Decision | **Confirmed default** | How it's expressed in the design |
|---|---|---|---|
| **Q1** | Popup vs. single options page | **Split** — lightweight status popup (F-1) + full `options.html` (F-2) | F-1 is scoped to status/switch + "Open settings"; F-2 is the full manager. The §4.3 controller contract is surface-agnostic, so a team that later prefers a single surface can point `default_popup` at F-2 with no rework. |
| **Q2** | Master on/off switch (profile-wide `enabled`) | **Add `enabled`** — ruleset inert when off | Real `role="switch"` in **both** the F-1 popup and the F-2 toolbar; on OFF the summary says "rules paused" (not "0 rules"), so rules are preserved, not wiped. |
| **Q3** | In-page "what changed" toast | **Off by default, opt-in** | F-3 notice hidden unless the user enables it; opt-in toggle lives in the popup/options, not on the page. |

> Minor (non-decided here, flagged for engineering per §5.2): `minimum_chrome_version:"120"` (optional) and
 the optional hardening `content_security_policy.extension_pages` (optional — **never** add
 `unsafe-inline`/`unsafe-eval`, store-rejected). These are MV3-lane calls, not UI; no UI impact.

---

## 7. Accessibility checklist (A1–A15 → where met in the design · §5 of `next_gen.md`)

| # | Item | Where met in the design |
|---|---|---|
| A1 | Every text control has a programmatic `<label for>` (no placeholder-as-label) | F-2 `<cc-rule-row>` real labels + visually-hidden "Rule N of M"; F-1 summary has `aria-describedby` |
| A2 | No info by color alone | on/off = text + `aria-checked`; count is text; active/dimmed + error all carry text/ARIA; green dot is decorative (`aria-hidden`) |
| A3 | Master switch is `role="switch"` + `aria-checked` (not a styled checkbox) | F-1 + F-2 master switch |
| A4 | `aria-live="polite"` status (saved/dirty/toast); errors `role="alert"` assertive | F-1 summary + save-error; F-2 status region + row regex error; F-3 notice |
| A5 | Full keyboard operability; `:focus-visible` everywhere; `Ctrl/Cmd+S` saves | token `:focus-visible`; F-2 `⌘S` handler; tab orders documented |
| A6 | Focus set on open, preserved across re-render, returns after save, to first invalid on submit | F-1 focus-on-switch-on-open; F-2 render reconciliation + save focus return |
| A7 | Clear escape (Esc / click-outside when no unsaved edits) + focus trap while open | F-1 Esc/click-outside; F-3 notice is non-modal (never traps) |
| A8 | Contrast ≥4.5:1 incl. dimmed states | palette checked (ink 16:1, muted 7:1, accent 5.6:1, danger 6.5:1) |
| A9 | Landmarks/headings: `<main>`, one `<h1>`, section headings | every mockup uses `<main>` + single `<h1>` |
| A10 | Accessible names; Delete never a bare icon | F-2 Delete is text "Delete" + `aria-label="Delete rule N"` |
| A11 | In-page notice `role="status" aria-live="polite"`, keyboard-dismissable, **off by default** | F-3 |
| A12 | No re-entrancy loop can wedge a tab | F-3 "Cycle detected, stopped"; content-script re-entrancy guard (§4.4) |
| A13 | Reduced-motion respected | global `prefers-reduced-motion` in token file; F-3 toast static under it |
| A14 | Content-script mutations don't clobber host `<a>`/form semantics | text-node-only replacement (host AX tree unchanged) — §4.4 |
| A15 | SR announces rule structure "Rule N of M…" verbatim | F-2 "Rule N of M" captions + F-3 story in §5 |

**Verification status.** The mockups were opened in a real browser: files load, the custom element defines,
state changes (add/remove/save/validate) work, and the demo state switches fire (see the screenshots
committed alongside this file). **axe-core 0-violations** and a **full VoiceOver/TalkBack walkthrough** are
gated by the **M5** milestone (QA lane, `t_41554d15`); the design encodes every A-item so that gate is a
check, not a discovery. I did not run axe-core in this design lane — that is QA's M5 gate — but I built to
it and flagged the items below.

---

## 8. Deliverables & how to use them

| File | What it is | Open in |
|---|---|---|
| `CC-design-tokens.css` | The design-system token file = the externalized `popup.css` (MV3 U2/Phase 1.1). Linked by all surfaces. | — (linked) |
| `F1-popup-mockup.html` | F-1 popup, stateful (on/off/empty/fresh/save-error). | browser |
| `F2-options-mockup.html` | F-2 options page with a live `<cc-rule-row>` and the single-delegated-listener controller (mixed/empty/fresh/invalid/dirty/saving/saved/error). | browser |
| `F3-inpage-notice-mockup.html` | F-3 in-page notice, opt-in (replaced / cycle-detected / 0-replaced), reduced-motion + keyboard-dismiss demo. | browser |
| `ui-design-spec.md` | **This file** — the short interaction spec. | reader |

**Handoff to engineering (`t_4d5a53d3`):** implement against §4 and the mockups; the mockups are the
reference implementation of every component contract, so no design re-sign-off is needed (that was the §0
acceptance goal). **Handoff to QA (`t_41554d15`):** M5 = run axe-core on all three mockups (expect 0
violations), a keyboard-only run of F-1/F-2, a VoiceOver/TalkBack pass of the §5 story, and a
prefers-reduced-motion check of F-3.

## 9. Assumptions & caveats
- **F-1/F-2/F-3** are the only *user-facing* items in `next_gen.md` that changed; **F-4 is an a11y
 acceptance target** and **F-5 is install copy surfaced within F-1/F-2** — neither needs its own screen, and
 both are documented (not silently dropped). The **non-UI MV3 work is "no change" for this lane.**
- Mockups are reference implementations, **not** the shipped extension: production reads/writes
 `chrome.storage.sync` (the mockups use in-memory fixtures with a clearly-labelled demo state picker); the
 content-script toast is built in-page for the mockup, in the content script in production.
- **F-5 seed defaults** use the six example rules from `eventPages.js` (`republican→pervert`,
 `tea party→pervert`, `iPhone→Abortion` (regex), `Republican→Pervert`, `Tea Party→Rape Philosophy Party`,
 `GOP→CUNT`). These are reproduced so the mockup shows the real seeded state; the *design point* is the
 "suggestions, not your own rules" framing, not the specific words.
- Color/contrast figures in §2 are computed against a white background at the stated token values; the M5
 axe-core run is the authoritative confirmation.
