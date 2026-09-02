# QA Report — Content Censor MV3 v3.0.0 (t_41554d15)

**Date:** 2026-09-01  **Branch:** `wt/t_41554d15`  **Verdict: FAIL (gate not met)**
**Ran by:** `software_quality_assurance` profile · jsdom + axe-core 4.10.2 + node:test
**Spec:** `next-gen-requirements-summary.md` · `design/ui-design-spec.md`

---

## 1. Gate verdict

| Gate | Result | Status |
|---|---|---|
| node:test suite (85 tests) | 85 pass / 0 fail | ✅ PASS |
| `npm run gates` (§4.5 forbidden-pattern gates) | 6/6 | ✅ PASS |
| `npm run check` (syntax, 14 files) | 14/14 | ✅ PASS |
| `design/gates.py` + `verify.py` + `smoke.py` | ALL PASS | ✅ PASS |
| **Zero open P0 defects** | **3 open (P0-1, P0-2, P0-3)** | ❌ **FAIL** |
| **Zero open P1 defects** | **2 open (P1-1, P1-2)** | ❌ **FAIL** |

**OVERALL: FAIL.** All *positive* test assertions pass (the implementation's
logic is correct), **but three P0 wiring defects and two P1 live-update defects
are present in the shipped pages.** Per the gate policy, the release is blocked
until five findings are resolved. These defects are invisible to the module-
isolated unit suite (Node `require`/`global` fallbacks mask them) and were
exposed only by the browser-fidelity E2E harness this task authored.

---

## 2. Defect register (the gate)

### P0 — blockers (extension is non-functional as shipped)

**P0-1 · `options.html` / `popup.html` do not load `lib/rules.js` → `storage.js` crashes**
- **Where:** `options.html`, `popup.html` (missing `<script src="lib/rules.js">`);
  `storage.js:19-21` (`var Rules = window.CCRules ? window.CCRules : require("./lib/rules.js")`).
- **Observed:** Loading `storage.js` in a browser-fidelity window (no `require`)
  throws `ReferenceError: require is not defined`. `window.CCStorage` is never
  created; the grid renders **0 rows**; the popup summary stays at its placeholder
  `"0 terms active · last updated —"`.
- **Proof:** `test/wiring.e2e.test.js` `[P0-1]`, `test/findings.e2e.test.js`
  `P0-1 [DEFECT]` — both pass, asserting the broken state.
- **Impact:** Options and popup pages are dead on load. **Blocks the entire UI.**

**P0-2 · `storage.js` references `global.chrome` (undefined in a page context)**
- **Where:** `storage.js:40` (`load`), `storage.js:82` (`save`), `storage.js:103`
  (`onChanged` wiring): `var c = global.chrome;`.
- **Observed:** In a real extension page the global object is `window`, not the
  Node `global`; `global` is `undefined` → `ReferenceError`. Works only under
  Node with `global.chrome` injected (why the unit suite passes).
- **Proof:** `test/wiring.e2e.test.js` `[P0-2]`, `test/findings.e2e.test.js`
  `P0-2 [DEFECT]`.
- **Impact:** Even with P0-1 fixed, every `load`/`save`/`onChanged` path throws.
  **Blocks persistence.**

**P0-3 · `init()` is defined but never invoked in `options.js` / `popup.js`**
- **Where:** `options.js` `init` (~L225), `popup.js` `init` (L99); neither page
  file nor the module exports any `DOMContentLoaded`/`window.onload`/`init()`
  call site. (`content.js` correctly self-runs; the two UI controllers do not.)
- **Observed:** With P0-1 & P0-2 fixed but the page "as shipped," the options
  grid renders **0 rows** and the popup summary never updates — the controller
  loads but its entry point is never called.
- **Proof:** `test/wiring.e2e.test.js` `[P0-3]`, `[P0-3b]`;
  `test/findings.e2e.test.js` `P0-3 [DEFECT]` x2. A *correctly-wired* recovery
  case (`[recovery]`) confirms the same code renders all rows once `init()` is
  called — isolating the defect to the missing call.
- **Impact:** UI renders nothing even when the script chain is repaired. **Blocks UI.**

### P1 — serious (core user journeys incomplete)

**P1-1 · `popup.js` does not wire `storage.onChanged` → no live cross-surface update**
- **Where:** `popup.js:101-105` — `init` calls `S.load(cb → render)` **once**;
  it never subscribes to `chrome.storage.onChanged`, so a rule saved in the
  options page does not refresh an already-open popup.
- **Observed:** After a second rule is written to the same store, the open
  popup's summary stays at `"1 term active"` (no re-render). `storage.js` *does*
  re-`load()` on `onChanged` (L104-111), but the *popup controller* does not
  re-`render()`.
- **Proof:** `test/cross-surface.e2e.test.js` `F-6 [P1 BUG]: popup onChanged
  handler does not re-render summary` (asserts the unchanged state).
- **Impact:** F-6 live-update promise broken for the popup surface.

**P1-2 · `content.js` does not walk pre-existing DOM on load → static text not replaced**
- **Where:** `content.js:86-103` — `applyData` calls `ensureObserver()` which
  only *observes future* mutations; there is no one-time `walk(document.body)`
  over text already present at injection.
- **Observed:** On a page with `<p>hello</p>` at injection time, the text stays
  `"hello"` — it is not replaced. Newly-added nodes *are* handled (the observer
  fires for those), so the defect is specifically the **initial snapshot**.
- **Proof:** `test/cross-surface.e2e.test.js` `F-5→F-3 [P1 BUG]` and
  `F-3 [P1 BUG]` (both assert the un-modified text).
- **Impact:** On pages that load content before the script (many SPAs / caching),
  F-3 replacement silently misses the static text. Core product behaviour incomplete.

### P2 / observations (non-gating, tracked)

- **P2-1 · `cc-rule-row` render→attribute→input sync gap (jsdom).** A row rendered
  in the full multi-row flow does not sync its `find` attribute into the inner
  `<input>` in jsdom (single-row in isolation *does* sync). The public `values`
  setter round-trips correctly, and the data contract (atomic save, no `clear`)
  holds. Likely a jsdom `attributeChangedCallback`/`connectedCallback` timing
  fidelity gap rather than a real-browser bug — to be confirmed in a real Chrome
  load. Proof: `test/findings.e2e.test.js` `P1 [DEFECT] render() does not sync
  the find attribute`.
- **P2-2 · `index.js` / `index.htm` (pre-migration MV2 files) still contain
  jQuery, `sync.clear`, and parallel arrays.** `design/gates.py` flags these in
  the *legacy* files; the new MV3 pages (`options.js`/`popup.js`) are clean and
  the §4.5 CI gates run only against the new surface. These legacy files should
  be deleted in the M-phase that retires MV2 (see M0/M1). Not gating the MV3 build.

---

## 3. Test execution summary

| Suite | Tests | Pass | Fail | Notes |
|---|---:|---:|---:|---|
| `rules.test.js` | 10 | 10 | 0 | pure rule logic (escapeRegex, buildPattern, normalize, migrate, serialize) |
| `storage.test.js` | 6 | 6 | 0 | atomic save, no-clear, migrate, quota-fail dirty |
| `background.test.js` | 3 | 3 | 0 | sync listener registration + idempotent seed |
| `content.test.js` | 5 | 5 | 0 | text/regex apply, master-off inert, A12 cycle guard, observer |
| `dom.test.js` | 6 | 6 | 0 | `<cc-rule-row>` render, radiogroup, event contract, aria-invalid, values |
| `manifest.test.js` | 8 | 8 | 0 | MV3 shape, service_worker, script chain, jQuery-free, no alarms |
| `regression.test.js` | 8 | 8 | 0 | legacy migration, matching, disabled/master inert, save filter, popup count |
| `a11y.test.js` | 10 | 10 | 0 | axe 4.10.2 on 3 mockups + token contrast + landmark/reduced-motion |
| `wiring.e2e.test.js` | 5 | 5 | 0 | **P0-1/P0-2/P0-3/P0-3b proofs + recovery** |
| `findings.e2e.test.js` | 5 | 5 | 0 | defect-documentation (asserts the broken state) |
| `options.e2e.test.js` | 7 | 7 | 0 | F-2 journeys: open, empty, core smoke, add, delete, invalid-regex, Cmd/Ctrl+S |
| `popup.e2e.test.js` | 5 | 5 | 0 | F-1 render, master toggle, Escape close, Open settings, F-3 toast opt-in |
| `cross-surface.e2e.test.js` | 6 | 6 | 0 | F-5 seed, **P1-1/P1-2 proofs**, atomic-save contract, data preservation |
| **Total (node:test)** | **85** | **85** | **0** | |
| `npm run gates` | 6 | 6 | 0 | §4.5 forbidden-pattern gates |
| `npm run check` | 14 | 14 | 0 | syntax, all JS |
| `design/gates.py` `verify.py` `smoke.py` | — | ALL | 0 | structure, a11y tokens, spec completeness |

**Note on defect-documenting tests:** `findings.e2e.test.js` and the `[P1 BUG]`
assertions are *passing* tests that assert the **broken** behaviour, so the
defect stays visible and regression-protected. The gate itself (Section 1) reads
the defect register, not the green checkmarks.

---

## 4. Requirement coverage (F-1…F-6, A1…A15, M0…M5)

### Features

| Req | Description | Status | Evidence |
|---|---|---|---|
| F-1 | Popup: glanceable status + master switch + summary + Open settings + preview | ⚠️ PARTIAL | `popup.e2e` 5/5 (render, toggle, Escape, Open settings). Blocked on render by **P0-3**. |
| F-2 | Options: data grid, add/remove, per-row enable, atomic save, dirty, validation | ⚠️ PARTIAL | `options.e2e` 7/7 incl. core smoke + invalid-regex block. Blocked on load by **P0-1/P0-3**. |
| F-3 | In-page replacement + opt-in notice + re-entrancy guard | ❌ FAIL | content.test 5/5 logic passes, but **P1-2**: static text not replaced on load. |
| F-4 | Screen-reader user story (keyboard + SR) | ⚠️ PARTIAL | a11y.test landmark/contrast/SR-token checks pass; full manual walkthrough is a human gate (no AT harness). |
| F-5 | Install/startup seeds defaults as suggestions | ✅ PASS | background + cross-surface 6/6; 6 rules seeded, idempotent. |
| F-6 | Cross-surface live update | ❌ FAIL | **P1-1**: popup does not re-render on `onChanged`. |
| **Data model (UI §4.1)** | Single `Array<Rule>`, no parallel arrays, no `clear()` | ✅ PASS | rules/storage/serializesync tests + §4.5 gate 2 & 3. |

### Accessibility (A1–A15, WCAG 2.1 AA)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| A1 | Every text control has a `<label for>` | ✅ PASS | dom.test (controls render with visible labels) |
| A2 | No info by colour alone (state carries text/aria) | ✅ PASS | a11y token checks + role=alert usage |
| A3 | Master switch `role="switch"` + `aria-checked` | ✅ PASS | popup.e2e (toggle persists, aria-checked) |
| A4 | Live regions `aria-live=polite`; errors `role=alert` | ✅ PASS | options.e2e invalid-regex flag; dom.test aria-invalid+role=alert |
| A5 | Full keyboard operability (`:focus-visible`, Ctrl/Cmd+S) | ✅ PASS | options.e2e Cmd/Ctrl+S saves (preventDefault); a11y token check |
| A6 | Focus managed (on open / preserved / to invalid) | ⚠️ PARTIAL | popup focuses master on open; preserved-across-rerender unverified (jsdom focus fidelity) |
| A7 | Dialog Escape / click-outside (no unsaved edits) | ✅ PASS | popup.e2e Escape closes; a11y mockup dialog check |
| A8 | Contrast ≥ 4.5:1 | ✅ PASS | a11y.test token contrast (ink#1b1b1b on #fff = ~16:1; accent #1f7a4d ≥ 4.5) |
| A9 | Semantic landmarks / headings | ✅ PASS | a11y.test `<main>` region; design/verify.py single `<h1>` per mockup |
| A10 | Accessible control names (Delete is text, not bare icon) | ✅ PASS | dom.test (Delete button with text) + design/gates.py |
| A11 | In-page notice `role=status`, keyboard-dismissable, off by default | ✅ PASS | popup.e2e F-3 opt-in; content.test + gates.py |
| A12 | No re-entrancy loop weds a tab | ✅ PASS | content.test A12 cycle guard (self-matching pair stops) |
| A13 | Reduced-motion respected | ✅ PASS | a11y.test `prefers-reduced-motion` declared; content.test reducedMotion branch |
| A14 | Content-script mutations don't clobber host semantics (text nodes only) | ✅ PASS | §4.5 gate 4 (no innerHTML from untrusted data) |
| A15 | SR announces rule structure | ✅ PASS | design/gates.py "visually-hidden 'Rule N of M'"; dom.test radiogroup+labels |

### Milestones (M0–M5)

| Milestone | Status | Evidence |
|---|---|---|
| **M0** Remove jQuery from MV3 surface | ✅ PASS | §4.5 gate 1 + manifest M-7 (jQuery-free); legacy `index.js/htm` retire in flight (P2-2) |
| **M1** Atomic save (no `clear()`), re-entrancy guard, external style | ✅ PASS | storage.test (no clear, quota dirty), content.test (A12), popup.css external |
| **M2** Event page → `background.js` service worker | ✅ PASS | background.test (sync listeners), manifest M-2 (service_worker, no `persistent`) |
| **M3** UI modernization (`<cc-rule-row>`, data grid, atomic save) | ⚠️ BLOCKED | Logic correct, but **P0-1/P0-3** prevent the UI from loading/rendering |
| **M4** Flip to MV3 (`manifest_version: 3`) | ✅ PASS | manifest M-1; CSP `script-src 'self'` present |
| **M5** A11y gate (axe 0 crit/serious + AA contrast + keyboard/AT) | ⚠️ PARTIAL | axe 0 violations on all 3 mockups + contrast; full AT walkthrough needs a human (no harness) |

---

## 5. Gate policy & recommendation

**Policy:** release is blocked on **any open P0 or P1**.
**State:** 3 open P0 (P0-1, P0-2, P0-3), 2 open P1 (P1-1, P1-2).
**Decision: BLOCK release.**

### Fix path for `software_engineer_programmer_analyst`
1. **P0-1** — add `<script src="lib/rules.js"></script>` **before** `storage.js` in both `options.html` and `popup.html`.
2. **P0-2** — in `storage.js`, replace `global.chrome` with a browser-safe lookup, e.g.
   `var c = (typeof window !== "undefined" ? window : globalThis).chrome;` (3 sites: L40, L82, L103).
3. **P0-3** — add a load-time `init()` call in `options.js` and `popup.js`
   (`document.readyState === "loading" ? addEventListener("DOMContentLoaded", init, {once:true}) : init();`).
4. **P1-1** — in `popup.js` `init`, subscribe `chrome.storage.onChanged` and call `S.load(cb → render)` on change (mirrors `storage.js:104-111`); guard a local unsaved dirty edit like storage does.
5. **P1-2** — in `content.js` `applyData`, run a one-time `walk(document.body)` after `ensureObserver()` to cover the pre-existing snapshot.
6. Re-run `npm test && npm run gates && npm run check` and the E2E suites; **P0-… and [P1 BUG] assertions must then be flipped** (they currently assert the broken state).

### Awaiting
- **`software_engineer_programmer_analyst`**: implement fixes 1–5, flip defect tests to positive.
- **`ui_ux_designer`**: M5 manual keyboard + screen-reader walkthrough (A6/A7 focus-preservation, A15 SR structure) — no automated AT harness exists.

---

## 6. Artifacts produced (this task)

- `test/helpers-e2e.js` — browser-fidelity harness (chrome-free `require`/`global` hiding + controllable page windows).
- `test/harness.js` — controllable options/popup/content page loaders.
- `test/wiring.e2e.test.js` — P0-1/P0-2/P0-3/P0-3b proof + recovery.
- `test/findings.e2e.test.js` — defect-documentation (asserts broken state to keep findings regression-locked).
- `test/options.e2e.test.js` — F-2 journeys.
- `test/popup.e2e.test.js` — F-1 journeys.
- `test/cross-surface.e2e.test.js` — F-5→F-6 live-update + P1 proofs + data-contract.
- `test/regression.test.js` — legacy migration, matching, inert, seed, save-filter.
- `test/manifest.test.js` — MV3 manifest shape + jQuery-free + no-alarms.
- `test/a11y.test.js` — axe-core 4.10.2 on 3 design mockups + token contrast + landmark/reduced-motion (graceful jsdom fallback).
