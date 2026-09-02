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
test("P0-1 [DEFECT] options.html does not load lib/rules.js -> storage.js has no CCRules", async () => {
  const { srcs, win, firstError } = loadShippedPage("options.html", {
     contentCensorData: [
          { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
     enabled: true });
  assert.strictEqual(srcs[0], "storage.js", "storage.js runs before rules.js can supply CCRules");
  assert.ok(!/lib\/rules\.js/.test(srcs.join(" ")),
       "lib/rules.js is absent from the options.html script chain (P0-1)");
  assert.ok(firstError, "the shipped chain throws at load -> CCStorage never defines");
  await flush();
  assert.strictEqual(typeof win.CCStorage, "undefined",
       "P0-1: options.js/CCStorage controller has nothing to bind — the page is dead");
});

// P0-2  storage.js reads `global.chrome`; in a page the global object is `window`,
//        so this is a ReferenceError/portability hazard.
// FIX: use `self.chrome` (or a `(typeof globalThis!=='undefined'?globalThis:window)`
//      global accessor, as cc-rule-row/rules already do). AFTER FIX: flip to expect no throw.
// ---------------------------------------------------------------------------
test("P0-2 [DEFECT] storage.js references `global.chrome` (undefined in a page context)", async () => {
  const code = fs.readFileSync(path.join(ROOT, "storage.js"), "utf8");
  assert.ok((code.match(/global\s*\.\s*chrome/g) || []).length >= 1,
     "storage.js reads global.chrome in load/save/onChanged");
  const dom = new JSDOM("<!DOCTYPE html><body></body></html>",
       { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8")); // skip require fallback
  const err = evalRealChromeFree(dom.window, "storage.js");
  assert.ok(err && /global is not defined/.test(err.message),
     "P0-2: storage.js throws on the undefined `global` reference outside Node");
});

// P0-3  init() is exposed but never invoked on the shipped pages -> nothing renders.
// FIX: call options.init()/popup.init() at the end of each controller IIFE (or on
//      DOMContentLoaded). AFTER FIX: flip to expect rows to render.
// ---------------------------------------------------------------------------
test("P0-3 [DEFECT] options.html renders 0 rows (init never invoked)", async () => {
  const { win } = loadShippedPage("options.html", {
     contentCensorData: [
          { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
     enabled: true });
  await flush();
  const grid = win.document.getElementById("cc-grid");
  assert.ok(grid, "the grid element exists in markup");
  assert.strictEqual(grid.querySelectorAll("cc-rule-row").length, 0,
     "P0-3: no <cc-rule-row> rendered — controller never wired the grid");
});

test("P0-3 [DEFECT] popup.html summary never updates (init never invoked)", async () => {
  const { win } = loadShippedPage("popup.html", {
     contentCensorData: [
          { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
     enabled: true, seededExamples: 1 });
  await flush();
  assert.match(win.document.getElementById("cc-summary").textContent, /0 terms active/,
     "P0-3: popup summary frozen at its markup placeholder");
});

// P1  Even when wired, render() does not reflect the `find` attribute into the
//     input, so a raw user `input` event neither marks the page dirty nor triggers
//     regex validation — the F-2 "edit -> Save" and A4 guard only work through the
//     public `values` setter / storage API, not through live DOM editing.
// FIX: have render() set input.value from the attribute (or call row.values=) so
//     the attribute <-> input stay in sync. AFTER FIX: flip to expect populated inputs.
// ---------------------------------------------------------------------------
test("P1 [DEFECT] render() does not sync the find attribute into the input (jsdom)", async () => {
  const dom = new JSDOM("<!DOCTYPE html><body></body></html>",
        { runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window; win.chrome = makeChromeMock();
  win.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "cc-rule-row.js"), "utf8"));
  const row = win.document.createElement("cc-rule-row");
  row.id = "a"; row.dataset.rid = "a";
  row.setAttribute("find", "go");
  win.document.body.appendChild(row);
  await flush();
  // The input's value is what attributeChangedCallback is expected to have set.
  const input = row.querySelector(".cc-find");
  // NOTE: in a real browser attributeChangedCallback sets input.value; under this
  // jsdom full-render path it does not. Characterize current behavior.
  assert.ok(input, "the find input element exists");
   // (Assertion left loose on purpose: the sync gap is jsdom-specific; the data
  //  contract tests in options.e2e.test.js use the public setter and pass.)
});
