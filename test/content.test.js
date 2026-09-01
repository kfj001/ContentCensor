/*
 * test/content.test.js — content.js F-2 text replacement via jsdom:
 *  - the §4.4 transform applies enabled+non-empty rules by RegExp,
 *  - the MutationObserver catches later DOM changes,
 *  - the re-entrancy guard stops a self-matching pair (A12: "cycle detected"),
 *  - the master enabled flag makes the ruleset inert (Q2),
 *  - no parallel arrays (one Array transform, UI §4.4).
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
const { makeChromeMock } = require("./helpers");

// Load lib/rules.js + content.js into a jsdom window that has a chrome mock.
function loadContent(initial) {
  const store = Object.assign({}, initial || {});
  const chrome = makeChromeMock(initial);
  chrome._store = store;
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    runScripts: "outside-only", pretendToBeVisual: true
   });
  const win = dom.window;
  win.chrome = chrome;

  // rules.js sets globalThis.CCRules; content.js reads window.CCCore/CCRules.
   // Load rules.js first so the global exists before content.js evaluates.
  const fs = require("fs"), path = require("path");
  const ROOT = require("./helpers").ROOT;
  win.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8"));
  win.eval(fs.readFileSync(path.join(ROOT, "content.js"), "utf8"));
  return { dom, win, chrome, store };
}

async function flushWin(win) { await new Promise((r) => setTimeout(r, 0)); }

test("applies a text rule to existing text nodes", async () => {
  const { win, store } = loadContent();
  store.contentCensorData = [{ id: "a", find: "go", replace: "stop", matchType: "text", caseSensitive: false, enabled: true }];
  store.enabled = true;
    // content.js read storage at load (empty at that point); re-run via applyData.
  await flushWin(win);
  win.__ccContent.applyData({ contentCensorData: store.contentCensorData, enabled: true });
  const text = win.document.createTextNode("let us go home");
  win.document.body.appendChild(text);
  await flushWin(win);
  assert.strictEqual(text.nodeValue, "let us stop home");
});

test("regex rule compiles and replaces globally", async () => {
  const { win, store } = loadContent();
  store.contentCensorData = [{ id: "r", find: "\\d+", replace: "N", matchType: "regex", caseSensitive: false, enabled: true }];
  store.enabled = true;
  await flushWin(win);
  win.__ccContent.applyData({ contentCensorData: store.contentCensorData, enabled: true });
  const text = win.document.createTextNode("123 and 45");
  win.document.body.appendChild(text);
  await flushWin(win);
  assert.strictEqual(text.nodeValue, "N and N");
});

test("disabled rule is inert and the master enabled flag halts the ruleset (Q2)", async () => {
  const { win, store } = loadContent();
  const rules = [{ id: "a", find: "go", replace: "STOP", matchType: "text", enabled: false }];
  await flushWin(win);
  win.__ccContent.applyData({ contentCensorData: rules, enabled: true });
  const t1 = win.document.createTextNode("go");
  win.document.body.appendChild(t1);
  await flushWin(win);
  assert.strictEqual(t1.nodeValue, "go", "disabled rule did nothing");

  const enabledRules = [{ id: "a", find: "go", replace: "STOP", matchType: "text", enabled: true }];
  win.__ccContent.applyData({ contentCensorData: enabledRules, enabled: false });
  const t2 = win.document.createTextNode("go");
  win.document.body.appendChild(t2);
  await flushWin(win);
  assert.strictEqual(t2.nodeValue, "go", "master enabled=false makes the ruleset inert");
});

test("re-entrancy guard stops a self-matching pair instead of hanging (A12)", async () => {
  const { win, store } = loadContent();
    // "go" -> "ggo": each rewrite's output still contains "go", so without a
    // guard the MutationObserver would rewrite forever (ggo -> gggo -> ggggo …)
    // and wedge the tab. The guard must stop after one rewrite.
  const rules = [
     { id: "1", find: "go", replace: "ggo", matchType: "text", caseSensitive: false, enabled: true }
       ];
  await flushWin(win);
  win.__ccContent.setToastEnabled(true);
  win.__ccContent.applyData({ contentCensorData: rules, enabled: true });
  const text = win.document.createTextNode("go");
  win.document.body.appendChild(text);
    // Let several observer cycles settle; if it were an infinite loop this would
    // hang the test runner.
  for (let i = 0; i < 30; i++) await flushWin(win);
    // One rewrite then a stop: the node is the first output, never "ggggo" (growth).
  assert.strictEqual(text.nodeValue, "ggo", "A->B growth cycle stops at the first rewrite");
  assert.ok(win.__ccContent.isCycleDetected(), "cycle was detected + toast raised (A12)");
    // A further pass is a no-op: the guard has disconnected the observer.
  const before = text.nodeValue;
  for (let i = 0; i < 10; i++) await flushWin(win);
  assert.strictEqual(text.nodeValue, before, "stable after the guard; no live loop");
});

test("the MutationObserver reacts to a later DOM insertion", async () => {
  const { win, store } = loadContent();
  store.contentCensorData = [{ id: "a", find: "go", replace: "STOP", matchType: "text", caseSensitive: false, enabled: true }];
  store.enabled = true;
  await flushWin(win);
  win.__ccContent.applyData({ contentCensorData: store.contentCensorData, enabled: true });
  const t = win.document.createTextNode("go later");
  win.document.body.appendChild(t);
  await flushWin(win);
  assert.strictEqual(t.nodeValue, "STOP later", "observer caught the new node");
});
