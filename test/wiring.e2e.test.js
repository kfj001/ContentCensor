/*
 * test/wiring.e2e.test.js — SHIPPED-PAGE INTEGRATION (the runtime the unit tests
 * cannot reach).
 *
 * The module-isolated unit suite (test/*.test.js) `require()`s each module under
 * node --test with a mocked global.chrome, so Node's `require`/`global` fallbacks
 * in each IIFE hide a class of breakage. This file loads options.html / popup.html
 * EXACTLY as the browser does — eval each <script src> in document order inside a
 * jsdom window where `require` is undefined (as in Chrome) — and asserts the
 * shipped wiring.
 *
 * FINDINGS (reproduced by these tests, reported as P0 in the QA report):
 *   P0-1  lib/rules.js is NOT loaded by options.html/popup.html, yet storage.js
 *         (loaded first) depends on window.CCRules; the node require() fallback
 *         masks this — in a page the chain is broken.
 *   P0-2  storage.js reads `global.chrome` (load/save/onChanged), undefined in a
 *         window context -> ReferenceError at load.
 *   P0-3  options.js/popup.js expose init() but DO NOT invoke it -> the pages
 *         never render; grids stay empty, summaries stay at placeholder.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { makeChromeMock, evalRealChromeFree, ROOT } = require("./helpers-e2e");

const flush = () => new Promise((r) => setTimeout(r, 5));

// Load a shipped page: eval its <script src> in document order, chrome-mocked,
// `require` UNDEFINED (real-chrome-free). Returns diagnostics, never throws.
function loadShippedPage(filename, initial) {
  const html = fs.readFileSync(path.join(ROOT, filename), "utf8");
  const chrome = makeChromeMock(initial || {});
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.com/" + filename,
      });
  const win = dom.window;
  win.chrome = chrome;
    // Exactly the browser: the script chain, no module fallback.
  const srcs = [].slice.call(win.document.querySelectorAll("script[src]"))
      .map((s) => s.getAttribute("src"));
  let firstError = null;
  for (const src of srcs) {
    const err = evalRealChromeFree(win, src);
    if (err && !firstError) firstError = src + " -> " + err.constructor.name + ": " + err.message;
      }
  return { win, chrome, dom, srcs, firstError };
}

// -------------------------------------------------------------------------
// P0-1: options.html script chain is broken (lib/rules.js absent, storage.js 1st)
// -------------------------------------------------------------------------
test("[P0-1] options.html script chain is broken as shipped", async () => {
  const { srcs, firstError, win } = loadShippedPage("options.html", {
     contentCensorData: [
        { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
        { id: "b", find: "hi", replace: "there", matchType: "text", enabled: true }],
     enabled: true
     });

  assert.ok(firstError, "the shipped chain throws at load (proves P0)");
  assert.strictEqual(srcs[0], "storage.js",
      "storage.js runs FIRST, before lib/rules.js supplies window.CCRules");
  assert.ok(!/lib\/rules\.js/.test(srcs.join(" ")),
      "lib/rules.js is NOT in the page's script chain");
  assert.strictEqual(typeof win.CCStorage, "undefined",
      "window.CCStorage was never defined — the grid controller has nothing to bind (P0-1)");
});

// P0-2: storage.js reads `global.chrome` (load/save/onChanged), which resolves in
// Node (global === Node's global) but is a portability hazard in a page context,
// where the global object is `window`. Load rules.js first so we isolate the
// `global` reference from the broken-script-chain crash (that's P0-1).
test("[P0-2] storage.js uses `global.chrome` in load/save/onChanged (portability hazard)", async () => {
  const code = fs.readFileSync(path.join(ROOT, "storage.js"), "utf8");
  const hits = (code.match(/global\s*\.\s*chrome/g) || []).length;
  assert.ok(hits >= 1,
     "storage.js reads global.chrome in load/save/onChanged (breaks page portability)");

     // With window.CCRules present (rules.js loaded first), storage.js no longer
     // hits its require() fallback; the next failure is the undefined-`global`
     // reference — the portability hazard.
  const dom = new JSDOM("<!DOCTYPE html><body></body></html>",
      { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8"));
  const err = evalRealChromeFree(dom.window, "storage.js");
  assert.ok(err && /global is not defined/.test(err.message),
     "outside Node, the `global.chrome` reference throws before storage.js can wire (P0-2)");
});

// P0-3: the shipped pages never invoke init() -> they render nothing.
test("[P0-3] options.html renders no rows as shipped (init never invoked)", async () => {
  const { win } = loadShippedPage("options.html", {
     contentCensorData: [
        { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
     enabled: true
     });
  await flush(); await flush();
  const grid = win.document.getElementById("cc-grid");
  assert.ok(grid, "the grid element exists in the markup");
  assert.strictEqual(grid.querySelectorAll("cc-rule-row").length, 0,
       "no <cc-rule-row> rendered — the controller never wired the grid (P0-3)");
});

// P0-3b: popup.html stays at its placeholder summary as shipped.
test("[P0-3b] popup.html summary never updates as shipped (init never invoked)", async () => {
  const { win } = loadShippedPage("popup.html", {
     contentCensorData: [
        { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
     enabled: true, seededExamples: 1
     });
  await flush(); await flush();
  const summary = win.document.getElementById("cc-summary");
  assert.match(summary.textContent, /0 terms active/,
      "summary is frozen at the markup placeholder — controller never rendered it (P0-3b)");
  const preview = win.document.getElementById("cc-preview");
  assert.strictEqual(preview.children.length, 0,
       "no rule preview rendered as shipped (P0-3b)");
});

// -------------------------------------------------------------------------
// CORRECTED happy-path harness: prove what a properly-wired page DOES.
// This is what §4.3 requires; the shipped pages omit it.
// -------------------------------------------------------------------------
async function loadWiredOptionsPage(initial) {
  const chrome = makeChromeMock(initial || {});
  const html = fs.readFileSync(path.join(ROOT, "options.html"), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://example.com/options.html",
      });
  const win = dom.window;
  win.chrome = chrome;
    // The global object a page provides (so storage.js's global.chrome resolves).
  win.global = win;
    // Correct script order the shipped pages omit.
  win.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "cc-rule-row.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "storage.js"), "utf8"));
    // options.js IIFE leaves init() out of scope; invoke via the exposed module
    // shape by re-eval into a scope that captures it.
  const optsCode = fs.readFileSync(path.join(ROOT, "options.js"), "utf8")
     .replace(/if \(typeof module\s*!==\s*"undefined"\s*&&\s*module\.exports\)\s*module\.exports\s*=\s*\{[\s\S]*?\}\s*?\}\)\(\);?/s, "")
     ;
    // Simpler: eval with a module shim so init() becomes reachable.
  const module = { exports: {} };
  const optsFn = new Function("module", "window", "document", "chrome", "global", optsCode);
  optsFn(module, win, win.document, chrome, win);
  if (module.exports && typeof module.exports.init === "function") module.exports.init();
  await new Promise((r) => setTimeout(r, 10));
  return { win, chrome, document: win.document, api: module.exports };
}

test("[recovery] a correctly-wired options page renders all loaded rows", async () => {
  const { document } = await loadWiredOptionsPage({
     contentCensorData: [
        { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
        { id: "b", find: "hi", replace: "there", matchType: "text", enabled: true }],
     enabled: true
     });
  assert.strictEqual(document.querySelectorAll("cc-rule-row").length, 2,
       "when rules.js loads first and init() runs, both rows render (the fix)");
});
