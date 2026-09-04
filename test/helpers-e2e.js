/*
 * test/helpers-e2e.js — browser-fidelity harness for the E2E / a11y suites.
 *
 * The shipped extension pages (options.html, popup.html) load their scripts via
 * <script src> with NO module system. The production-relevant global object is
 * `window`, NOT the Node `global`. That distinction is what the module-isolated
 * unit tests (test/*.test.js, run under node --test with a mocked global.chrome)
 * cannot see — so this harness reproduces the *runtime* of a Chrome extension
 * page: each script is eval'd inside a jsdom window where `require`/`global`
 * behave like a real page, and the chrome API is attached as window.chrome.
 *
 * Two load modes, documented in the report:
 *   (1) evalRealChromeFree — eval the page's scripts exactly as shipped, with the
 *       Node-only globals (require, global) hidden. Used to PROVE the wiring
 *       breakage that the node unit runner masks.
 *   (2) makeFixtureWindow — a controllable page (real HTML fragment + full
 *       chrome mock + pre-built window.CCStorage / CcRuleRow) so a journey can be
 *       driven and the happy path asserted.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { makeChromeMock, ROOT } = require("./helpers");

/**
 * Eval a single project script inside `win`, mirroring a real browser script
 * execution: `require` is undefined, and (in production) the global object is the
 * window, so a bare `global` reference throws ReferenceError — exactly what a
 * page sees. This is the mode that exposes the §4 wiring breakage.
 *
 * @param {DOMWindow} win
 * @param {string} file path-relative to ROOT, e.g. "storage.js"
 * @returns {Error|null} the error thrown, or null
 */
function evalRealChromeFree(win, file) {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
   // Wrap so we capture the error instead of letting it escape the outer harness.
  try {
    win.eval(code);
    return null;
   } catch (e) {
    return e;
   }
}

/**
 * A controllable page: returns { win, dom, chrome, document, evalOrder }.
 * `predefine` runs first so the real options.js / popup.js can reach
 * window.CCStorage / window.CcRuleRow without the missing-script breakage.
 */
function makeFixtureWindow(pageHtml, { initial, predefine } = {}) {
  const dom = new JSDOM(pageHtml, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.com/page.html",
     });
  const chrome = makeChromeMock(initial || {});
  const win = dom.window;
  win.chrome = chrome;
   // Provide the page-global chrome the controllers expect.
  if (predefine) predefine(win, chrome);
  return { dom, win, chrome, document: win.document, evalOne: (f) => evalRealChromeFree(win, f) };
}

/**
 * Build a controllable window for a shipped controller (options.js / popup.js).
 * Pre-loads lib/rules.js + storage.js so window.CCRules + window.CCStorage exist,
 * and (when controller === "options") also cc-rule-row.js so the element is
 * defined. Returns the window plus a `runController` that eval's the controller
 * and invokes its exposed init() — the two pieces the shipped page omits.
 */
function makeControllerWindow({ controller, initial, html } = {}) {
  const chrome = makeChromeMock(initial || {});
  const dom = new JSDOM(html || defaultOptionsHtml(), {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.com/options.html",
     });
  const win = dom.window;
  win.chrome = chrome;
   // lib/rules.js sets window.CCRules (its window branch fires because the window
   // global object exists). storage.js then attaches window.CCStorage.
  win.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "storage.js"), "utf8"));
  if (controller === "options") {
    win.eval(fs.readFileSync(path.join(ROOT, "cc-rule-row.js"), "utf8"));
    win.eval(fs.readFileSync(path.join(ROOT, "options.js"), "utf8"));
     } else {
    win.eval(fs.readFileSync(path.join(ROOT, "popup.js"), "utf8"));
     }
  return {
    dom, win, chrome, document: win.document,
    // Drive the controller the way a correct page would.
    init: function () {
      // The controller exposes init() only in its module export; in the window it
      // is a global function. Invoke it directly.
      if (typeof win.init === "function") { win.init(); return; }
       // Fall back to the exposed module shape if present.
      if (win.__ccOptions && typeof win.__ccOptions.init === "function") win.__ccOptions.init();
      },
   };
}

function defaultOptionsHtml() {
   return [
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"></head>",
        "<body>",
         "     <main id=\"main\"><h1><span class=\"cc-word--content\">Content</span> <span class=\"cc-word--censor\">Censor</span> — Settings</h1>",
        "      <section aria-labelledby=\"status-label\">",
        "        <h2 id=\"status-label\">Status</h2>",
        "        <p id=\"cc-message\" role=\"status\" aria-live=\"polite\" hidden></p>",
        "        <p id=\"cc-summary\" role=\"status\" aria-live=\"polite\">0 terms active · last updated —</p>",
        "        <p id=\"cc-dirty\" role=\"status\" aria-live=\"polite\" class=\"cc-dirty\" hidden>Unsaved</p>",
        "      </section>",
        "      <section aria-labelledby=\"rules-label\">",
        "        <div class=\"cc-toolbar\">",
        "        <h2 id=\"rules-label\">Replacement rules</h2>",
        "        <div class=\"cc-toolbar-actions\">",
        "         <button id=\"cc-toggle-all\" type=\"button\">Toggle all</button>",
        "         <button id=\"cc-add\" type=\"button\">+ Add rule</button>",
        "         <button id=\"cc-save\" type=\"button\" disabled>Save</button>",
        "        </div>",
        "       </div>",
        "        <ul id=\"cc-grid\" role=\"list\" aria-label=\"Replacement rules\" class=\"cc-grid\"></ul>",
        "        <p id=\"cc-empty\" class=\"cc-empty\" hidden>No rules yet — add your first replacement.</p>",
        "      </section>",
        "    </main>",
        "</body></html>"].join("\n");
}

async function flush(win, ms) {
  const t = win ? win.setTimeout : setTimeout;
  await new Promise((r) => t(r, ms === undefined ? 5 : ms));
}

/** Run several microtask/timeout ticks so chained chrome callbacks settle. */
async function settle(win, n) {
  for (let i = 0; i < (n || 4); i++) await flush(win, 3);
}

module.exports = {
  ROOT,
  makeChromeMock,
  evalRealChromeFree,
  makeFixtureWindow,
  makeControllerWindow,
  defaultOptionsHtml,
  flush,
  settle
};
