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
// P0-1 [FIXED]: lib/rules.js is now FIRST in the options.html script chain, so
// storage.js finds window.CCRules and window.CCStorage is defined on load.
// -------------------------------------------------------------------------
test("[P0-1] options.html loads lib/rules.js before storage.js (chain fixed)", async () => {
  const { srcs, firstError, win } = loadShippedPage("options.html", {
     contentCensorData: [
        { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
        { id: "b", find: "hi", replace: "there", matchType: "text", enabled: true }],
     enabled: true
      });

  assert.ok(!firstError,
       "the shipped chain now loads cleanly — P0-1 fixed (lib/rules.js first)");
  assert.strictEqual(srcs[0], "lib/rules.js",
       "lib/rules.js runs FIRST, supplying window.CCRules before storage.js");
  assert.ok(/lib\/rules\.js/.test(srcs.join(" ")),
       "lib/rules.js is now in the page's script chain (the fix)");
  const idxRules = srcs.indexOf("lib/rules.js");
  const idxStorage = srcs.indexOf("storage.js");
  assert.ok(idxRules >= 0 && idxStorage > idxRules,
       "lib/rules.js loads before storage.js (dependency order, mirrors manifest.content_scripts)");
  assert.strictEqual(typeof win.CCStorage, "object",
       "window.CCStorage is now defined — storage.js stopped hitting its require() fallback (P0-1)");
});

// P0-2: storage.js reads `global.chrome` (load/save/onChanged), which resolves in
// Node (global === Node's global) but is a portability hazard in a page context,
// where the global object is `window`. Load rules.js first so we isolate the
// `global` reference from the broken-script-chain crash (that's P0-1).
// P0-2 [FIXED]: storage.js resolves chrome via window/globalThis, so it no longer
// throws on an undefined `global` in a page context. Load rules.js first so the
// require() fallback is skipped, then eval storage.js in a chrome-free window.
test("[P0-2] storage.js no longer reads `global.chrome` (portability fixed)", async () => {
  const code = fs.readFileSync(path.join(ROOT, "storage.js"), "utf8");
  assert.strictEqual((code.match(/global\s*\.\s*chrome/g) || []).length, 0,
        "storage.js no longer reads bare global.chrome anywhere");

  // With lib/rules.js loaded, storage.js has CCRules; the only remaining failure
  // it used to be was the undefined-`global` reference — now it resolves chrome
  // through window/globalThis and does not throw on `global` being undefined.
  const dom = new JSDOM("<!DOCTYPE html><body></body></html>",
        { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8"));
  const err = evalRealChromeFree(dom.window, "storage.js");
  assert.ok(!err || !/global is not defined/.test(err && err.message || ""),
        "P0-2 fixed: storage.js no longer throws on an undefined `global` outside Node");
});

// P0-3 [FIXED]: the options page now self-invokes init() at load, so the grid
// renders rows on its own — no test-harness call required.
test("[P0-3] options.html renders its loaded rows on load (init self-invoked)", async () => {
  const { win } = loadShippedPage("options.html", {
     contentCensorData: [
        { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
     enabled: true
      });
  await flush(); await flush();
  const grid = win.document.getElementById("cc-grid");
  assert.ok(grid, "the grid element exists in the markup");
  assert.strictEqual(grid.querySelectorAll("cc-rule-row").length, 1,
       "the controller self-invokes init() and wires the grid (P0-3 fixed)");
});

// P0-3b [FIXED]: the popup page self-invokes init() at load, so its summary
// reflects the ruleset instead of the markup placeholder.
test("[P0-3b] popup.html summary updates on load (init self-invoked)", async () => {
  const { win } = loadShippedPage("popup.html", {
     contentCensorData: [
        { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
     enabled: true, seededExamples: 1
      });
  await flush(); await flush();
  const summary = win.document.getElementById("cc-summary");
  assert.ok(!/0 terms active/.test(summary.textContent),
        "summary reflects the ruleset — the controller rendered it (P0-3b fixed)");
  const preview = win.document.getElementById("cc-preview");
  assert.ok(preview && preview.children.length === 1,
        "preview shows the one active rule — the render ran (P0-3b fixed)");
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
