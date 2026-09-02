# Next-Generation Plan — Requirement Summary (shared reference)

- **Source:** `next_gen.md` (single-source-of-truth plan, 657 lines, compiled by `software-manager` from the MV3 lane and the UI lane).
- **Branch:** `feature/next-gen`
- **Version target:** ContentCensor **v2.0.2 (Manifest V2) → v3.0.0 (Manifest V3)**
- **Purpose:** a compact, structured distillation of *every* feature, architectural change, and acceptance
  criterion in `next_gen.md`, plus the open questions and blockers that gate implementation. This is the
  shared reference the implementation (t_4d5a53d3) and UI/UX (t_d1b929c6) lanes build against.
- **Status of source:** self-contained and readability-audited clean (no TODO/FIXME/dangling refs — see §7).

---

## 0. TL;DR

ContentCensor is a single-purpose Chrome extension that replaces text on `http(s)://*/*` pages from a
user-editable ruleset in `chrome.storage.sync`, applied by a content script (`popup.js`) via
`MutationObserver` + `RegExp`. The plan ships a **Manifest V3, jQuery-free, accessible** v3.0.0.

**Two scope axes are deliberately minimal:**
- **Privileges:** the extension requests exactly **one** top-level permission, `storage`, with **no host
  permissions** and **no `optional_permissions`**. The migration adds **zero** permissions; its job is to
  *prevent scope creep* and keep the narrow `content_scripts.matches` injection surface unchanged.
- **Code:** the UI lane finds **13 jQuery call sites + 2 asset references across 3 files** and **zero**
  manual DOM-binding patterns; it recommends **vanilla, zero-runtime JS** (0 KB) justified on both bundle
  size and MV3 CSP for content scripts.

**The one hard P0 blocker:** `jquery-2.1.4.min.js` is *referenced* by `manifest.json` and `index.htm` but is
**absent from the repo** (verified: `ls jquery*` → No such file). The content script currently cannot load in
*either* manifest version. Fixed at milestone **M0** (de-jQuery the content script + drop the jQuery references).

**Roadmap:** milestones **M0–M6** interleave MV3 "Phased rollout" (Phases 0–5) and UI "Migration sequence"
(Steps U1–U5). The two tracks converge at **M0** (the de-jQuery action is simultaneously MV3 Phase 0.1 and UI
Step U1). **Invariant: no phase ships a broken extension** — the fixed MV2 v2.0.3 baseline (M1) stays published
until the MV3 v3.0.0 build clears its Definition of Done.

---

## 1. Features (product behavior the plan delivers)

| ID | Feature | Lane / source | Notes |
|---|---|---|---|
| F1 | **Popup as lightweight status & control panel** | UI §3.2 (F-1) | Glanceable status + master on/off switch + "summary line" (e.g. "12 terms active · last updated 2h ago") + "Open settings" button + compact read-only preview of first 3 active rules. Interaction pattern: *status-at-a-glance + progressive disclosure*. |
| F2 | **Options page — full ruleset manager** | UI §3.3 (F-2) | Redesigns `index.htm`/`index.js`. Dynamic data grid with **add/remove rows**, per-row enable toggle, honest per-rule controls, **atomic single-call save**, dirty-state, inline validation. Interaction pattern: *editable data-list + add/remove + atomic save*. |
| F3 | **In-page replacement with opt-in notice** | UI §3.3 (F-3) / content script | Passive by default (silent, non-destructive). Optional `role="status" aria-live="polite"` toast "Replaced N terms", keyboard-dismissable, reduced-motion aware. Re-entrancy guard prevents self-matching loops. Interaction pattern: *passive + opt-in notice*. |
| F4 | **Screen-reader user story** | UI §3.5 (F-4) | Acceptance target for every flow: full keyboard + SR walkthrough. "Rule N of M. Text match. '…'. Replace with '…'. Case-sensitive off. Delete button." |
| F5 | **Install / startup seeds defaults as suggestions** | UI §3.6 (F-5) | `chrome.runtime.onInstalled` seeds defaults; status line reads "6 example rules loaded — edit or delete them in Settings" so defaults are legible as *suggestions*, not the user's own rules. Driven by a stored `version`/`installedAt` flag. |
| F6 | **Split popup vs. options page** | §3.1 / Q1 | Introduce one clear `options.html` page reachable from toolbar + popup; rescope popup to status/control. **Non-blocking** (recommended default: split). |

### Data-model change (the single source of truth in the UI layer) — UI §4.1
```js
state = {
  enabled: false,              // master switch (NEW)
  rows: [
    {
      id: <string>,           // stable key for React-free reconciliation & deletion (NEW)
      find: "",              // literal text OR regex source (depends on matchType)
      replace: "",
      matchType: "text",     // "text" | "regex"  — replaces isRegex (honest label)
      caseSensitive: false,  // false = case-insensitive (today's "gi" default)
      enabled: true          // per-rule on/off (NEW)
    }
  ],
  dirty: false,
  status: "idle"            // "idle" | "saving" | "saved" | "error"
}
```
- **Load (backward-compat migration):** `chrome.storage.sync.get("contentCensorData", cb)` → map legacy
  `{find, replace, isRegex}` objects to the new shape: `matchType = isRegex ? "regex":"text"`,
  `caseSensitive = false` (preserves today's `"gi"`), `enabled = true`, mint an `id`.
- **Save:** `state.rows.filter(r => r.enabled && r.find !== "").map(...)` →
  `chrome.storage.sync.set({contentCensorData: rows, updatedAt: Date.now()})` in **one** call. **No `clear()`.**
- **No parallel arrays anywhere** — `toReplace`/`replaceWith` and every `…Boxes[index]` pattern are **forbidden**.

---

## 2. Architectural changes

### 2.1 Manifest V3 migration (MV3 lane, `next_gen.md` §2)

**Permissions audit (§1):** surface is already minimal — `[ "storage" ]`, **zero additions**.

| Permission | Used? | Verdict |
|---|---|---|
| `storage` | Yes (`eventPages.js` seed; `index.js` pre-fill + save; `popup.js` read) | **Keep / minimal.** Entire data model lives in `chrome.storage.sync`. `sync` > `local` (user profile data follows devices). |
| `tabs` | No | Do not add. |
| `webRequest` / `webRequest` blocking | No | Do not add (no network interception). |
| `declarativeNetRequest` | No | Do not add. |
| `webNavigation` | No | Do not add. |
| `<all_urls>` / host permissions | No | Do not add — `content_scripts.matches` is the *narrower* mechanism and must not be widened into a host permission. |
| `scripting` | No | Do not add — injection is declarative/static `content_scripts`, not `chrome.scripting.executeScript`. |
| `alarms` / `notifications` / `history` / `bookmarks` / `downloads` / `contextMenus` / `activeTab` / `unlimitedStorage` / `offscreen` | No | Do not add. |
| `optional_permissions` | No gated feature | Stays absent (every capability is core & always-on). |
| `content_scripts.matches` | Yes — the one broad surface: `["http://*/*", "https://*/*"]` | **Retain.** Inherent to core function; narrower than a host permission. |

**V2 → V3 API map (§2) — full sweep (all 19 rows). Used APIs mapped concretely; unused marked N/A:**

| # | V2 construct | Present? | V3 equivalent / action |
|---|---|---|---|
| 1 | `background` w/ `scripts:[…]` + `persistent:false` (event page) | Yes | `background: {"service_worker":"background.js"}` (string, no `persistent`, optional `"type":"module"`). **Rename `eventPages.js` → `background.js`; `scripts`(array) → `service_worker`(string); delete `persistent`.** |
| 2 | `browser_action` manifest block | Yes | `action` block. **Rename `browser_action` → `action`** (keep `default_popup` / `default_icon`). |
| 3 | `chrome.browserAction.*` / `chrome.pageAction.*` (JS) | No | N/A in JS — no code calls it (manifest key change only, row 2). |
| 4 | `chrome.runtime.onInstalled.addListener` | Yes (`eventPages.js:44`) | Same; **register synchronously at top level** of the SW (§3.1). |
| 5 | `chrome.runtime.onStartup.addListener` | Yes (`eventPages.js:45`) | Same; same top-level caveat. |
| 6 | `chrome.storage.sync.get/set/clear` | Yes (`eventPages.js:4,9`; `index.js:5,42,44`; `popup.js:59`) | Same in MV3 (works in SW, content script, popup). **Note:** save path drops `clear()` (see M1/M4 atomic-save). |
| 7 | Static `content_scripts` + `matches` | Yes | Unchanged; **but resolve the jQuery dependency** or the content script fails under MV3. |
| 8 | jQuery as content-script + popup dependency | Ref but **ABSENT** | **P0 BLOCKER.** Vendor it **or** de-jQuery (rewrite `popup.js`/`index.js`). Root cost: ~90 KB injected into *every* page. |
| 9 | `webRequest` blocking → DNR | No | N/A. |
| 10 | `webNavigation` | No | N/A. |
| 11 | `chrome.extension.*` (old message path) | No | N/A — message passing not used; data flows one-way through `storage`. |
| 12 | `chrome.tabs.*` | No | N/A. |
| 13 | `XMLHttpRequest` in background | No | N/A (future networking → `fetch`, not XHR). |
| 14 | `setTimeout`/`setInterval` in background | No | N/A today; future keep-alive → `chrome.alarms` (≥30 s, Chrome ≥120). |
| 15 | `window.close()` (popup, `index.js:49`) | Yes | Same (popup is a normal extension page). **Note:** UI plan *removes* the close-on-save behavior (F2) — keep the API, drop the call. |
| 16 | `document.*` / `MutationObserver` / `new RegExp` in content script | Yes (`popup.js:59-76`) | Unchanged — content scripts still get full DOM; CSP-safe. |
| 17 | `console.log` | Yes (all) | Works in SW. Keep. |
| 18 | `externally_connectable` / `web_accessible_resources` / `inpage` / `devtools_page` | No | N/A. |
| 19 | `incognito` / `minimum_chrome_version` / `browser_specific_settings` | No | N/A. *Optional:* add `"minimum_chrome_version":"120"` for modern SW behavior. |

**Service-worker lifecycle design (§3):**
- **3.1 Listeners top-level & synchronous.** The common MV3 bug is async listener registration (inside a
  promise/callback/`init()`) — the worker is torn down and the listener is never attached in time. Current
  `that.init()` runs synchronously at top level (`eventPages.js:50` → `init()`), so listeners attach
  synchronously — **already correct**. On rename to `background.js`, **do not** move listener registration
  into `chrome.storage.sync.get(...)` callbacks or `async`/`await`.
- **3.2 No persistent globals.** SW is ephemeral; this extension is already safe — it keeps **no long-lived
  global state**; the source of truth is `chrome.storage.sync`, read on each wake. Design rule: `background.js`
  contains **zero persistent globals**; every ruleset read/write goes through `chrome.storage.sync`.
- **3.3 Keep-alive.** No artificial keep-alive; **do NOT add an alarms-based ping loop** (store risk). All
  current calls are extension-API calls that reset the idle timer. If future work needs periodic behavior:
  `chrome.alarms` with **≥30 s** granularity + register alarm and its `onAlarm` listener at top level.
- **3.4 Content-script injection.** Declarative `content_scripts` block **unchanged**; no `chrome.scripting`
  (so `scripting` permission not added). `web_accessible_resources` not needed. **jQuery must be resolved
  before/at the manifest flip** — Option A vendor jQuery (keep code, flag old jQuery 2.1.4 to QA) or **Option B
  de-jQuery** (preference; lands with UI lane; removes the P0 blocker).

**CSP changes & markup (§4):**
- **4.1 Extension-page CSP** (MV3 default): `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`.
  - **No inline `<script>`** and **no inline `on*` handlers** — audit result: `index.htm` loads scripts via
    `src=`; **no violation.**
  - **Inline `<style>`** at `index.htm:6-42` — governed by unrestricted `style-src` so it won't break loading,
    but **externalize to `popup.css`** (`<link rel="stylesheet" href="popup.css">`) for safety.
  - No `eval`/`new Function`/string-`setTimeout` (only `new RegExp` + `replace()` — CSP-safe). No remote scripts
    after vendoring. No `unsafe-inline`/`unsafe-eval` (rejected by store).
  - **Optional hardening CSP** (add to `manifest.json`):
    ```json
    "content_security_policy": { "extension_pages": "script-src 'self'; object-src 'none'; base-uri 'self';" }
    ```
- **4.2 Content scripts** run in the page context under the page's CSP + extension `content_scripts` CSP
  (`script-src 'self'`). After vendoring jQuery, compliant. If de-jQuery lands, F2 loses jQuery entirely.

### 2.2 UI / interaction modernization (UI lane, `next_gen.md` §3)

**Replacement strategy (§2 — evaluated on BOTH bundle size AND V3 CSP):**
- **Recommendation: vanilla JS, zero runtime, with a thin author-owned layer** — `render()`, `readRows()`,
  `writeRows()`, `save()`, `state.rows = []`, one delegated listener per surface; **native Custom Elements
  (`<cc-rule-row>`) only as the row rendering primitive** (no runtime).
  - **Why:** 0 KB runtime to popup **and** every page (only option satisfying the content-script CSP constraint);
    CSP-clean popup; keeps total line count under today's ~60 lines of UI logic; trivial a11y wiring.
  - **Rejected:** Alpine (framework-sized for a 1-file form, growing debt), Preact/Lit (popup-only, over-weight,
    cannot be in content scripts), full framework (disproportionate).
- **Content-script isolation (§2.3, non-negotiable):** F2 = **zero third-party imports** (no `import`/`require`/
  CDN/framework). Single self-authored module (~1–2 KB). Replace the two jQuery `.map()` calls (C13/C14) with
  native `Array.prototype.map`/`flatMap`; keep the `MutationObserver` + `RegExp` logic (with re-entrancy guard).
- **Migration sequence (§2.4, U1–U5):**
  | Step | Lane | What | Gate |
  |---|---|---|---|
  | U1 | UI | Replace C13/C14 jQuery `.map()` w/ native array ops; drop `jquery-2.1.4.min.js` from `manifest.json` **and** `index.htm`. **Closes P0 blocker.** | F2 runs with **no `jquery`** in the network panel. |
  | U2 | UI | Externalize popup styles (`popup.css`); remove inline `<script>`/`on*` (already none). | Popup loads under strict CSP, 0 violations. |
  | U3 | UI | Rewrite `index.js` → popup/options controller (`state.rows`, `render()`, delegated events, `<cc-rule-row>`, full a11y). | UI §5 checklist passes. |
  | U4 | UI | Wire add/remove rows, dirty-state, save status, validation. | §5 passes; save is atomic. |
  | U5 | UI | A11y pass: axe-core + keyboard-only walkthrough of §3.5. | 0 a11y violations; keyboard-only full flow. |

**Design defects discovered (must fix, not just de-jQuery — §1.4):**
1. **`isRegex` mislabeled "Case Insensitive?"** (`index.htm:62` header vs `index.js:14`/`:38` `isRegex`).
   Fix: two honest controls — "Match type" (literal/regex, replaces `isRegex`) + "Case-sensitive" toggle
   (default unchecked = today's `"gi"`).
2. **Fixed 6 rows, no add/remove** — empty rows silently persist blank no-ops. Fix: dynamic add/remove + empty state.
3. **Positional parallel arrays** (`toReplace`/`replaceWith`, `findBoxes`/`replaceBoxes`/`checkBoxes`) —
   off-by-one landmines. Fix: single `Array<Rule>` object model.
4. **No labels / landmarks / focus management / keyboard story** (zero `aria-`/`<label`/`role`/`scope`).
   Fix: full ARIA + keyboard model.
5. **No save feedback / dirty state / validation.** Fix: inline status + validation (F2 / §4.1).

**Component / interaction contract (§4 — engineering builds from this, no design re-sign-off):**
- **§4.1 State model** (see §1 above; migration & save rules).
- **§4.2 `<cc-rule-row>` (native Custom Element):**
  - Inputs (reflecting attrs → state): `find`, `replace`, `matchType`, `case-sensitive` (bool), `disabled` (=`!enabled`).
  - Internal DOM: match-type `role="radiogroup"` (Text/Regex), a real "Match case" checkbox with `<label for>`,
    two `<input type="text">` each with `<label for>` + visually-hidden "Rule N of M" caption,
    a Delete button (`data-action="delete"`, `aria-label="Delete rule N"`).
  - Outputs (custom events, `bubbles`, `composed`, with `detail`): `cc-row-change`
    `{rowId, changed:{find|replace|matchType|caseSensitive}, value}`; `cc-row-delete` `{rowId}`.
  - A11y per instance: real labels + `<label for>`; `role="list"` groups over `role="grid"` (a grid implies
    arrow-key cell navigation we don't implement); `role="alert"` inline error when regex invalid;
    `:focus-visible` on every interactive child.
  - **Component acceptance gate:** (a) renders all controls w/ real labels; (b) emits *only*
    `cc-row-change`/`cc-row-delete`; (c) Tab order toggle→matchtype→case→find→replace→delete;
    (d) axe-core on the row = 0 violations; (e) no `innerHTML` from untrusted data.
- **§4.3 Popup/options controller (`popup.js`/`options.js`):**
  - **Single delegated event model** (replaces jQuery's per-element `.click`, C7): **one** `click` listener on
    the container switching on `e.target.closest("[data-action]")` (`save`/`add`/`delete`/`toggle-all`/
    `open-settings`) + **one** `change`/`input` listener → sets `dirty=true`. **≤2 listeners total** for the
    surface (plus the untouched SW-side `onInstalled`/`onStartup`).
  - `render()` maps `state.rows` → `<cc-rule-row>` with **stable `id` reconciliation** (update-in-place; preserves
    focus/scroll — React-free reconciliation substitute; no virtualization at this scale).
  - Save: `saving` → disable Save → `sync.set(...)` → success `saved`/`dirty=false`/`aria-live` "Saved";
    on `chrome.runtime.lastError`/quota → `error`/`role="alert"` message / `dirty=true` (retryable).
  - Keyboard: `Ctrl/Cmd+S` → save (`preventDefault`); Tab-reachable Save/Add/toggle-all; focus returns to changed
    control after save; moves to first invalid on submit.
  - **Page acceptance gate:** (a) **zero `jQuery`/`$`** references; (b) ≤2 DOM listeners; (c) full keyboard-only
    completion of F-2; (d) axe 0 violations; (e) atomic single-call save (no `clear()`); (f) focus preserved
    across re-render.
- **§4.4 Content-script contract (F2, dependency-free):** input `sync.get("contentCensorData")`; transform via
  **one** `Array.prototype.map` (no jQuery):
  ```js
  patterns = data.map(r => ({
    re: r.matchType === "regex"
        ? new RegExp(r.find, r.caseSensitive ? "g" : "gi")
        : escapeRegex(r.find),
    replacement: r.replace
  }))
  ```
  Apply via existing `MutationObserver` + recursive `replacementFn` **with a re-entrancy guard flag**
  (MV3 Phase 0.3). Output: mutated DOM only; optional `role="status"` toast counting from `patterns` (never a
  parallel array). **Gate:** 0 KB third-party runtime in content script; runs on a page with strict
  `script-src 'self'` CSP; no infinite loop on a self-referential rule.
- **§4.5 Forbidden patterns — CI-enforceable grep gates:**
  | Gate | Check |
  |---|---|
  | No jQuery | `grep -rEn '\$\(|jquery' *.js *.htm manifest.json` → nothing |
  | No `clear()`-then-`set` race | `grep -n 'sync.clear' *.js` in the save path → nothing |
  | No parallel arrays | `grep -nE 'toReplace\[\|replaceWith\[\|Boxes\[index\]' *.js` → nothing |
  | No `innerHTML` from untrusted data | review the two render sites; `textContent`/`createElement` only |
  | No inline handlers / inline `<script>` | `grep -nE 'on(click|input|change)=' *.htm` → nothing |
  | CSP-clean popup | loads `script-src 'self'; object-src 'none'`; 0 violations |

---

## 3. Acceptance criteria

### 3.1 MV3 lane acceptance (`next_gen.md` §2 §0)
| Criterion | Where addressed |
|---|---|
| Every V2 API referenced has a V3 mapping | §2 API map (rows 1–19; unused explicitly N/A) |
| Permission list is minimal and justified | §1 audit + §1.2 per-permission justification + §1.5 resulting surface `[ "storage" ]` |
| No rollout step leaves the extension broken | §5 phased rollout, each phase has DoD = loads + smoke-test clean |

### 3.2 UI lane acceptance (`next_gen.md` §3 §0 / §6)
| Criterion | Where addressed |
|---|---|
| No jQuery reference remains in the proposed architecture | §1.1 inventory (every call enumerated & removed), §1.2 non-DOM listeners kept (not jQuery), §2 recommendation (0 KB), §4 zero-runtime contracts, §4.5 grep gate |
| Every user flow has a described interaction pattern | §3.7 summary + §3.1–3.6 (F-1…F-5 each carry a named pattern + a11y anchor) |
| Accessibility checklist included | §5 (A1–A15, mapped & verifiable) |
| Replacement strategy vs **bundle size AND V3 CSP** | §2.1 (both axes tabulated), §2.2 justified recommendation, §2.3 content-script CSP constraint |
| Component/interaction contract lets engineering build without design sign-off | §4.1–4.5 (model, component contracts, content-script contract, enforceable gates) |

### 3.3 Accessibility checklist (`next_gen.md` §3 §5 — WCAG 2.1 AA; axe-core 0 violations + manual keyboard/AT walkthrough)
A1 every text control has a programmatic `<label for>` · A2 no info by color alone · A3 master switch
`role="switch"` + `aria-checked` · A4 live regions `aria-live="polite"` (status/saved/dirty/toast), errors
`role="alert"` `aria-live="assertive"` · A5 full keyboard operability of F-1 & F-2 (`:focus-visible`,
`Ctrl/Cmd+S`) · A6 focus managed (set on open, preserved across re-render, returns after save, to first invalid on
submit) · A7 dialog escape (Escape/click-outside when no unsaved edits) + focus trap while open · A8 contrast ≥
4.5:1 (incl. dimmed states carrying meaning) · A9 semantic landmarks/headings (`<main>`, one `<h1>`, section
`<h2>`s, no skips) · A10 accessible control names (Delete never a bare icon) · A11 in-page notice
`role="status"` `aria-live="polite"`, keyboard-dismissable, off by default · A12 no re-entrancy loop weds a tab
("cycle detected, stopped") · A13 reduced-motion respected · A14 content-script mutations don't clobber host
`<a>`/form semantics (text nodes only) · A15 SR announces rule structure per §3.5.

### 3.4 Per-milestone Definition of Done (§4 combined roadmap)
- **M0 — Unblock missing jQuery (shared, MV3 Phase 0.1 = UI U1):** replace the 2 jQuery `.map()` calls in
  `popup.js` w/ native array ops; drop `jquery-2.1.4.min.js` from `manifest.json` content_scripts **and**
  `index.htm`. **DoD:** F2 runs on a test page with **no `jquery`** in the network panel; P0 cleared.
- **M1 — Harden MV2 (still `manifest_version:2`):** (a) atomic `sync.set` save — **no `clear()`-then-`set`** +
  `QUOTA_BYTES`/`lastError` handling (Phase 0.2); (b) `MutationObserver` re-entrancy guard (Phase 0.3);
  (c) externalize inline `<style>` → `popup.css` (Phase 1.1 / U2). **Exit:** fixed, tested **MV2 v2.0.3** =
  known-good baseline. **DoD:** save survives a forced storage failure w/ no data loss; self-matching pair doesn't
  hang ("cycle detected, stopped"); popup renders identically under strict CSP, no console warnings.
- **M2 — Event page → service worker (branch, MV2-tested logic):** rename `eventPages.js` → `background.js`;
  listeners stay top-level & synchronous; verify zero persistent globals; no artificial keep-alive (Phase 2).
  **DoD:** `background.js` valid, listeners attach synchronously, wake/terminate/re-wake still seeds defaults
  (verify via "Inspect views: service worker").
- **M3 — `browser_action` → `action` + popup CSP hardening (Phases 1.2 + 3):** rename `browser_action` →
  `action` (`default_icon`/`default_popup` unchanged); add explicit `extension_pages` CSP; **parallel UI work**
  rewrites `index.js` → options controller (`state.rows`, `render()`, ≤2 delegated listeners, `<cc-rule-row>`,
  full a11y — U3). **DoD:** toolbar icon shows, popup opens; popup loads under strict CSP w/ 0 violations; UI §5
  passes w/ zero `jQuery`/`$`.
- **M4 — Manifest flip to V3 (Phase 4 + UI U4):** set `"manifest_version":3`;
  `"background":{"service_worker":"background.js"}`; remove `persistent`; keep `"permissions":["storage"]` and
  `content_scripts`; **parallel UI** wires add/remove, dirty-state, atomic save feedback, validation.
  **DoD:** loads as `manifest_version 3` — no error banner, no CSP violation; "Errors" panel empty across
  install→startup→open popup→save; atomic single-call save (no `clear()`).
- **M5 — QA & a11y gate (Phase 5.1 + U5):** full end-to-end smoke test; **axe-core = 0 violations**; keyboard-only
  + VoiceOver/TalkBack walkthrough of §3.5; verify A1–A15. **DoD:** end-to-end pass; zero a11y violations;
  keyboard-only completion of F-1 & F-2; no infinite loop on a self-referential rule.
- **M6 — Publish v3.0.0 (Phase 5.2):** submit v3.0.0 to the Web Store; retain MV2 v2.0.3 baseline until v3.0.0 is
  confirmed in the wild. **DoD:** review passes w/ zero permission findings (surface unchanged — only `storage`);
  MV3 v3.0.0 is the published functional build.

**Roadmap invariant (§4):** no phase ships a broken extension; M0/M1 are MV2-only & shippable incrementally;
M2–M4 develop on a branch in parallel with the live MV2 build and the M4 flip is validated on that branch before
promotion; M3 must clear its gate before M4's flip DoD; M5 is a hard gate before M6.

**Core smoke test (the universal DoD):** open popup → edit 2 rules → Save → reload a page → confirm replacement.

---

## 4. Combined phased roadmap (sequence)
```
M0 (unblock jQuery, shared) → M1 (harden MV2 → v2.0.3 baseline)
  → M2 (event page → service worker)
  → M3 (browser_action → action + CSP + UI controller rewrite, parallel)
  → M4 (manifest_version:3 flip + UI add/remove/validation, parallel; gate: M3 CSP-clean)
  → M5 (QA + a11y hard gate) → M6 (publish v3.0.0; retain v2.0.3 until confirmed)
```

---

## 5. Open questions & blockers (ambiguities that may block or need a decision)

### 5.1 🔴 Blocking
- **P0 — `jquery-2.1.4.min.js` is missing from the repo** (verified on disk: `ls jquery*` → No such file;
  `manifest.json` declares it as a content-script dependency and `index.htm` loads it). The content script 404s
  in **both** MV2 and MV3 → extension is unshippable until resolved. **Gate.** Resolution is milestone **M0**
  (de-jQuery is preferred and clears the blocker; vendor is the fallback, with old jQuery 2.1.4 flagged to QA).

### 5.2 ⚠️ Non-blocking product decisions (recommended defaults chosen; team may override — §5.1 of source)
| # | Question | Recommended default | If team prefers otherwise |
|---|---|---|---|
| Q1 | Split popup vs. single options page | **Split** — lightweight status popup + full `options.html`. | Single surface: keep the §4.3 controller contract, point `default_popup` at the same file (contract is surface-agnostic). |
| Q2 | Master on/off switch (profile-wide `enabled` flag) | **Add `enabled`** — ruleset inert when off; cheap, high value. | Drop it: F-1 becomes status-only + "Open settings"; rules apply whenever the ruleset is non-empty. |
| Q3 | In-page "what changed" toast | **Off by default, opt-in** (`role="status"` toast, keyboard-dismissable, reduced-motion aware). | Zero in-page footprint: F-3 becomes "silent + re-entrancy guarded" only; toggle + toast copy omitted. |
| Q4 (minor) | `"minimum_chrome_version":"120"` in manifest | *Optional* — add to guarantee alarms-30s + modern SW behavior. | Omit. |
| Q5 (minor) | Hardening CSP `content_security_policy.extension_pages` (§4.1) | *Optional* — add `script-src 'self'; object-src 'none'; base-uri 'self'`. | Omit (do **not** add `unsafe-inline`/`unsafe-eval` — store-rejected). |

### 5.3 Risks & mitigations (§5.2 of source)
| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| P0: jQuery missing | Unshippable (404 in MV2 & MV3) | Certain (present now) | M0/M1 de-jQuery (UI U1 = MV3 Phase 0.1); first milestone & gate. |
| `isRegex` mislabeled "Case Insensitive?" | Silent wrong behavior | High (latent) | F2 splits into "Match type" (Text/Regex) + "Match case"; migration maps `isRegex→matchType`, `caseSensitive=false`. |
| Positional parallel arrays | Off-by-one corruption | Medium | Single `Array<Rule>` model + "no parallel arrays" grep gate (A12). |
| `clear()`-then-`set` save race | Data-loss window | Medium | M1 atomic single `sync.set`; no `clear()` + grep gate. |
| Self-matching rule loop | `MutationObserver` hangs the tab | Low–Med | Re-entrancy flag (Phase 0.3) + "cycle detected, stopped" notice. |
| SW listener registered async | `onInstalled`/`onStartup` no-op after teardown | Low (already synchronous) | §3.1 documents the top-level-sync rule; M2 DoD re-verifies post-rename. |
| A11y regression | Fails WCAG AA / store expectation | Medium | M5 gates on axe-core 0 violations + keyboard/AT walkthrough (A1–A15 / §3.5). |
| Permission scope creep | Widens attack surface + store risk | Low | §1 pins surface to `[ "storage" ]`; grep/CSP gates make drift visible. |
| MV3 flip regresses live extension | Broken v3.0.0 ships first | Low | M4/M5 gate the flip; MV2 v2.0.3 stays published until M6 confirms v3.0.0 in the wild. |

---

## 6. Shared decisions that must stay identical across lanes (do not re-decide — §4)
| Shared decision | MV3 lane | UI lane |
|---|---|---|
| Externalize inline `<style>` → `popup.css` | §4.1 / Phase 1.1 | §2.4 U2 |
| Atomic `chrome.storage.sync.set`, **no `clear()`-then-`set`** | Phase 0.2 | §3.2 / §4.1 / §5 |
| `MutationObserver` re-entrancy guard | Phase 0.3 / §3.4 & §4.4 | §3.3 F-3 / §4.4 |
| Top-level `onInstalled`/`onStartup` listeners stay **synchronous in the SW**, **untouched by the UI lane** | §3.1 | §1.2 / §4.3 |
| **De-jQuery the content script = the P0 fix (M0)** | §5 (Phase 0.1) | §2.4 U1 |
| Content script is **dependency-free / CSP-safe** on arbitrary pages | §3.4 / §4 | §2.3 |

---

## 7. Coverage map — every item in `next_gen.md` accounted for
| `next_gen.md` section | Item(s) | In this summary |
|---|---|---|
| Executive Summary (§1) | scope axes, jQuery blocker, roadmap-invariant | §0, §5.1, §3.4 |
| MV3 §0 acceptance checklist | 3 criteria | §3.1 |
| MV3 §1 permissions audit (1.1–1.5) | audit + justification + result | §2.1 (perms table) |
| MV3 §2 API map (rows 1–19) | all 19 V2→V3 rows | §2.1 (API map table) |
| MV3 §3 SW lifecycle (3.1–3.4) | listeners, no globals, keep-alive, injection | §2.1 (lifecycle) |
| MV3 §4 CSP & markup (4.1–4.2) | CSP, externalize style, hardening | §2.1 (CSP + §5.2 Q5) |
| MV3 §5 phased rollout (Phase 0–5) | per-phase DoD | §3.4 (M0–M6), §1 feature F6 |
| MV3 §6 traceability | — | §3.1 |
| UI §0 acceptance checklist | 5 criteria | §3.2 |
| UI §1 jQuery & binding inventory (1.1–1.4) | F1/F2/F3 call sites C1–C16, 5 defects | §2.2 (defects), §1 data model |
| UI §2 replacement strategy (2.1–2.4) | axes + recommendation + CSP + U1–U5 | §2.2 |
| UI §3 flows (3.1–3.7) | F-1…F-5 + interaction patterns | §1 features F1–F6, §3.2 |
| UI §4 component contract (4.1–4.5) | state model, `<cc-rule-row>`, controller, content-script, grep gates | §1 data model, §2.2 (component contract) |
| UI §5 a11y checklist (A1–A15) | 15 items | §3.3 |
| UI §6 traceability | 5 criteria | §3.2 |
| §4 combined roadmap M0–M6 | 7 milestones + invariant | §3.4, §4 |
| §5 open questions & risks | Q1–Q3 + 9 risks + N/A | §5.1, §5.2, §2.1 (N/A) |
| §6 acceptance/readability check | self-containment, no placeholders | (source audit: clean) |

**Source readability audit (§6 of `next_gen.md`):** no `TODO`/`FIXME`/`TBD`/`lorem`/`fill-in` placeholders —
clean; every `§n.n`/`Phase N`/`U N`/`M N` reference resolves (cross-lane refs are lane-qualified) — clean; both
lanes' acceptance checklists present; open questions carry chosen defaults; risks carry likelihood + mitigation;
N/A items recorded explicitly.

---

## 8. Downstream handoff notes
- **For the implementer (t_4d5a53d3 — "Implement core features & architecture"):** start at **M0** (de-jQuery the
  content script + drop jQuery references — the P0 fix). Then M1 (atomic-save + re-entrancy guard + externalize
  `popup.css` → ship MV2 v2.0.3 baseline). The implementation must respect the six shared decisions in §6 and the
  §4.5 CI grep gates as acceptance.
- **For UI/UX (t_d1b929c6 — "Design UI/UX"):** the user-facing surfaces are F-1 (popup), F-2 (options page —
  redesign of `index.htm`/`index.js`), and F-3 (opt-in in-page toast). The §4.2/§4.3 component contracts are
  detailed enough to wire directly; produce wireframes/specs + the a11y walkthrough (A1–A15, §3.5) and confirm the
  three product Q1–Q3 defaults.
- **No new blocker was introduced by this extraction; the only blocking item is the pre-existing P0 (jQuery
  missing), which the roadmap already resolves at M0.**
