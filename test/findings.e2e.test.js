/*
 * test/findings.e2e.test.js — PRODUCTION-WIRING DEFECTS found by the E2E suite.
 *
 * These are the findings that block the shipped extension from running. They are
 * FAILING-by-design "characterization" tests: each one currently PASSES only
 * because it asserts the CURRENT broken behavior (e.g. "the grid is empty"), so
 * the suite stays green AND the report has a stable, re-runnable record of the
 * defect. When the engineer fixes the wiring (load lib/rules.js, fix
 * global.chrome, invoke init()), these assertions must be FLIPPED to expect the
 * healthy state (see the comment on each) to avoid silently re-breaking.
 *
 * Cross-referenced in the QA report as P0-1, P0-2, P0-3.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { makeChromeMock, evalRealChromeFree, ROOT } = require("./helpers-e2e");

const flush = () => new Promise((r) => setTimeout(r, 5));

function loadShippedPage(filename, initial) {
  const html = fs.readFileSync(path.join(ROOT, filename), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://example.com/" + filename,
       });
  const win = dom.window; win.chrome = makeChromeMock(initial || {});
  const srcs = [].slice.call(win.document.querySelectorAll("script[src]"))
       .map((s) => s.getAttribute("src"));
  let firstError = null;
  for (const src of srcs) {
    const err = evalRealChromeFree(win, src);
    if (err && !firstError) firstError = err;
      }
  return { win, dom, srcs, firstError };
}

// ---------------------------------------------------------------------------
// P0-1  lib/rules.js is not in the page script chain, yet storage.js (loaded
//        first) needs window.CCRules; the Node require() fallback hides this.
// FIX: add <script src="lib/rules.js"> before storage.js in options.html + popup.html.
//      AFTER FIX: flip this test to expect window.CCStorage to be DEFINED.
// ---------------------------------------------------------------------------
// P0-1 [FIXED] lib/rules.js now runs FIRST in the options.html script chain, so
// storage.js finds window.CCRules and defines window.CCStorage without its
// Node-only require() fallback. Assert the healthy chain.
// (This test was a FAILING-by-design characterization of the broken state; the fix
// adds <script src="lib/rules.js"> before storage.js — see QA-REPORT §5.1.)
test("P0-1 [FIXED] options.html loads lib/rules.js first -> storage.js defines CCStorage", async () => {
  const { srcs, win, firstError } = loadShippedPage("options.html", {
     contentCensorData: [
           { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
     enabled: true });
  assert.ok(!firstError, "the shipped chain loads without a ReferenceError (P0-1 fixed)");
  assert.strictEqual(srcs[0], "lib/rules.js",
        "lib/rules.js runs FIRST, before storage.js needs window.CCRules");
  assert.ok(/lib\/rules\.js/.test(srcs.join(" ")),
        "lib/rules.js is present in the options.html script chain");
  const idxRules = srcs.indexOf("lib/rules.js");
  const idxStorage = srcs.indexOf("storage.js");
  assert.ok(idxRules >= 0 && idxStorage > idxRules,
        "lib/rules.js loads before storage.js (dependency order)");
  await flush();
  assert.strictEqual(typeof win.CCStorage, "object",
        "P0-1 fixed: storage.js defined window.CCStorage — the controller has a store to bind");
});

// P0-2  storage.js reads `global.chrome`; in a page the global object is `window`,
//        so this is a ReferenceError/portability hazard.
// FIX: use `self.chrome` (or a `(typeof globalThis!=='undefined'?globalThis:window)`
//      global accessor, as cc-rule-row/rules already do). AFTER FIX: flip to expect no throw.
// ---------------------------------------------------------------------------
// P0-2 [FIXED] storage.js resolves chrome via window/globalThis, not a bare
// `global` reference. Load rules.js first and eval storage.js in a chrome-free
// jsdom window: it must NOT throw on an undefined `global`.
// (Fix: getChrome() helper — window.chrome → globalThis.chrome → Node global.)
test("P0-2 [FIXED] storage.js no longer references `global.chrome`", async () => {
  const code = fs.readFileSync(path.join(ROOT, "storage.js"), "utf8");
  assert.strictEqual((code.match(/global\s*\.\s*chrome/g) || []).length, 0,
         "storage.js no longer reads bare global.chrome in load/save/onChanged");
  const dom = new JSDOM("<!DOCTYPE html><body></body></html>",
         { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8")); // supplies CCRules
  const err = evalRealChromeFree(dom.window, "storage.js");
  assert.ok(!err || !/global is not defined/.test(err && err.message || ""),
         "P0-2 fixed: storage.js no longer throws on an undefined `global` outside Node");
});

// P0-3 [FIXED] the options page self-invokes init() at (DOM) load, so the grid
// renders without any test-harness call. Assert the healthy render.
// (Fix: load-time init() entry + idempotency guard in options.js — QA-REPORT §5.3.)
test("P0-3 [FIXED] options.html renders rows on load (init self-invoked)", async () => {
  const { win } = loadShippedPage("options.html", {
     contentCensorData: [
           { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
     enabled: true });
  await flush();
  const grid = win.document.getElementById("cc-grid");
  assert.ok(grid, "the grid element exists in markup");
  assert.strictEqual(grid.querySelectorAll("cc-rule-row").length, 1,
         "P0-3 fixed: init() self-invoked at load renders the row(s)");
});

test("P0-3 [FIXED] popup.html summary updates on load (init self-invoked)", async () => {
  const { win } = loadShippedPage("popup.html", {
     contentCensorData: [
           { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
     enabled: true, seededExamples: 1 });
  await flush();
  assert.ok(!/0 terms active/.test(win.document.getElementById("cc-summary").textContent),
          "P0-3 fixed: popup summary is no longer frozen at the markup placeholder");
});

// P1  Even when wired, render() used to drive inputs only via setAttribute,
//     relying on attribute->input reflection (attributeChangedCallback), which
//     is unreliable on the render/append lifecycle — so configured find/replace
//     values did NOT reach the input controls when settings opened.
// FIX: render() now binds configured values into the live inputs via the row's
//     public `values` setter (UI §4.2 two-way contract) instead of raw
//     setAttribute, so the attribute <-> input stay in sync.
// ---------------------------------------------------------------------------
// P1 [FIXED] Open settings: each row's inputs reflect the configured
// find/replace/matchType/case values via the public `values` binding.
test("P1 [FIXED] render() binds configured values into the input controls", async () => {
  const { loadOptionsPage } = require("./harness");
   const r = await loadOptionsPage({
    initial: {
      contentCensorData: [
           { id: "a", find: "go", replace: "stop", matchType: "text", caseSensitive: false, enabled: true },
           { id: "b", find: "tea", replace: "party", matchType: "regex", caseSensitive: true, enabled: true }
       ], enabled: true }
        });
  const rowA = r.document.querySelector('cc-rule-row[data-rid="a"]');
  const rowB = r.document.querySelector('cc-rule-row[data-rid="b"]');
  assert.ok(rowA, "the grid renders the configured rows");
  assert.strictEqual(rowA.querySelector(".cc-find").value, "go",
         "row a's find input shows the configured 'go'");
  assert.strictEqual(rowA.querySelector(".cc-replace").value, "stop",
         "row a's replace input shows the configured 'stop'");
  assert.strictEqual(rowB.querySelector(".cc-find").value, "tea",
         "row b's find input shows the configured 'tea'");
  assert.ok(rowB.querySelector('input[value="regex"]').checked,
         "row b's match type reflects its configured regex mode");
  assert.ok(rowB.querySelector(".cc-case-box").checked,
         "row b's case-sensitive flag reflects its configured value");
 });
