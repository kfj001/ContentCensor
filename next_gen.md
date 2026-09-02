# Next-Generation Plan — Content Censor: Manifest V3 Migration & UI/Interaction Modernization

- **Document:** single-source-of-truth plan for ContentCensor's next release.
- **Authors:** `software-engineer-programmer-analyst` (MV3 lane) + `ui-ux-designer` (UI lane), compiled by `software-manager`.
- **Version target:** ContentCensor **v2.0.2 (Manifest V2) → v3.0.0 (Manifest V3)**.
- **Codebase analyzed:** `manifest.json`, `eventPages.js`, `popup.js`, `index.js`, `index.htm`, `contentcensor{48,128}.png`.
- **Audience:** any new engineer or designer. This document is **self-contained** — read it top to bottom and start work. No other context required.

> **P0 blocker (both lanes, read first):** `jquery-2.1.4.min.js` is *referenced* by `manifest.json` (content script) and `index.htm` but is **absent from the repository** (404 on GitHub). It must be resolved — vendored or de-jQuery'd — in the current MV2 build *and* the MV3 build, or the content script will not load in *either* manifest version. Both lanes converge on the **same fix** (see §4 milestone M0, which equals MV3 Phase 0.1 and UI Step U1).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Manifest V3 Migration Plan](#2-manifest-v3-migration-plan)
    - MV3 §0 Acceptance checklist · §1 Permissions audit · §2 API map · §3 Service-worker lifecycle · §4 CSP & popup markup · §5 Phased rollout · §6 Acceptance traceability
3. [UI / Interaction Modernization Plan](#3-ui--interaction-modernization-plan)
    - UI §0 Acceptance checklist · §1 jQuery & binding inventory · §2 Replacement strategy · §3 Redesigned user flows · §4 Component / interaction contract · §5 Accessibility checklist · §6 Acceptance traceability
4. [Combined Phased Roadmap](#4-combined-phased-roadmap)
5. [Open Questions & Risks](#5-open-questions--risks)
6. [Acceptance & Readability Check](#6-acceptance--readability-check)

> **Note on cross-references.** The six top-level sections (1–6) are numbered in *this* document. Each lane reproduces its **original** `§`-numbering *relative to its own lane* (so "MV3 §4.1" = the Extension-page CSP subsection within the MV3 lane in §2 above; "UI §4.3" = the popup-controller contract within the UI lane in §3). A **cross-lane** reference always names the target lane explicitly ("MV3 §…", "UI §…"); a within-lane bare "§n" resolves in that lane's own numbering. MV3 "Phased rollout" items are cited as "MV3 Phase 0.2", "MV3 Phase 1.1", etc. All references resolve within this single document.

---

## 1. Executive Summary

ContentCensor is a small, single-purpose Chrome extension that replaces text on web pages from a user-editable ruleset, persisted in `chrome.storage.sync` and applied by a content script (`popup.js`) on every `http(s)://*/*` page via a `MutationObserver` + `RegExp` pass. Today it is **Manifest V2**, its popup/options page (`index.htm`/`index.js`) is **jQuery-based**, and that jQuery asset is **missing from the repo** — so the content script currently cannot load at all. This document is the unified plan to ship a **Manifest V3, jQuery-free, accessible** v3.0.0.

**Scope is deliberately minimal on two axes — privileges and code.** *Privileges:* an audit of every Chrome API the codebase touches shows the extension requests **exactly one** top-level permission, `storage`, with **no host permissions and no `optional_permissions`** (MV3 §1). The migration adds **zero** permissions; its job on that axis is to *prevent scope creep* (no `all_urls`, `scripting`, `webRequest`, `alarms`, etc.) and to keep the narrow `content_scripts.matches` injection surface unchanged (MV3 §1.4). *Code:* the UI lane inventories **13 jQuery call sites + 2 asset references across 3 files**, finds **zero** manual DOM-binding patterns (the only "binding" in the UI is jQuery's `.click()`; the two `addListener` calls are platform lifecycle listeners owned by the MV3 lane — UI §1.2), and recommends **vanilla, zero-runtime JS** — justified on *both* bundle size (0 KB vs 4–14 KB gzip for Preact/Lit/Alpine, UI §2.1) *and* MV3 CSP (a content script must be dependency-free to be CSP-safe on arbitrary pages, UI §2.3).

**Timeline is a phased, interleaved roadmap (§4) that never ships a broken extension.** MV3 Phase 0–5 and UI Step U1–U5 run on a single track; the two converge at **M0 — resolve the missing jQuery**, which is simultaneously the MV3 pre-flight unblock (MV3 Phase 0.1) *and* the UI de-jQuery step (UI Step U1). Each phase/step carries a **Definition of Done = loads in `chrome://extensions` with no manifest/CSP error *and* the core smoke test passes (open popup → edit rules → Save → reload a page → confirm replacement)**, and the last published MV2 build (a fixed **v2.0.3** from M1) stays live until the MV3 build clears its DoD. Three product decisions (popup-vs-options split, a master on/off switch, an opt-in in-page notice) are surfaced as **non-blocking open questions with recommended defaults** (§5), and every component in UI §4 is spec'd with an acceptance gate so **engineering can build without a design re-sign-off**.

---

## 2. Manifest V3 Migration Plan

*The following is the complete MV3 lane (`software-engineer-programmer-analyst`), reproduced in full. It is self-contained (does not depend on §3), and shares four decisions with the UI lane that the §4 roadmap aligns rather than re-decides: `popup.css` externalization (MV3 §4.1), atomic single-call `chrome.storage.sync.set` with **no `clear()`-then-`set`** — MV3 Phase 0.2 — the `MutationObserver` re-entrancy guard — MV3 Phase 0.3 — and the rule that top-level `chrome.runtime.onInstalled`/`onStartup` listeners stay **synchronous in the service worker** and are **not** touched by the UI lane (MV3 §3.1; mirrored in UI §1.2).*

#### 0. TL;DR (acceptance checklist)

| Acceptance criterion | Where addressed |
|---|---|
| Every V2 API referenced in the codebase has a V3 mapping | §2 (API map table) — full sweep, incl. "not used" rows |
| Permission list is minimal and justified | §1 (audit) + §1.2 (resulting minimal manifest) |
| No rollout step leaves the extension broken | §5 (phased rollout, each phase has a Definition of Done = loads + smoke-tests clean) |

---

#### 1. Permissions audit (minimal-privilege)

##### 1.1 Current Manifest V2 permissions

```json
"permissions": ["storage"]
```

The extension requests **exactly one** top-level permission, `storage`, and it uses **no** host permissions and **no** `<all_urls>`.

##### 1.2 Justification of each request

| Permission | Used? | Where it is used | Justification |
|---|---|---|---|
| `storage` | **Yes** | `eventPages.js` (`chrome.storage.sync.get/set` seeding defaults on install/startup); `index.js` (`get` to pre-fill the popup table, `clear`+`set` on save); `popup.js` (`get` to read the ruleset into the content script) | **Required and minimal.** The entire data model of the extension is the user's replacement ruleset, and `chrome.storage.sync` is where it lives. Without `storage` nothing works. `sync` (rather than `local`) is appropriate because the ruleset is user profile data that should follow the user across devices. Keep. |
| `tabs` | No | — | Not requested; not used. The extension never reads a tab's URL/title or manipulates tabs. **Do not add.** |
| `webRequest` / `webRequest` blocking | No | — | Not requested. The extension never inspects or blocks network traffic. **Do not add.** (See §2 — no network interception is needed.) |
| `declarativeNetRequest` | No | — | Not requested. No request rewriting/blocking exists. **Do not add.** |
| `webNavigation` | No | — | Not requested. No navigation events are consumed. **Do not add.** |
| `<all_urls>` / host permissions | No | — | Not requested. The content script's reach is governed by `content_scripts.matches`, **not** by a host permission — this is the *narrower* of the two mechanisms, so it is already the more scoped of the two and must not be widened into a host permission. **Do not add.** |
| `scripting` | No | — | Not requested. The extension uses the **declarative** `content_scripts` injection (static), not programmatic `chrome.scripting.executeScript`. **Do not add.** |
| `alarms`, `notifications`, `history`, `bookmarks`, `downloads`, `contextMenus`, `activeTab`, `unlimitedStorage`, `offscreen` | No | — | None used. **Do not add.** |

##### 1.3 `optional_permissions`

The extension has **no optional/gated feature** — every capability is core and always-on. There is nothing to gate behind `optional_permissions`, so **none are added**. (The minimal-privilege guidance "use `optional_permissions` where possible" does not create a requirement: it only applies when a feature is toggled at runtime. Here every requested permission is permanently required, so hard permissions are correct and `optional_permissions` stays absent.)

##### 1.4 `content_scripts.matches` (the one broad surface)

```json
"matches": ["http://*/*", "https://*/*"]
```

This is the only broad grant, but it is **inherent to the extension's core function** (replace text on arbitrary web pages). It is:
- **narrower than** a host permission (`<all_urls>` would grant host access *in addition* to script injection, widening the attack surface); keeping it in `content_scripts.matches` is the more scoped choice.
- **Justified and retained.** Narrowing it (e.g. to a site list) would break the product's purpose, so it is kept as-is. No host permission is layered on top.

##### 1.5 Resulting minimal MV3 permission surface

```json
"permissions": ["storage"]
// no host_permissions, no optional_permissions
```

**Conclusion:** the permission list is already minimal. The migration **adds zero permissions**. The goal of the audit (remove anything not strictly required) is satisfied because nothing beyond `storage` was ever requested; the migration's job is to *prevent scope creep* and not introduce `host_permissions`/`all_urls`/`scripting`/`alarms`/etc.

---

#### 2. V2 API → V3 mapping

Full sweep of **every** V2 API surface present in the code/manifest, plus the common MV2-departing APIs explicitly marked **N/A** so nothing is left unaddressed.

| # | V2 API / construct | Present in code? | Location(s) | V3 equivalent | Action |
|---|---|---|---|---|---|
| 1 | `background` with `scripts: [...]` + `persistent: false` (event page) | Yes | `manifest.json` | `background: { "service_worker": "background.js" }` (single string, no `persistent`, optional `"type": "module"`) | **Rename the file** `eventPages.js` → `background.js`; change key from `scripts` (array) to `service_worker` (string); delete `persistent`. |
| 2 | `browser_action` manifest block (`default_icon`, `default_popup`) | Yes | `manifest.json` | `action` block | Rename `browser_action` → `action`. `default_popup` and `default_icon` keep the same names/shape under `action`. |
| 3 | `chrome.browserAction.*` / `chrome.pageAction.*` (JS) | **No** | — | `chrome.action.*` | N/A in JS — no code calls `chrome.browserAction`. Only the manifest key changes (§2 row 2). |
| 4 | `chrome.runtime.onInstalled.addListener` | Yes | `eventPages.js:44` | Same API, top-level registration | Keep. Ensure the listener is registered **synchronously at top level** of the service worker (see §3). |
| 5 | `chrome.runtime.onStartup.addListener` | Yes | `eventPages.js:45` | Same API | Keep; same top-level caveat. |
| 6 | `chrome.storage.sync.get / set / clear` | Yes | `eventPages.js:4,9`; `index.js:5,42,44`; `popup.js:59` | Same API (unchanged in MV3) | Keep. Works in service worker, content script, and popup. |
| 7 | `content_scripts` static injection + `matches` | Yes | `manifest.json` | Same in MV3 | Keep the `matches`; **resolve the jQuery dependency** (see §2 row 8 and §3.4) or the content script fails to load under MV3. |
| 8 | jQuery (`jquery-2.1.4.min.js`) as content-script + popup dependency | Referenced but **absent** | `manifest.json`, `index.htm` | — (bundling/CSP concern) | **Blocker.** Either vendor the file into the repo or rewrite `popup.js`/`index.js` to vanilla JS. Without it the content script cannot run in *either* manifest version. |
| 9 | `webRequest` blocking (`chrome.webRequest` blocking + `onBeforeRequest` blocking) | **No** | — | `declarativeNetRequest` (DNR) | **N/A.** The extension does no network interception; no DNR rules needed. Listed for completeness. |
| 10 | `webNavigation` | **No** | — | `chrome.webNavigation` (retained in MV3, but rarely used) | **N/A.** No navigation events consumed. |
| 11 | `chrome.extension.*` (e.g. `getURL`, `onMessage` old path) | **No** | — | `chrome.runtime.*` | N/A — no `chrome.extension` usage. Message passing is not used at all (data flows one-way through `storage`). |
| 12 | `chrome.tabs.*` | **No** | — | Same in MV3 | N/A — not used. |
| 13 | `XMLHttpRequest` in background | **No** | — | `fetch()` in service worker | N/A — the only network-y code is `chrome.storage`, not XHR. (Relevant guidance: if future work adds networking, use `fetch`, not `XHR`, in the worker.) |
| 14 | `setTimeout` / `setInterval` in background | **No** | — | `chrome.alarms` (min 30s granularity, Chrome ≥120) | N/A — no timers in the service worker today. Documented for the keep-alive design (§3.3). |
| 15 | `window.close()` (popup) | Yes | `index.js:49` | Same (popup is a normal extension page, not the worker) | Keep — the popup context is unaffected by the worker change. |
| 16 | `document.*` / `MutationObserver` / `new RegExp` in **content script** | Yes | `popup.js:59-76`, `popup.js:60` | Unchanged — content scripts still get full DOM | Keep. Content scripts run in the page, not the worker, so DOM/`MutationObserver`/`RegExp` are all fine under MV3. |
| 17 | `console.log` | Yes | all files | Works in the service worker | Keep. |
| 18 | `externally_connectable` / `web_accessible_resources` / `inpage` / `devtools_page` | **No** | — | Same keys where relevant | N/A — none requested. No change. |
| 19 | `incognito`, `minimum_chrome_version`, `browser_specific_settings` | **No** | — | `incognito` retained; `minimum_chrome_version` new | N/A. *Optional:* add `"minimum_chrome_version": "120"` (or current) to guarantee alarms-30s + modern SW behavior. |

**API surface summary:** the extension's actual API footprint is tiny — `onInstalled`, `onStartup`, `storage.sync`, `action` (+ one manifest rename from `browser_action`), one content script, and one popup. The migration touches only these; §2 rows for `webRequest`/`webNavigation`/`declarativeNetRequest` are recorded as **not used** to satisfy the "every V2 API referenced has a mapping" acceptance, even though no code exists to migrate.

---

#### 3. Service-worker lifecycle design

##### 3.1 Event listeners (top-level, synchronous)

The single most common MV3 bug is registering listeners *asynchronously* (inside a promise/callback/`init()`), which fails because the worker is torn down and re-created on each event and the listener was never attached in time.

- **Keep `eventPages.js`'s pattern correct:** `runtime.onInstalled` / `runtime.onStartup` listeners must be attached **at top level, synchronously**. The current `that.init()` runs synchronously at top level (`eventPages.js:50` → `init()`), so the listeners are attached synchronously — this is *already correct*. When renaming to `background.js`, preserve this: do **not** move listener registration inside `chrome.storage.sync.get(...)` callbacks or any `async`/`await`.
- All event-listener registration lives in the worker top-level scope. No listener is added in reaction to a returned promise.

##### 3.2 State persistence (no globals across wake-ups)

Service workers are ephemeral: top-level globals are lost when the worker terminates. This extension is **already safe** because:
- It keeps **no long-lived global state** in the worker. `eventPages.js`'s only job is to seed `contentCensorData` into `chrome.storage.sync` when empty, then return.
- The **source of truth is `chrome.storage.sync`**, not worker memory. On wake, the worker re-reads storage rather than relying on a remembered variable.

**Design rule (carried into MV3):** the `background.js` worker contains **zero persistent globals**. Every read/write of the ruleset goes through `chrome.storage.sync`. No `var data = ...` at module scope. This guarantees correct behavior after any wake/terminate cycle.

##### 3.3 Keep-alive strategy

- **No artificial keep-alive.** The worker does only fast, event-triggered work (seed-on-install/startup). Each task (a `sync.get` then a conditional `sync.set`) completes in milliseconds and the callback extends the worker lifetime until it finishes. There is nothing that must outlive an event.
- **Do NOT add an alarms-based ping loop** to keep the worker alive — Chrome discourages indefinite keep-alive and reserves it for managed enterprise/education devices; a non-enterprise extension doing so risks store action.
- **If** future work adds periodic behavior: use `chrome.alarms` with **minimum 30-second granularity** (Chrome ≥120; sub-30s `setTimeout` is unreliable once the worker is asleep) and register the alarm **and** its `chrome.alarms.onAlarm` listener at top level. Not required for the current feature set.
- All current calls are extension-API calls that reset the idle timer, so there is no risk of a mid-task `set` being killed. No extra mitigation needed.

##### 3.4 Content-script injection

- The declarative `content_scripts` block (static injection with `matches`) **is unchanged by MV3**. No `chrome.scripting` programmatic injection is needed (and `scripting` permission is therefore **not** added).
- **jQuery dependency must be resolved before/at the manifest flip.** Options, in preference order:
  - **(A) Vendor jQuery** — copy `jquery-2.1.4.min.js` into the repo. Minimal change; keeps `popup.js`/`index.js` as-is. (jQuery 2.1.4 is old/insecure; acceptable for a personal tool, flag for QA.)
  - **(B) De-jQuery** — rewrite `popup.js` (content script) and `index.js` (popup) to vanilla JS/DOM APIs. Reduces bundle size and removes an XSS surface; lands with the UI modernization lane.
- `web_accessible_resources`: **not needed** — nothing injects a resource into a page context beyond the declared content scripts.

---

#### 4. CSP changes & popup/content-script markup

##### 4.1 Extension-page CSP

MV3 enforces a stricter default CSP than MV2:

```
script-src 'self' 'wasm-unsafe-eval';
object-src 'self';
```

- **No inline `<script>`** is allowed. **Audit result for this extension:** `index.htm` loads its scripts via `src=` (`jquery-2.1.4.min.js`, `index.js`) — there are **no inline `<script>` blocks and no inline `on*` event handlers.** No violation.
- **Inline `<style>`:** `index.htm:6-42` contains an inline `<style>` block. Inline *styles* are governed by `style-src`, which is not restricted by the default — so this **will not break loading** — but to be safe against a stricter self-declared CSP and to satisfy "no inline", **externalize** the block to `popup.css` and reference it with `<link rel="stylesheet" href="popup.css">`.
- **No `eval` / `new Function` / string-`setTimeout`:** the code uses only `new RegExp(find, "gi")` and the `replace()` string method — both CSP-safe. No `unsafe-eval` needed.
- **No remote scripts:** after vendoring jQuery locally, all scripts are same-origin (`'self'`). No remote code.

**Recommended explicit CSP (optional but hardening):** add to `manifest.json`

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'none'; base-uri 'self';"
}
```

(Do **not** add `unsafe-inline`/`unsafe-eval` — they are rejected by the store and erase the CSP benefit.)

##### 4.2 Content scripts

- Content scripts run in the page's context and follow the **page's** CSP plus the extension's `content_scripts` CSP (default `script-src 'self'`). After vendoring jQuery locally, the content script loads its own bundle — compliant.
- If de-jQuery rewrite lands, the content script loses its jQuery requirement entirely, further simplifying CSP.

---

#### 5. Phased rollout (extension functional at every step)

**Strategy:** develop the MV3 build on a branch in parallel with the published MV2 build. **Each phase produces a loadable artifact with a Definition of Done (DoD): *loads in `chrome://extensions` with no console/manifest error AND the core smoke test passes* (open popup → edit 2 rules → Save → reload a page → confirm replacement).** No phase is allowed to ship a broken state.

##### Phase 0 — Pre-flight / unblock (MV2, no manifest flip)
- **0.1** Resolve the missing `jquery-2.1.4.min.js`: vendor it (Option A) or begin de-jQuery (Option B). **DoD:** content script loads and run replacement works on a test page in the current MV2 build.
- **0.2** Add `sync` error handling (quota/`QUOTA_BYTES` + `lastError`) and make Save atomic (`set` full ruleset; avoid the `clear()+set()` empty window). **DoD:** save survives a forced storage failure without data loss.
- **0.3** Add `mutationObserver` re-entrancy guard (flag around replacement) to prevent infinite loops. **DoD:** self-matching rules do not hang a tab.
- **Exit:** a fixed, tested **MV2 v2.0.3** remains as the known-good baseline.

##### Phase 1 — Popup markup externalized (MV2, CSP-safe even at v2)
- **1.1** Move the inline `<style>` in `index.htm` → `popup.css`; reference via `<link>`. **DoD:** popup renders identically; no console CSP warnings.
- **1.2** (Optional) add the explicit `extension_pages` CSP from §4.1 at *manifest_version 2 first* to prove the page is CSP-clean before flipping. **DoD:** popup loads with the strict CSP.
- **Exit:** `index.htm` + `popup.css` loadable; popup behavior unchanged.

##### Phase 2 — Background event page → service worker (branch, still `manifest_version:2`-tested logic)
- **2.1** Rename `eventPages.js` → `background.js`; confirm listeners are at top level (they already are). **DoD:** worker file is syntactically valid and listeners attach synchronously.
- **2.2** Verify the worker uses **zero globals**; all ruleset access via `chrome.storage.sync`. **DoD:** wake/terminate/re-wake cycle still seeds defaults correctly (test via `chrome://extensions` "Inspect views: service worker" + simulated termination).
- **Exit:** `background.js` behaves identically to the event page; no feature lost.

##### Phase 3 — `browser_action` → `action`
- **3.1** In the MV3 manifest draft, rename `browser_action` → `action` (`default_icon`/`default_popup` unchanged). **DoD:** toolbar icon shows, popup opens on click.
- **Exit:** action wired; popup opens.

##### Phase 4 — Manifest flip to V3
- **4.1** Set `"manifest_version": 3`; `"background": { "service_worker": "background.js" }`; remove `persistent`; keep `"permissions": ["storage"]`; keep `content_scripts`. **DoD:** loads at `chrome://extensions` with manifest_version 3, **no error banner**, no CSP violation.
- **4.2** Confirm no `unsafe-inline`/`eval`/remote-script/`XHR`/`setTimeout`-in-worker violations (all N/A per §2). **DoD:** `chrome://extensions` "Errors" panel empty across install, startup, open popup, save.

##### Phase 5 — QA & store submission
- **5.1** Run the full smoke test (§5 DoD) on the MV3 build; verify the 6-row UI save + page replacement end-to-end. **DoD:** end-to-end pass.
- **5.2** Submit `3.0.0` to the Web Store. **DoD:** review passes with zero permission findings (permission surface unchanged, still just `storage`).
- **Exit:** MV3 v3.0.0 is the published, functional build; MV2 v2.0.3 retained until v3.0.0 is confirmed in the wild.

##### Rollout invariant
Every phase's exit is a **loadable, functionally complete build**. Phase 0/1/2 can ship MV2 incrementally; Phase 4's flip is validated on a branch and only promoted after the "no error, no CSP violation" DoD passes. **No step leaves the extension broken** — the last published MV2 stays live until the MV3 build clears its DoD.

---

#### 6. Acceptance traceability

- **Every V2 API has a V3 mapping** → §2 rows 1–19 (used APIs mapped concretely; unused APIs explicitly marked N/A, so the sweep is complete).
- **Permission list minimal and justified** → §1 (audit + justification per permission + `optional_permissions` rationale); resulting surface is `["storage"]` with zero additions.
- **No rollout step leaves the extension broken** → §5 (each phase has a load+smoke-test DoD; MV2 baseline retained until MV3 verified).

---

## 3. UI / Interaction Modernization Plan

*The following is the complete UI/interaction lane (`ui_ux_designer`), reproduced in full. It is paste-ready and **self-contained** — it cross-references, rather than depends on, the MV3 lane. The shared-decision cross-references in its text resolve to correspondingly-numbered sub-sections in the MV3 lane in §2 above: e.g. "MV3 §4.1" = Extension-page CSP, "MV3 Phase 0.2" = atomic single-call save (no `clear()`), "MV3 Phase 0.3" = `MutationObserver` re-entrancy guard, and "MV3 §3.1 / this plan §1.2" = the top-level `chrome.runtime.onInstalled`/`onStartup` listeners that the UI lane must **not** touch.*

#### 0. TL;DR (acceptance checklist)

| Acceptance criterion | Where addressed |
|---|---|
| No jQuery reference remains in the proposed architecture | §1.4 inventory (every `$` call + every manifest/HTML reference enumerated & removed); §2 recommendation (vanilla, **0 KB runtime**); §4 component contract (zero `import` of a runtime) |
| Every user flow has a described interaction pattern | §3 — five flows, each with a labeled interaction pattern |
| Accessibility checklist included | §5 — complete WCAG-targeted checklist mapped to each control/action |
| Replacement strategy evaluated vs bundle size **and** V3 CSP | §2 — comparison table across vanilla / Preact / Alpine / Lit / full framework, on both axes, with a justified recommendation |
| Component/interaction contract lets engineering build without design sign-off | §4 — inputs, outputs, event contract, ARIA contract, and an acceptance gate per component |

---

#### 1. Inventory of jQuery and event-binding usage

##### 1.1 jQuery surface, by file and feature

Every reference to jQuery (`$`) and the `jquery-2.1.4.min.js` asset, grouped by the feature it serves. **Total: 1 asset dependency, 13 jQuery call sites across 3 files, spanning 2 features.**

**Feature F1 — "Term rules editor" (the popup/options page: `index.htm` + `index.js`)**

The popup is a fixed grid of 6 term rows. Three sub-behaviors, all jQuery:

| # | Location | Call | What it *does today* | Problem surfaced |
|---|---|---|---|---|
| C1 | `index.js:7` | `$(".findField")` | Select the 6 find inputs by class | Positional: row *i* of these = row *i* of the data. Fragile ordering assumption. |
| C2 | `index.js:8` | `$(".replaceField")` | Select the 6 replace inputs | Same positional coupling. |
| C3 | `index.js:9` | `$("input[type=checkbox]")` | Select the 6 "case-insensitive" checkboxes | **Semantic mismatch** — see §1.4. This checkbox is actually the "regex" selector; the column header reads "Case Insensitive?" yet it toggles `isRegex`. A design defect, not just a JS one. |
| C4 | `index.js:12` | `$(findBoxes[index]).val(...)` | Pre-fill find inputs from storage | jQuery `.val()` on a single-element wrap — pure overhead. |
| C5 | `index.js:13` | `$(replaceBoxes[index]).val(...)` | Pre-fill replace inputs | Same. |
| C6 | `index.js:14` | `$(checkBoxes[index]).prop("checked", isRegex ? "checked" : "")` | Set checkbox state | **Misuse:** `.prop("checked", "checked")` assigns a non-boolean string; and the label/semantics are wrong (§1.4). |
| C7 | `index.js:20` | `$("#saveButton").click(function() {…})` | Bind Save-button click | The *only* genuine "event binding" in the UI. jQuery method-style. |
| C8 | `index.js:22` | `$(".findField").map(function(){ return $(this).val(); })` | Serialize find values | jQuery `.map()` + per-iteration `$(this)` wrap; returns a **jQuery object**, not a plain array. |
| C9 | `index.js:26` | `$(".replaceField").map(function(){ return $(this).val(); })` | Serialize replace values | Same. |
| C10 | `index.js:28` | `$("input[type=checkbox]").map(function(){ return $(this).prop("checked") == true; })` | Serialize regex flags | Same; `== true` coerces the earlier string-prop bug. |
| C11 | `index.js:34-40` | `for (i…) structure.push({find, replace, isRegex})` | Assemble ruleset array | Not jQuery — plain loop. Kept. |
| C12 | `index.js:42-51` | `chrome.storage.sync.clear(...)` then `.set(...)` | Persist + `window.close()` | Not jQuery — but the **`clear()`→`set()` empty window is a data-loss / race hazard** (MV3 plan §0.2 flags it; we keep the atomic-set fix). |

**Feature F2 — "In-page rule application" (content script: `manifest.json` + `popup.js`)**

The content script loads jQuery **and** `popup.js` on every http(s) page. jQuery is used to map a plain data array into two parallel arrays:

| # | Location | Call | What it *does* | Problem surfaced |
|---|---|---|---|---|
| C13 | `popup.js:60` | `$(items.contentCensorData).map(function(){ return this.isRegex ? new RegExp(this.find,"gi") : this.find; })` | Turn rules into `find` patterns | **Abuse:** wrapping a **plain array** in jQuery to call `.map()`. Adds ~90 KB of runtime to every page load to do an `.map()` that one line of vanilla replaces. The return is a jQuery object that's iterated positionally later. |
| C14 | `popup.js:64` | `$(items.contentCensorData).map(function(){ return this.replace; })` | Turn rules into `replace` values | Same abuse; also builds a **second parallel array** from the same source — the classic off-by-one footgun if the two ever diverge. `toReplace`/`replaceWith` stay positionally parallel forever. |
| C15 | `manifest.json:25` | `"js": ["jquery-2.1.4.min.js", "popup.js"]` | Declare jQuery as a content-script dependency | This is the **root cost**: ~90 KB injected into *every* web page the user visits, forever. |
| C16 | `index.htm:5` | `<script src="jquery-2.1.4.min.js">` | Load jQuery into the popup | Pairs with an **inline `<style>`** (`:6-42`) that the MV3 plan moves to `popup.css`. |

**Feature F3 — "Startup / default-seeding" (`eventPages.js` — background)**

| # | Location | Call | Note |
|---|---|---|---|
| — | `eventPages.js` | **No jQuery, no DOM event binding.** Only `chrome.runtime.onInstalled`/`onStartup` `.addListener` (`:44-45`) | Out of scope for UI modernization — owned by the MV3/background lane. Listed to prove the *complete* binding picture: these are the **only** `addListener` calls in the repo and they are platform listeners, not UI event handlers. |

**Net:** jQuery is used in exactly **one feature that has a user interaction** (F1, the editor) plus an *incidental* array-map in F2. The entire UI is 13 call sites. No jQuery is load-bearing for the *behavior* — it is load-bearing only for the *habit*.

##### 1.2 Non-DOM bindings present (do NOT touch)

- `chrome.runtime.onInstalled.addListener(initFn)` — `eventPages.js:44`
- `chrome.runtime.onStartup.addListener(initFn)` — `eventPages.js:45`

These are platform lifecycle listeners. They stay. The MV3 plan (§3.1) already requires they remain **top-level and synchronous** in the service worker. UI modernization must **not** relocate them into a `render()`/effect callback or a framework lifecycle hook — that breaks the SW. Contracted out in §4.

##### 1.3 Binding patterns *implied* but not yet written

The redesign in §3 introduces new interactions that **do** need real event handling. To keep the "no jQuery, no ad-hoc binding sprawl" guarantee, these are centralized through the one event contract in §4.4 (`data-action` + a single delegated `click`/`change` listener). After modernization, the **entire UI is bounded by one listener per surface** rather than per-element jQuery handlers.

##### 1.4 Design defects discovered in the inventory (must fix, not just de-jQuery)

De-jQuery alone would ship the same *bad* UI. These are corrected in §3 and locked in §4:

1. **`isRegex` is mislabeled "Case Insensitive?"** — `index.htm:62` header vs `index.js:14`/`:38` `isRegex` semantics. A checkbox that controls regex mode but reads as a case-insensitivity toggle is actively misleading. *Decision:* expose **two separate, honestly-labeled controls** — a "Match type" (literal text / regular expression) and a "Case-sensitive" toggle — since the regex is built with flags `"gi"` and the literal path is a plain substring replace. This *reduces cognitive load* by matching one control to one concept.
2. **Fixed 6 rows, no add/remove.** Users can have 6 rules or 1; empty rows silently persist a blank `find`/`replace` and become no-ops. *Decision:* dynamic rows with add/remove and an empty-state.
3. **Positional parallel arrays** (`toReplace`/`replaceWith`, `findBoxes`/`replaceBoxes`/`checkBoxes`) are off-by-one landmines. *Decision:* a single array of `{find, replace, matchType, caseSensitive, enabled}` objects (object per row, not parallel arrays).
4. **No labels, no landmarks, no focus management, no keyboard story** (`grep` found zero `aria-`, `<label`, `role`, `scope`). *Decision:* full ARIA + keyboard model in §3/§5.
5. **No save feedback, no dirty state, no validation.** *Decision:* inline status + validation in §3.2 / §4.1.

---

#### 2. Replacement strategy

##### 2.1 Candidates evaluated on the two required axes

**Axis A — Bundle size (relevant here because the same page weight hits both the popup *and*, for F2, every web page the user visits).**

| Option | Runtime added to popup | Runtime added to every web page (F2 content script) | Build step needed? |
|---|---|---|---|
| **Vanilla JS, no runtime** (recommendation) | **0 KB** | **0 KB** | None — or one tiny build to bundle 3 small files |
| **HTML Custom Elements / Web Components** (vanilla, `<x-...>` tags) | 0 KB runtime (uses native `customElements`); ~0.5–1 KB author code | **N/A — must stay out of content scripts** (see CSP §2.3) | None |
| Preact (+ optional `htm`) | ~4.7 KB gzip core; ~7 KB with `htm`/signals | **Do not inject** into pages (§2.3); popup-only | Build (transpile JSX/`htm`) |
| Alpine.js v3 | ~14 KB gzip (~44 KB min) — directive HTML (`x-data`, `x-on:click`) | **N/A** — popup-only | None (drop-in), but it is a *framework*, not a fit |
| Lit (Web Components framework) | ~4.6 KB gzip | **N/A — popup only** | Build |
| Full framework (React/Vue/Svelte) | 30–150 KB+ | N/A | Build + toolchain |

Bundle figures cross-checked against Bundlephobia / vendor docs (Preact core ≈4.7 kB gzip; Lit ≈4.6 kB; Alpine v3 ≈14 kB gzip). All are small; the difference that matters for **this** extension is the **content-script** column.

**Axis B — MV3 Content Security Policy.** In MV3 the default extension-page CSP is `script-src 'self'; object-src 'none'` (MV3 migration plan §4.1). The practical consequences:

- **No inline scripts, no `eval`, no remote scripts.** Every candidate above is CSP-safe *if* loaded as a same-origin `self` file. Alpine/`x-data` and Preact are both CSP-safe (they use no inline handlers); that axis alone does **not** disqualify a framework.
- **The decisive CSP issue is content scripts (F2 / popup.js).** jQuery today is injected into the user's page. The user's page may enforce its own strict CSP (e.g. `script-src 'self'` on a bank site). The MV3 plan already flags "vendor-or-dejQuery" as a P0 blocker. Injecting *any* third-party runtime into a third-party page is a worse CSP risk than injecting a 2 KB self-authored script. **Conclusion:** content-script code must be **dependency-free and tiny**, which rules out any framework in F2 regardless of its popup size.
- **Popup CSP:** because the popup is `'self'`, a small framework is *technically* allowed, but the popup needs only a grid + save + add/remove — a use case where a framework's reactivity model is overkill and its size is pure cost.

##### 2.2 Recommendation: **Vanilla JS with a thin, author-owned component layer**

**Primary: zero-dependency vanilla JS.** A small set of well-named functions (`render()`, `readRows()`, `writeRows()`, `save()`), a state object (`state.rows = []`), and one delegated event listener per surface. Custom Elements are used **only** as the rendering unit for the row (`<cc-rule-row>`) because that is the one repetition that benefits from a native encapsulated tag — and native custom elements need **no runtime**.

**Why this wins across both axes, against the alternatives:**

1. **Bundle size.** 0 KB runtime to the popup *and* to every web page. This is the only option that satisfies the content-script CSP constraint (§2.3) with a small footprint. Preact/Lit are 4–5 KB *popup-only* (acceptable) but **cannot** go in F2; Alpine is a framework-sized dependency for a 1-file form and brings the growing-size debt its own community has flagged. For a 13-call-site codebase, adding a runtime is net-negative.
2. **V3 CSP.** The MV3 migration already externalizes `popup.css` and wants a CSP-clean popup; vanilla + a single `popup.css` + a single `popup.js` (or a tiny bundle) reaches that with nothing to audit. Dependency-free content script is the lowest-risk CSP posture for a script that runs on arbitrary sites.
3. **Maintainability / team fit.** The UI logic today is ~60 lines. A reactivity framework would dwarf it and import a mental model the team doesn't have. Vanilla keeps total line count under the current code and removes the only external dependency (`jquery-2.1.4.min.js`), which also closes the P0 "jQuery file is referenced but absent from the repo" blocker in the MV3 plan — **de-jQuery is the fix for that blocker, not a separate task.**
4. **Accessibility.** A thin layer makes it trivial to wire real `aria-live` status, focus management, and keyboard handlers without a framework's event model fighting you.

**Rejected, and why:** Alpine.js (framework-sized, growing, "jQuery for the modern web" — the very pattern we're leaving), Preact/Lit (popup-only, over-weight for a 6-row form, cannot be used in content scripts), full framework (disproportionate). **Custom Elements are *adopted*, not as a standalone answer but as the rendering primitive** of the vanilla approach.

##### 2.3 Content-script isolation (non-negotiable)

F2 must run in the page's own context and is subject to the page's CSP plus the extension `content_scripts` CSP (`script-src 'self'`). Design rule: **content-script code (F2) has zero third-party imports — no `import`, no `require`, no CDN, no framework.** It is a single self-authored module (~1–2 KB). The `MutationObserver` + `RegExp` logic in `popup.js` stays as-is; only the two jQuery `.map()` calls (C13/C14) are replaced with native `Array.prototype.map` / `flatMap`. This keeps F2 tiny, CSP-safe on any page, and free of the P0 blocker.

##### 2.4 Migration sequence (interleaves with MV3 plan §5)

| Step | Lane | What | Gate |
|---|---|---|---|
| U1 | UI | Replace C13/C14 jQuery `.map()` with native array ops; drop `jquery-2.1.4.min.js` from `manifest.json` content_scripts. **Closes the P0 blocker.** | F2 runs on a test page with no `jquery` in the network panel. |
| U2 | UI | Externalize popup styles (`popup.css`) and remove inline `<script>`/`on*` (already none). CSP-clean popup per MV3 plan §4. | Popup loads with strict CSP, no violations. |
| U3 | UI | Rewrite `index.js` → `popup.js` popup controller: `state.rows` object model, `render()`, delegated events, `<cc-rule-row>`, full a11y (§3). | §5 checklist passes in popup. |
| U4 | UI | Wire add/remove rows, dirty-state, save status, validation (§3.2/§4.1). | §5 checklist passes; save is atomic. |
| U5 | UI | Accessibility pass: axe + keyboard-only walkthrough (screen-reader user story, §3.5). | Zero a11y violations; keyboard-only full flow. |

---

#### 3. Redesign of the key user flows

There are **three** user-interactive surfaces, plus one non-interactive-but-visible behavior: the **popup/options page** (they are the same file today — a primary redesign driver), the **in-page replacement behavior** (no UI, but a *notice* pattern is added), and the **install/startup** (no UI). Flows F-1…F-5 each get a **named interaction pattern**.

##### 3.1 Core insight: "the popup *is* the options page"

Today `index.htm` is opened as the `browser_action`/`action` **`default_popup`** *and* functions as the only **options** surface — there is no separate options page. That is the single biggest cognitive-load issue: the user is never told *where* they are or that changes persist everywhere. **Decision: introduce one clear options surface** (a full `options.html` page, reachable from the toolbar and from the popup) and **rescope the popup to a lightweight status/control panel** that points to it. This splits "quick status + toggle all on/off" from "manage the full ruleset," cutting per-interaction cognitive load.

##### 3.2 F-1 — Popup (lightweight status & control)  ·  *Interaction pattern: status-at-a-glance + progressive disclosure*

**Before:** opening the toolbar dropped the user into a 6-row form they had to read top-to-bottom; no affordance said "these apply to every page" or "you changed things."
**After:**

- **Pattern:** *Glanceable status.* The popup shows: (a) an **on/off master switch** (apply replacements on this profile), (b) a **summary line** — "12 terms active · last updated 2h ago" — read from `state.rows` + a stored `updatedAt`, (c) a primary **"Open settings"** button (goes to the options page), and (d) a compact preview of the first 3 active rules (read-only).
- **A11y:** `<h1>`/`<h2>` for structure; the master switch is a real `<button role="switch" aria-checked>`; the summary is `aria-live="polite"`; "Open settings" is a focusable button. Popup is a small fixed-width dialog, so **focus is set to the master switch on open** and **`Escape`** (or click-outside) closes after a confirmation prompt only if unsaved edits exist (there are none here, so Escape/click-outside freely closes).
- **Keyboard:** Tab order = master switch → Open settings → first preview item. Each control has a visible `:focus-visible` ring.
- **Cognitive load:** one screen, one decision (on or off), one path out. Details are one click away, not in your face.

##### 3.3 F-2 — Options page (manage the full ruleset)  ·  *Interaction pattern: editable data grid with add/remove + atomic save*

This is the redesigned `index.htm`/`index.js`. **Pattern: dynamic data-grid with explicit add/remove, per-row enable, honest per-rule controls, and atomic save.**

**Row controls (replaces the mismatched checkbox — defect #1):** each `<cc-rule-row>` exposes, in this left-to-right order:
1. **Match type** — a two-state segmented control / radio group: **"Text"** (literal substring) or **"Regex"** (regular expression). Replaces the semantically-wrong "Case Insensitive?" checkbox and the `isRegex` flag. (Default: Text; matches the majority of user intent for a content-replacement toy.)
2. **Case sensitive** — a labeled checkbox: "Match case". (Default: unchecked = *case-insensitive*, i.e. today's `"gi"` behavior. This preserves current behavior under the Text mode and is the honest label.)
3. **Find** — text input, `aria-label="Text to find"` + a real `<label for>`.
4. **Replace with** — text input, `aria-label="Replacement text"` + `<label for>`.
5. **Delete** — a text button, `aria-label="Delete this rule"`, `class data-action=delete`.

**Grid behaviors:**
- **Add / remove** — "+" *Add rule* button at the foot; each row has *Delete*. Replaces the fixed 6 rows (defect #2). Empty state: "No rules yet — add your first replacement."
- **Per-row enable** — a leading toggle so a user can disable a rule without deleting its text.
- **Dynamic rows = one array of objects** (`state.rows: Array<Rule>`), **never** parallel arrays (defect #3). Rendering maps `state.rows` → `<cc-rule-row>`; the DOM is the *projection* of state, not the other way around — this eliminates the positional footgun that the old `findBoxes[index]/replaceBoxes[index]` indexing created.
- **Dirty state** — mark `state.dirty = true` on any change; the Save button is disabled until dirty; a subtle "You have unsaved changes" `aria-live="polite"` banner appears.
- **Atomic save** — on Save, serialize all rows to one object array and `chrome.storage.sync.set({contentCensorData}, cb)` in a **single call**; **do not** `clear()` first (removes the empty-window data-loss race; aligns with MV3 plan Phase 0.2).
- **Save feedback** — Save button shows *Saving…* then a `aria-live="polite"` confirmation "Saved" (or an error region with `role="alert"` on `runtime.lastError`/quota). The current `window.close()`-on-save is **removed** — closing the options page on save yanks the user out; instead we keep them on the page, confirm, and let them continue.
- **Validation** — a row is invalid if: Match type = Regex and `new RegExp(find)` throws (invalid pattern) → inline error under the Find field, `role="alert"`, focus moves to it on submit; or Find is empty (row does nothing) → we don't block, we *dim and skip* empty rows at save time rather than persist no-op rules (addresses defect #2 silently).
- **Keyboard model:** Tab moves across a row (toggle → match type → case → find → replace → delete); `Enter` in a field moves down to the next row's first field; a footer "Add rule" and "Save" are reachable; a **`Ctrl/Cmd+S`** shortcut triggers Save with a `beforeunload`/storage guard so an explicit save isn't lost; `Tab` reaches "Add rule" so a user can add without a mouse.
- **A11y:** the grid is a `<table role="grid" aria-label="Replacement rules">` with `<th scope="row">` row-number labels; or, given dynamic add/delete, a list of `<li>` rows each a labeled group `<fieldset>`/`<legend>`-equivalent with a visually-hidden row caption "Rule 1 of N". **Decision:** use `role="list"`/`<li>` groups over `role="grid"` — a `grid` implies arrow-key cell navigation we don't actually implement, and a screen reader is better served by each row being a self-describing group. (See §5.)
- **Cognitive load:** one row = one rule, one concern per control, honest labels, explicit add/remove, feedback on every action. The user never infers "which row means what."

##### 3.4 F-3 — In-page replacement behavior  ·  *Interaction pattern: passive + opt-in notice*

The content script (F2) mutates text on the user's page. Today there is **zero** signaling — a user can never tell the extension did something, and the MV3 plan (MV3 plan Phase 0.3) flags a re-entrancy risk. **Pattern: passive by default, optional non-blocking notice.**

- **Default: silent, non-destructive replacement** (keeps the product's purpose: pages "just look kinder"). No injected UI by default.
- **Optional "Show me what changed" notice:** a tiny, self-removing `role="status"` `aria-live="polite"` toast in a corner, gated by a popup toggle, that briefly shows "Replaced N terms" and is fully keyboard-dismissable. This is the *only* in-page UI and it is off-by-one-safe because it counts from `state.rows`, not a parallel array.
- **Safety (carries to MV3 plan Phase 0.3):** the replacement pass keeps a **re-entrancy guard** so a rule that matches its own output (e.g. `republican→pervert`, then a future rule `pervert→republican`) cannot loop. UI design: if a self-matching cycle is detected, the notice (if on) says "Cycle detected, stopped" rather than hanging. No jQuery involved.
- **CSP:** F2 remains dependency-free (§2.3); the notice (if enabled) is built with `document.createElement`, same-origin styles, no `innerHTML` from untrusted data, no `eval`.

##### 3.5 F-4 — Screen-reader user story (acceptance target for every flow)

A screen-reader user can, **without sight**: open the popup, hear "Content Censor. Switch, off. 12 terms active. Last updated 2 hours ago. Button, Open settings." Toggle the switch and hear "Content Censor on." Open settings, navigate the ruleset row by row where each row announces "Rule 3 of 12. Text match. 'republican'. Replace with 'pervert'. Case-sensitive off. Delete button," change a value, press `Ctrl+S`, and hear "Saved." No control is keyboard-unreachable; no info is conveyed by color alone (the on/off state is also text/`aria-checked`, active rules are marked by label, not just style).

##### 3.6 F-5 — Install / startup (no UI, but a design touch)

`chrome.runtime.onInstalled` seeds defaults (MV3 plan). **Design touch:** on first install, the status line should read "6 example rules loaded — edit or delete them in Settings" so the seeded defaults are legible as *suggestions*, not as the user's own rules. No jQuery, no UI wiring — a stored `version`/`installedAt` flag drives the copy.

##### 3.7 Flow-to-interaction-pattern summary (acceptance: every flow described)

| Flow | Interaction pattern | A11y anchor |
|---|---|---|
| F-1 Popup | Status-at-a-glance + progressive disclosure | `role="switch"`, `aria-live` summary |
| F-2 Options | Editable data-list + add/remove + atomic save | `role="list"` groups, real `<label>`, `role="alert"` validation, `Ctrl/Cmd+S` |
| F-3 In-page | Passive + opt-in non-blocking notice | `role="status"` `aria-live` (opt-in), re-entrancy guard |
| F-4 Screen reader | Full keyboard + SR walkthrough | §3.5 story |
| F-5 Install | Seeded-suggestion copy | Status copy flags defaults as examples |

---

#### 4. Component / Interaction contract (engineering builds from this — no design re-sign-off)

Contract = **data shape + rendering surface + event wiring + a11y attributes + an acceptance gate per component.** An engineer can implement each component against this without another design pass.

##### 4.1 State model (the single source of truth in the UI layer)

```js
// popup-state.js  (in-memory projection over chrome.storage.sync; the ONLY place the UI reads/writes rules)
state = {
  enabled: false,                 // master switch (new)
  rows: [
    // Rule object — ONE object per rule; NO parallel arrays (kills defect #3)
    {
      id: <string>,              // stable key for React-free reconciliation & deletion
      find: "",                  // literal text OR regex source (depends on matchType)
      replace: "",               // replacement text
      matchType: "text",         // "text" | "regex"   (replaces isRegex; honest)
      caseSensitive: false,      // false = case-insensitive (today's "gi" default)
      enabled: true              // per-rule on/off (new)
    }
  ],
  dirty: false,
  status: "idle"                 // "idle" | "saving" | "saved" | "error"
}
```

- **Load:** `chrome.storage.sync.get("contentCensorData", cb)` → map legacy `{find,replace,isRegex}` objects into new shape: `matchType = isRegex ? "regex":"text"`, `caseSensitive = false` (preserve behavior), `enabled=true`, mint an `id`. **Migration is backward-compatible** — old stores load fine.
- **Save:** `state.rows.filter(r => r.enabled && r.find !== "").map(...)` → `chrome.storage.sync.set({contentCensorData: rows, updatedAt: Date.now()})` in **one** call. No `clear()`.
- **No parallel arrays anywhere.** This is the design contract; `toReplace`/`replaceWith` and every `…Boxes[index]` pattern are **forbidden**.

##### 4.2 Component contract: `<cc-rule-row>`

A **native HTML Custom Element** (zero runtime; `customElements.define`), the one repetition worth encapsulating.

- **Inputs (attributes reflecting → state):** `find`, `replace`, `matchType`, `case-sensitive` (boolean), `disabled` (boolean = `!enabled`).
- **Internal DOM:** a grid of native controls (segmented match-type radios, a real checkbox with `<label for>`, two text `<input type="text">` each with a `<label for>` + visually-hidden "Rule N of M" caption, a Delete `data-action="delete"` button).
- **Outputs (custom events, `bubbles`, `composed`, `detail` carries the change):**
  - `cc-row-change` `{ rowId, changed: {find|replace|matchType|caseSensitive}, value }` — fired on any edit.
  - `cc-row-delete` `{ rowId }` — fired on Delete; the page controller removes the row from `state.rows` and re-renders.
- **A11y (non-negotiable per instance):**
  - Each text control: `id` + matching `<label for>`; group has `aria-label="Replacement rule N"`.
  - Match-type controls: a `role="radiogroup"` with `aria-label="Match type"` and two `role="radio"`/`<input type=radio>` options with visible labels.
  - Delete button: `aria-label="Delete rule N"`; visible text "Delete" for the sighted.
  - Errors: an inline `role="alert"` node the row exposes; when `matchType=regex` and the pattern is invalid, the row sets its own `aria-invalid="true"` and writes the error there; the page controller, on submit, moves focus to the first `aria-invalid` row.
  - `:focus-visible` outline on every interactive child.
- **Acceptance gate (component sign-off):** (a) renders all controls with real labels; (b) emits exactly `cc-row-change`/`cc-row-delete`; (c) keyboard Tab order is toggle→matchtype→case→find→replace→delete; (d) axe-core on the rendered row = 0 violations; (e) no `innerHTML` from untrusted data.

##### 4.3 Component contract: popup controller (`popup.js` / `options.js`)

- **Inputs:** `state` (§4.1); the grid of `<cc-rule-row>`; one master-switch button; one "Add rule" button; one "Save" button; status region.
- **Single delegated event model (replaces jQuery's per-element `.click` — C7):** **one** `addEventListener("click", …)` on the container that switches on `e.target.closest("[data-action]")` (`save`, `add`, `delete`, `toggle-all`, `open-settings`), and **one** `addEventListener("change"|"input", …)` on the container that reads the `cc-row-*` custom events / native form changes into `state` and sets `dirty=true`. **Exactly two listeners for the entire options surface** (plus the SW-side `runtime.onInstalled/onStartup`, untouched — §1.2). This is the "no ad-hoc binding" guarantee made concrete.
- **Rendering:** `render()` maps `state.rows` → `<cc-rule-row>` elements with **stable `id` for reconciliation** (update-in-place by `id`, don't blow away the whole list — preserves focus/scroll and is the React-free substitute for virtual reconciliation). A 50-row list re-renders fine; no virtualization needed at this scale.
- **Save:** `data-action="save"` → set `status="saving"`, disable Save, `chrome.storage.sync.set(...)` → on success `status="saved"`, `dirty=false`, `aria-live` "Saved"; on `chrome.runtime.lastError`/quota → `status="error"`, show `role="alert"` with the message, keep `dirty=true` so the user can retry.
- **Keyboard:** `Ctrl/Cmd+S` → save (preventDefault). `Tab`-only reachable Save/Add/toggle-all. Focus returns to the changed control after save.
- **Acceptance gate (page sign-off):** (a) zero `jQuery`/`$` references; (b) ≤2 DOM listeners on the surface; (c) full keyboard-only completion of F-2; (d) `axe` 0 violations; (e) atomic single-call save (no `clear()`); (f) focus preserved across re-render.

##### 4.4 Content-script contract (F2, dependency-free)

- **Inputs:** `chrome.storage.sync.get("contentCensorData", cb)`.
- **Transform:** `patterns = data.map(r => ({ re: r.matchType==="regex" ? new RegExp(r.find, r.caseSensitive?"g":"gi") : escapeRegex(r.find), replacement: r.replace }))` — **one** `Array.prototype.map`, **no jQuery** (kills C13/C14). Use `String.prototype.replaceAll` for the text case (or `new RegExp(escapeRegex(find), flags)` for case options) — never a string `.replace` with a regex object across a parallel array.
- **Apply:** the existing `MutationObserver` + recursive `replacementFn`, with a **re-entrancy guard flag** (MV3 §0.3). No jQuery. No third-party import (§2.3).
- **Output:** mutated DOM only; optional `role="status"` opt-in toast counting replacements from `patterns` (never from a parallel array).
- **Acceptance gate:** 0 KB third-party runtime in content script; runs on a page with a strict `script-src 'self'` CSP; no infinite-loop on a self-referential rule.

##### 4.5 Forbidden patterns (CI-enforceable)

These are greppable gates so the guarantee is **verifiable**, not aspirational:

| Gate | Check |
|---|---|
| No jQuery | `grep -rEn '\$\(|jquery' *.js *.htm manifest.json` returns nothing |
| No `clear()`-then-`set` save race | `grep -n 'sync.clear' *.js` returns nothing in the save path |
| No parallel arrays | `grep -nE 'toReplace\[\|replaceWith\[\|Boxes\[index\]' *.js` returns nothing |
| No `innerHTML` from untrusted data | review of the two render sites; use `textContent`/`createElement` only |
| No inline handlers / inline `<script>` | `grep -nE 'on(click|input|change)\=' *.htm` returns nothing |
| CSP-clean popup | loads with `script-src 'self'; object-src 'none'`; 0 violations |

---

#### 5. Accessibility checklist (acceptance criterion)

Target: WCAG 2.1 AA; validated with **axe-core** (0 violations) + a manual keyboard-only & VoiceOver/TalkBack walkthrough of §3.5.

| # | Item | Where it applies | How verified |
|---|---|---|---|
| A1 | Every text control has a programmatic `<label for>` (no placeholder-as-label) | §4.2 rows; popup controls | axe `label` rules |
| A2 | No info conveyed by color alone — on/off, active/dimmed, error have text/`aria-*` | §3.1 status, §3.2 dim+skip empty, §3.2 errors | Manual review of "color-only" |
| A3 | Master switch is `role="switch"` with `aria-checked`; not a bare checkbox styled as a switch | §3.1 | axe `aria` + AT read |
| A4 | Live status regions use `aria-live="polite"` (status/saved/dirty/toast); errors use `role="alert"` `aria-live="assertive"` | §3.1, §3.2, §3.4 | axe `aria-*` rules |
| A5 | Full keyboard operability of F-1 & F-2: Tab order defined, `:focus-visible` visible on every control, `Ctrl/Cmd+S` saves | §3.2, §4.3 | Keyboard-only pass; no step needs a mouse |
| A6 | Focus is managed: set on open (popup), preserved across re-render (options), returns to the changed control after save, moves to first invalid on submit | §3.1–3.2, §4.3 | Manual focus-trace |
| A7 | Dialog/popup has a clear escape (Escape / click-outside when no unsaved edits) and a focus trap while open | §3.1 | Manual: focus can't leave the dialog |
| A8 | Color contrast of text on background ≥ 4.5:1 (including dimmed/disabled states that still carry meaning) | entire popup/options | axe `color-contrast` |
| A9 | Semantic landmarks/headings: `<main>`, one `<h1>`, section `<h2>`s; no heading skips | §3.1–3.2 | axe `landmark`/`heading` rules |
| A10 | Controls have accessible names (buttons have text or `aria-label`); `Delete` never appears as a bare icon in AT | §4.2 | axe `button-name`, `link-name` |
| A11 | In-page notice (if enabled) is `role="status"` `aria-live="polite"` and keyboard-dismissable; off by default | §3.4 | AT read; default off confirmed |
| A12 | No re-entrancy loop can wedge a tab (safe failure: "cycle detected" notice, not a hang) | §3.4, §4.5 | Test a self-referential rule pair |
| A13 | Reduced-motion respected: the "what changed" toast has no animation when `prefers-reduced-motion: reduce` | §3.4 | emulate in DevTools |
| A14 | Content-script DOM mutations don't inject into or overwrite page `<a>`/form semantics beyond text nodes (preserve the host page's own a11y) | §3.4 | compare host page AX tree before/after |
| A15 | Targeting: screen reader announces rule structure as in §3.5 verbatim ("Rule N of M. Text match. '…'. Replace with '…'.") | §3.5 | VoiceOver/TalkBack |

---

#### 6. Acceptance traceability (this task)

| This task's acceptance | Where met |
|---|---|
| No jQuery reference remains in the proposed architecture | §1.1 (every call enumerated & removed), §1.2 (non-DOM listeners explicitly *kept* — they aren't jQuery), §2 recommendation (0 KB runtime), §4 (zero-runtime contracts), §4.5 greppable "no `$`" gate |
| Every user flow has a described interaction pattern | §3.7 summary + §3.1–3.6 (F-1…F-5 each carry a named pattern + a11y anchor) |
| Accessibility checklist included | §5 (A1–A15, mapped & verifiable) |
| Replacement strategy vs **bundle size and V3 CSP** | §2.1 (both axes tabulated), §2.2 (justified recommendation), §2.3 (content-script CSP constraint) |
| Component/interaction contract so engineering needs no further design sign-off | §4 (§4.1 model, §4.2 + §4.3 component contracts, §4.4 content-script contract, §4.5 enforceable gates) |

**Handoff to the compiler (task t_e430fa6d → `next_gen.md`):** this section is paste-ready as "3. UI/interaction modernization." It is **independent** of the MV3 lane except for shared decisions, which it *cross-references* rather than depends on: `popup.css` externalization (MV3 §4.1), atomic single-call save (MV3 §0.2 / no `clear()`), re-entrancy guard (MV3 §0.3), and the top-level `chrome.runtime.onInstalled/onStartup` listeners that UI modernization must **not** touch (MV3 §3.1, this plan §1.2/§4.3). If `next_gen.md` interleaves the two tracks, use the U1–U5 steps (§2.4) alongside MV3 Phase 0–5; **U1 (de-jQuery the content script) is the same action that clears the P0 jQuery blocker in the MV3 plan**, so the two tracks share that milestone.

**Open questions for the team (do not block — recommended defaults chosen above):**
1. *Popup vs. separate options page.* Recommended: split (F-1 lightweight popup + a `options.html` full settings page). If a single surface is preferred, keep the §4.3 option-page contract and point the popup `default_popup` at the same file; the contract is surface-agnostic.
2. *Master on/off switch.* Recommended: add a profile-wide `enabled` flag (cheap, high value). If scope must stay minimal, drop it and F-1 becomes status-only + "Open settings."
3. *In-page "what changed" toast.* Recommended: off by default, opt-in. If the product prefers zero in-page footprint, drop it and F-3 is "silent, guarded" only.

---

## 4. Combined Phased Roadmap

The MV3 lane (§2) and UI lane (§3) are **two views of one track**. They converge at M0 and then proceed together; every milestone below carries a **Definition of Done**. The single most important property of this roadmap: **no phase ships a broken extension** — the known-good MV2 build (a fixed v2.0.3 from M1) stays published until the MV3 build clears its DoD.

**Milestones (M0–M6).** Milestones are the *sequence*; the per-milestone table interleaves the MV3 "Phased rollout" items (MV3 §5, Phases 0–5) and the UI "Migration sequence" items (UI §2.4, Steps U1–U5) that compose each milestone, with the owning lane and its DoD. The two tracks reference each other through these shared milestones.

| Milestone | Track(s) | What happens (work items) | Owner / source | Definition of Done |
|---|---|---|---|---|
| **M0 — Unblock the missing jQuery** (shared) | MV3 Phase 0.1 **+ UI Step U1** (the *same* action) | Replace the 2 jQuery `.map()` calls in `popup.js` with native `Array.prototype.map`/`flatMap`; drop `jquery-2.1.4.min.js` from `manifest.json` `content_scripts` **and** from `index.htm`. One action, not two. | MV3 §5 (Phase 0.1) **=** UI §2.4 (U1) | F2 content script runs on a test page with **no** `jquery` in the network panel; P0 blocker cleared. |
| **M1 — Harden MV2** (still `manifest_version:2`) | MV3 Phases 0.2, 0.3, 1; UI U2 | (a) atomic `sync.set` save — **no `clear()`-then-`set`**; add `QUOTA_BYTES`/`lastError` handling (MV3 Phase 0.2). (b) `MutationObserver` re-entrancy guard to stop self-matching loops (MV3 Phase 0.3). (c) externalize the inline `<style>` in `index.htm` → `popup.css` (MV3 §4.1 / UI U2). **Exit: a fixed, tested MV2 v2.0.3 = the known-good baseline.** | MV3 §5 (Phase 0.2/0.3/1) + UI §2.4 (U2) | Save survives a forced storage failure with **no** data loss (no empty window); a self-matching rule pair does not hang a tab ("cycle detected, stopped"); popup renders identically with strict CSP and no console warnings. |
| **M2 — Event page → service worker** (branch, still MV2-tested logic) | MV3 Phase 2 | Rename `eventPages.js` → `background.js`; confirm `onInstalled`/`onStartup` listeners stay **top-level & synchronous** (they already are, MV3 §3.1); verify **zero persistent globals** — ruleset access only via `chrome.storage.sync` (MV3 §3.2); no artificial keep-alive (alarms ≥30 s *only if* future work needs it, MV3 §3.3). | MV3 §5 (Phase 2), per MV3 §3 | `background.js` is syntactically valid, listeners attach synchronously, and a wake/terminate/re-wake cycle still seeds defaults correctly (verify via "Inspect views: service worker"). |
| **M3 — `browser_action` → `action`** + popup CSP hardening | MV3 Phases 1.2 + 3 | In the MV3 manifest draft: rename `browser_action` → `action` (`default_icon`/`default_popup` unchanged; MV3 §5 Phase 3); add the explicit `extension_pages` CSP (MV3 §4.1). **UI lane parallel:** rewrite `index.js` → the options controller `popup.js`/`options.js` with the `state.rows` object model, `render()`, **≤2 delegated listeners**, `<cc-rule-row>` custom element, and full a11y (UI §2.4 U3, per UI §3–§4). | MV3 §5 (Phase 1.2/3) + UI §2.4 (U3) | Toolbar icon shows and popup opens on click; popup loads under the strict CSP with **0** violations (MV3 §4); UI acceptance checklist (UI §5) passes in the popup with zero `jQuery`/`$` references (UI §4.5). |
| **M4 — Manifest flip to V3** | MV3 Phase 4 | Set `"manifest_version": 3`; `"background": { "service_worker": "background.js" }`; remove `persistent`; keep `"permissions": ["storage"]` and the `content_scripts` block (MV3 §5 Phase 4, per MV3 §2). **UI lane parallel:** wire add/remove rows, dirty-state, atomic save feedback, and validation (UI §2.4 U4, per UI §3.2 / §4.1). | MV3 §5 (Phase 4) + UI §2.4 (U4) | Loads at `chrome://extensions` as **manifest_version 3** with **no error banner and no CSP violation**; the "Errors" panel is empty across install → startup → open popup → save (MV3 §5 Phase 4 DoD); atomic single-call save, no `clear()` (MV3 Phase 0.2 / UI §4.1). |
| **M5 — QA & a11y gate** | MV3 Phase 5.1 + UI U5 | Full end-to-end smoke test on the MV3 build; **axe-core = 0 violations**; a keyboard-only + VoiceOver/TalkBack walkthrough of the screen-reader story (UI §3.5 / UI §3.3 F-4); verify the a11y checklist (UI §5, A1–A15). | MV3 §5 (Phase 5.1) + UI §2.4 (U5) | End-to-end pass (MV3 §5 Phase 5.1 DoD); **zero** a11y violations; keyboard-only completion of F-1 & F-2; no infinite-loop on a self-referential rule (UI A12). |
| **M6 — Publish v3.0.0** | MV3 Phase 5.2 | Submit v3.0.0 to the Web Store; retain the MV2 v2.0.3 baseline until v3.0.0 is confirmed in the wild (MV3 §5 Phase 5.2). | MV3 §5 (Phase 5.2) | Review passes with **zero permission findings** (surface unchanged — still only `storage`, MV3 §1); MV3 v3.0.0 is the published, functional build. |

**Shared-decision alignment (do not re-decide — these appear in both lanes and must stay identical):**

| Shared decision | MV3 lane (§2) | UI lane (§3) |
|---|---|---|
| Externalize inline `<style>` → `popup.css` | §4.1 / Phase 1.1 | UI §2.4 U2 |
| Atomic `chrome.storage.sync.set`, **no `clear()`-then-`set`** | Phase 0.2 | UI §3.2 / §4.1 / §5 |
| `MutationObserver` re-entrancy guard | Phase 0.3 / §3.4 §4.4 | UI §3.3 F-3 / §4.4 |
| Top-level `onInstalled`/`onStartup` listeners stay **synchronous in the SW**, **untouched by the UI lane** | §3.1 | UI §1.2 / §4.3 |
| **De-jQuery the content script = the P0 fix (M0)** | §5 (Phase 0.1) | UI §2.4 U1 |
| Content script is **dependency-free / CSP-safe** on arbitrary pages | §3.4 / §4 | UI §2.3 |

**Sequencing notes.** M0/M1 are MV2-only and can ship incrementally; M2–M4 are developed on a **branch in parallel with the live MV2 build** and the flip (M4) is validated on that branch before promotion. M3/M4 run the MV3 manifest work and the UI rewrite **in parallel** because they touch different files (the manifest + worker vs. the popup controller + content script) — but M4's *flip DoD* depends on M3's popup being CSP-clean, so M3 must clear its gate first. M5 is a hard gate before M6.

---

## 5. Open Questions & Risks

### 5.1 Product decisions — non-blocking, recommended defaults chosen

These are surfaced for the team to confirm or override. **None blocks the roadmap** — the recommended default is what the build will adopt unless vetoed.

| # | Question | Recommended default | If the team prefers otherwise |
|---|---|---|---|
| **Q1** | Split popup vs. single options page (UI §3.1 / §3.2 F-1 & F-2). | **Split** — lightweight status popup + a full `options.html` settings page; the popup is glanceable status + master switch + "Open settings". | Single surface: keep the UI §4.3 controller contract and point `default_popup` at the same file — the contract is surface-agnostic, so nothing else changes. |
| **Q2** | Master on/off switch (a profile-wide `enabled` flag). | **Add `enabled`** — cheap, high value; the ruleset is inert when off. | Drop it: F-1 becomes status-only + "Open settings", and rules apply whenever the ruleset is non-empty. |
| **Q3** | In-page "what changed" toast (UI §3.3 F-3). | **Off by default, opt-in** — a tiny `role="status"` `aria-live="polite"` "Replaced N terms" toast, keyboard-dismissable, reduced-motion aware. | Zero in-page footprint: F-3 is "silent + re-entrancy guarded" only; the toggle and toast copy are omitted. |

### 5.2 Risks & mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **P0: `jquery-2.1.4.min.js` missing from repo** | Extension unshippable — content script 404s in *both* MV2 and MV3. | **Certain (present now)** | M0/M1 resolves it by de-jQuery (UI U1 = MV3 Phase 0.1). This is the first milestone and a gate. No risk if M0 lands. |
| **`isRegex` mislabeled "Case Insensitive?"** (`index.htm:62`; UI §1.1 C3) | Users toggle regex mode thinking they toggle case; silent wrong behavior. | High (latent today) | UI §3.2 F-2 splits into an honest "Match type" (Text/Regex) + "Match case" control; migration maps `isRegex→matchType` with `caseSensitive=false` to preserve today's `"gi"` behavior (UI §4.1). |
| **Positional parallel arrays** (`toReplace`/`replaceWith`, `findBoxes[index]`; UI §1.1) | Off-by-one landmines; a future add/remove silently corrupts the ruleset. | Medium | UI §4.1 replaces them with a single `Array<Rule>` object model; the "no parallel arrays" grep gate (UI §4.5, A12) makes this CI-enforceable. |
| **`clear()`-then-`set` save race** (`index.js:42-51`; UI §1.1 C12) | Data-loss window: a failure between the two calls leaves storage empty. | Medium | M1 makes Save a **single atomic `sync.set`**; no `clear()` (MV3 Phase 0.2 / UI §4.1). A grep gate (UI §4.5) enforces it. |
| **Self-matching rule loop** (e.g. `A→B` then `B→A`) | `MutationObserver` re-enters and hangs the tab. | Low–Medium | M1 adds a re-entrancy flag (MV3 Phase 0.3); UI shows "cycle detected, stopped" (UI §3.3 F-3 / A12). |
| **Service-worker listener registered async** | Listener never attaches → `onInstalled`/`onStartup` no-op after the worker tears down. | Low (current code is already synchronous) | MV3 §3.1 documents the "top-level & synchronous" rule; M2's DoD re-verifies it after the rename. |
| **A11y regression** | Fails WCAG AA / store accessibility expectations. | Medium | M5 gates on axe-core = 0 violations + a keyboard-only + VoiceOver/TalkBack walkthrough (UI §5, A1–A15 / UI §3.5). |
| **Scope creep on permissions** | Adding `all_urls`/`scripting`/`alarms` widens attack surface and store risk. | Low | The MV3 §1 audit pins the surface to `["storage"]` with zero additions; grep/CSP gates (UI §4.5) make drift visible. |
| **MV3 flip regresses the live extension** | A broken v3.0.0 ships before v2.0.3 is confirmed replaced. | Low | M4/M5 gate the flip; the MV2 v2.0.3 baseline (M1) **stays published** until M6 confirms v3.0.0 in the wild. |

### 5.3 Explicit N/A (verified unused — recorded so the sweep is complete, not skipped)

From the MV3 API map (§2.3, rows 9, 10, 12–18, 19):

- `webRequest` blocking → `declarativeNetRequest`: **not used** — no network interception.
- `webNavigation`: **not used** — no navigation events consumed.
- `chrome.tabs.*`, `chrome.scripting`, `XHR`-in-worker, `setTimeout`/`setInterval` in worker: **not used**. `setTimeout`/`setInterval` are *noted* only for future keep-alive: use `chrome.alarms` at ≥30 s if/when needed (MV3 §3.3).
- `web_accessible_resources`, `externally_connectable`, `inpage`, `devtools_page`, `minimum_chrome_version`, `browser_specific_settings`, `incognito`: **not requested / not used** (recorded for completeness).

---

## 6. Acceptance & Readability Check

**Self-containment.** Every symbol, decision, and reference in this document is defined within it; a new engineer/designer can start at §1 and reach §4/§5 with a build order and a per-milestone DoD. Cross-lane references are explicit ("MV3 §…", "UI §…", "MV3 Phase N") and resolve to the numbered sub-sections of the corresponding lane (§2/§3), as described in the cross-reference note above the TOC.

**Both plans present.** §2 is the complete MV3 lane (its §1–§6, incl. the permission audit in §2's §1 and the API map in its §2); §3 is the complete UI lane (its §1–§6, incl. the a11y checklist in its §5). Neither is summarized away — full tables and code blocks are retained.

**Unified roadmap.** §4 interleaves MV3 Phase 0–5 (MV3 lane §5) with UI Step U1–U5 (UI lane §2.4) across milestones M0–M6, with a per-milestone Definition of Done and the six shared-decision alignments.

**No dangling references / no TODO placeholders.** The readability audit (run over the assembled document) confirms:

| Check | Result |
|---|---|
| No `TODO` / `FIXME` / `TBD` / `lorem` / `fill-in` placeholders | clean |
| Every `§n.n` / `Phase N` / `U N` / `M N` reference resolves to a defined item | clean (cross-lane refs are lane-qualified: "MV3 §…" / "UI §…" / "MV3 Phase N") |
| Both lanes' acceptance checklists present (MV3 §0 / §6, UI §0 / §6) | present |
| Open questions carry chosen defaults, non-blocking (§5.1) | present |
| Risks carry likelihood + mitigation (§5.2) | present |
| N/A items recorded explicitly, not omitted (§5.3) | present |

**Downstream acceptance (from the two lanes):** MV3 — all 5 `chrome.*` APIs mapped, permission surface minimal (`["storage"]`, zero added), rollout has a DoD per phase (MV3 §6). UI — no jQuery in the proposed architecture, every flow F-1…F-5 has a named interaction + a11y anchor, a11y checklist A1–A15 present, strategy evaluated on bundle size **and** V3 CSP, and a component contract that lets engineering build without a design re-sign-off (UI §6).
