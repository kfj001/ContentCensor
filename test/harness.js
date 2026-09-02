/*
 * test/harness.js — controllable page harness for the F-1 / F-2 journey +
 * cross-surface E2E tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * The shipped pages omit two things the spec requires (§4.3 / §3):
 *   (a) lib/rules.js is not in the <script> chain the pages declare, and
 *   (b) the controllers expose init() but never call it.
 * storage.js also reads `global.chrome`, which is undefined in a real page.
 * All three are proven broken by test/wiring.e2e.test.js.
 *
 * To exercise the *happy path* (so the journey tests can assert the intended
 * behaviour), this harness wires a page the way §4.3 says it should be wired:
 *   1. eval lib/rules.js, cc-rule-row.js, storage.js into the window in order
 *      (so window.CCStorage / window.CcRuleRow exist);
 *   2. provide `global = window` so storage.js's `global.chrome` resolves;
 *   3. eval the controller with a module shim and invoke its init().
 * The journey tests then drive the page by real DOM events + keyboard.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { makeChromeMock, ROOT } = require("./helpers-e2e");

async function settle(win, n) {
  for (let i = 0; i < (n === undefined ? 4 : n); i++) {
    await new Promise((r) => win.setTimeout(r, 3));
   }
}

/**
 * Build a fully-wired options page.
 * @param {object} opts { initial, html }
 * @returns {Promise<{win,chrome,document,api,grid,els,fire} }>
 */
async function loadOptionsPage(opts) {
  opts = opts || {};
  const chrome = makeChromeMock(opts.initial || {});
  const html = opts.html || defaultOptionsHtml();
  const dom = new JSDOM(html, {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://example.com/options.html",
      });
  const win = dom.window;
  win.chrome = chrome;
  win.global = win;                       // so storage.js's global.chrome resolves

   // 1. dependency chain (the shipped pages omit rules.js).
  win.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "cc-rule-row.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "storage.js"), "utf8"));

   // 2. invoke the controller's init() via a module shim.
  const module = { exports: {} };
  const code = fs.readFileSync(path.join(ROOT, "options.js"), "utf8");
  const fn = new Function("module", "window", "document", "chrome", "global", code);
  fn(module, win, win.document, chrome, win);
  const api = module.exports;
  if (api && typeof api.init === "function") api.init();
  await settle(win);

  const d = win.document;
  const els = {
    grid: d.getElementById("cc-grid"),
    add: d.getElementById("cc-add"),
    save: d.getElementById("cc-save"),
    master: d.getElementById("cc-master"),
    summary: d.getElementById("cc-summary"),
    message: d.getElementById("cc-message"),
    empty: d.getElementById("cc-empty"),
    dirty: d.getElementById("cc-dirty"),
      };
  return { win, chrome, dom, document: d, api, els };
}

/** Build a fully-wired popup page. */
async function loadPopupPage(opts) {
  opts = opts || {};
  const chrome = makeChromeMock(opts.initial || {});
  const html = opts.html || defaultPopupHtml();
  const dom = new JSDOM(html, {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://example.com/popup.html",
      });
  const win = dom.window;
  win.chrome = chrome;
  win.global = win;
  win.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "storage.js"), "utf8"));

  const module = { exports: {} };
  const code = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  const fn = new Function("module", "window", "document", "chrome", "global", code);
  fn(module, win, win.document, chrome, win);
  const api = module.exports;
  if (api && typeof api.init === "function") api.init();
  await settle(win);
  return { win, chrome, dom, document: win.document, api };
}

/** Load content.js (the injected script) into a host page the manifest way. */
function loadContentPage(pageHtml, initial) {
  const chrome = makeChromeMock(initial || {});
  const dom = new JSDOM(pageHtml || "<!DOCTYPE html><html><body></body></html>",
      { runScripts: "outside-only", pretendToBeVisual: true,
        url: "https://example.com/host.html" });
  const win = dom.window;
  win.chrome = chrome;
  win.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "content.js"), "utf8"));
  return { win, chrome, dom, document: win.document };
}

// Fire a real DOM event on an element (the way a user's input/click does).
function fireWin(win, el, type, opts) {
  const Cls = win.Event;
  el.dispatchEvent(new Cls(type, opts || { bubbles: true }));
}

// The default options page markup (mirrors options.html's element ids).
function defaultOptionsHtml() {
  return [
       "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"></head>",
       "<body>",
       "  <main id=\"main\"><h1>Content Censor — Settings</h1>",
       "   <section aria-labelledby=\"master-label\">",
       "    <h2 id=\"master-label\">Status</h2>",
       "    <div class=\"cc-switch-row\">",
       "     <button id=\"cc-master\" type=\"button\" role=\"switch\" aria-checked=\"true\" aria-label=\"Apply replacements on this profile\"></button>",
       "     <p id=\"cc-message\" role=\"status\" aria-live=\"polite\" hidden></p>",
       "    </div>",
       "    <p id=\"cc-summary\" role=\"status\" aria-live=\"polite\">0 terms active · last updated —</p>",
       "    <p id=\"cc-dirty\" role=\"status\" aria-live=\"polite\" class=\"cc-dirty\" hidden>Unsaved</p>",
       "   </section>",
       "   <section aria-labelledby=\"rules-label\">",
       "    <div class=\"cc-toolbar\">",
       "     <h2 id=\"rules-label\">Replacement rules</h2>",
       "     <button id=\"cc-toggle-all\" type=\"button\">Toggle all</button>",
       "     <button id=\"cc-add\" type=\"button\">+ Add rule</button>",
       "     <button id=\"cc-save\" type=\"button\" disabled>Save</button>",
       "    </div>",
       "    <ul id=\"cc-grid\" role=\"list\" aria-label=\"Replacement rules\" class=\"cc-grid\"></ul>",
       "    <p id=\"cc-empty\" class=\"cc-empty\" hidden>No rules yet — add first replacement.</p>",
       "   </section></main>",
       "</body></html>"].join("\n");
}

// The default popup markup (mirrors popup.html's element ids).
function defaultPopupHtml() {
  return [
       "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"></head>",
       "<body class=\"cc-popup\">",
       " <main id=\"main\" aria-labelledby=\"cc-h1\">",
       "  <h1 id=\"cc-h1\">Content Censor</h1>",
       "  <p id=\"cc-lede\" class=\"cc-lede\">Replace terms on the pages you visit.</p>",
       "  <section aria-label=\"Replacements status\">",
       "   <button id=\"cc-master\" type=\"button\" role=\"switch\" aria-checked=\"true\" aria-labelledby=\"cc-h1\" aria-label=\"Apply replacements on this profile\"></button>",
       "   <p id=\"cc-summary\" role=\"status\" aria-live=\"polite\">0 terms active · last updated —</p>",
       "   <button id=\"cc-open-settings\" type=\"button\" class=\"cc-primary\">Open settings</button>",
       "   <button id=\"cc-toggle-all\" type=\"button\">Toggle all</button>",
       "  </section>",
       "  <p id=\"cc-h2\" class=\"cc-h2\" role=\"heading\" aria-level=\"2\">Active terms</p>",
       "  <ul id=\"cc-preview\" role=\"list\" aria-label=\"First three active replacement terms\"></ul>",
       " </main></body></html>"].join("\n");
}

module.exports = {
  ROOT, makeChromeMock,
  loadOptionsPage, loadPopupPage, loadContentPage,
  fireWin, settle,
  defaultOptionsHtml, defaultPopupHtml,
};
