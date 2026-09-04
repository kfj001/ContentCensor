/*
* test/inject.e2e.test.js — per-site opt-in injection end-to-end.
*
* Loads the REAL background.js (with the shared chrome mock) and drives its
* top-level listeners the way Chrome would:
*     - background.js registers onMessage / onUpdated synchronously at module
*      load (MV3 §3.1);
*     - popup -> chrome.runtime.sendMessage({type:"cc-toggle-site",...}) routes to
*      the onMessage handler, which requests the host permission, records
*      contentCensorSites, and executeScript-injects lib/rules.js + content.js;
*     - chrome.tabs.onUpdated(status:complete) re-injects an enabled origin on a
*      navigation;
*     - a denied permission request neither records nor injects the site.
*
* This is the seam the "install on all pages" removal lives on.
*/
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { makeChromeMock, ROOT } = require("./helpers");
const path = require("node:path");

async function flush() { await new Promise((r) => setTimeout(r, 0)); }
// The cc-toggle-site handler nests several async chrome callbacks; flush enough
// times for every nested setTimeout(0) to drain before asserting on side-effects.
async function drain() { for (let i = 0; i < 10; i++) await flush(); }

// Load background.js fresh with a fresh chrome mock; the module's top-level
// code registers onInstalled/onMessage/onUpdated synchronously. Keep
// global.chrome pointed at the mock so async handlers (onMessage/onUpdated)
// resolve while `global.chrome` is still live.
function loadBg(initial) {
  const chrome = makeChromeMock(initial || {});
  delete require.cache[require.resolve(path.join(ROOT, "background.js"))];
  global.chrome = chrome;
  require(path.join(ROOT, "background.js"));
  return chrome;
}

// Drive the toggle the way the popup does: sendMessage. The mock dispatches to
// the registered handler; the handler replies via sendResponse, which the mock
// captures on chrome.runtime._lastResponse. We assert on the settled _lastResponse
// + side-effects (store, perms, injections) rather than the resolve timing.
async function toggle(chrome, msg) {
  global.chrome = chrome;                          // ensure async handlers see chrome
  const cb = chrome.runtime.onMessage._cbs[0];
  assert.ok(cb, "cc-toggle-site onMessage listener registered");
  await chrome.runtime.sendMessage(Object.assign({ type: "cc-toggle-site" }, msg));
  await drain();
}

// Invoke the registered tab-update handler directly.
async function fireUpdate(chrome, tabId, changeInfo, tab) {
  global.chrome = chrome;
  const cb = chrome.tabs.onUpdated._cbs[0];
  assert.ok(cb, "tabs.onUpdated listener registered");
  cb(tabId, changeInfo, tab);
  await drain();
}

test("enable + granted => origin recorded, permission granted, injected once", async () => {
  const chrome = loadBg({
    contentCensorData: [{ find: "go", replace: "stop", matchType: "text", enabled: true }],
    contentCensorSites: []
    });

  await toggle(chrome, { enable: true, origin: "https://example.com/*", tabId: 7 });

  assert.ok(chrome.permissions._perms.requested.includes("https://example.com/*"),
      "enable requested the host permission for the specific origin");
  assert.deepStrictEqual(chrome._store.contentCensorSites, ["https://example.com/*"],
      "origin persisted to contentCensorSites");
  const calls = chrome.scripting._calls;
  assert.strictEqual(calls.length, 1, "enable injected the content script once");
  assert.deepStrictEqual(calls[0].files, ["lib/rules.js", "content.js"],
      "injection loads lib/rules.js then content.js (the content-script order)");
  assert.strictEqual(calls[0].target.tabId, 7, "injected into the active tab");
  assert.strictEqual(chrome.runtime._lastResponse.enabled, true, "reply reports enabled");
  assert.strictEqual(chrome.runtime._lastResponse.granted, true,
      "reply reports the permission granted");
 });

test("enable is idempotent — toggling a site on twice injects once, records once", async () => {
  const chrome = loadBg({ contentCensorSites: [] });
  await toggle(chrome, { enable: true, origin: "https://example.com/*", tabId: 7 });
  await toggle(chrome, { enable: true, origin: "https://example.com/*", tabId: 7 });
  assert.deepStrictEqual(chrome._store.contentCensorSites, ["https://example.com/*"],
      "the origin is recorded exactly once");
  assert.strictEqual(chrome.permissions._perms.requested.length, 1,
      "the host permission is requested once per origin");
 });

test("disable => origin removed, permission revoked, nothing injected", async () => {
  const chrome = loadBg({
    contentCensorData: [],
    contentCensorSites: ["https://example.com/*", "https://other.com/*"]
    });

  await toggle(chrome, { enable: false, origin: "https://example.com/*", tabId: 3 });

  assert.deepStrictEqual(chrome._store.contentCensorSites, ["https://other.com/*"],
      "disable removed only the toggled origin");
  assert.ok(!chrome.permissions._perms.requested.includes("https://example.com/*"),
      "disable revoked the host permission for the origin");
  assert.strictEqual(chrome.scripting._calls.length, 0,
      "disabling performs no injection (the live tab self-gates off via onChanged)");
  assert.strictEqual(chrome.runtime._lastResponse.enabled, false,
      "reply reports the site disabled");
 });

test("permission DENIED => origin NOT recorded and NOT injected", async () => {
  const chrome = loadBg({ contentCensorSites: [] });
  chrome.permissions._deny = true;             // user dismisses the host-permission prompt

  await toggle(chrome, { enable: true, origin: "https://example.com/*", tabId: 1 });

   assert.ok(!chrome._store.contentCensorSites || chrome._store.contentCensorSites.length === 0,
    "a denied request did not persist the origin");
  assert.strictEqual(chrome.scripting._calls.length, 0,
      "a denied request injected nothing");
  assert.strictEqual(chrome.runtime._lastResponse.enabled, false,
      "reply reports the site was not enabled");
  assert.strictEqual(chrome.runtime._lastResponse.granted, false,
      "reply reports the permission was denied");
 });

test("onUpdated(complete) re-injects an enabled origin on navigation", async () => {
  const chrome = loadBg({
    contentCensorSites: ["https://news.example.com/*"]
    });

  await fireUpdate(chrome, 42, { status: "complete" },
      { id: 42, url: "https://news.example.com/article" });

  const calls = chrome.scripting._calls;
  assert.strictEqual(calls.length, 1, "onUpdated re-injected the enabled origin");
  assert.strictEqual(calls[0].target.tabId, 42, "re-injected into the navigating tab");
  assert.deepStrictEqual(calls[0].files, ["lib/rules.js", "content.js"],
      "re-injection loads the same lib/rules.js + content.js pair");
 });

test("onUpdated(complete) does NOT inject a non-enabled origin", async () => {
  const chrome = loadBg({
    contentCensorSites: ["https://news.example.com/*"]
    });

  await fireUpdate(chrome, 5, { status: "complete" },
      { id: 5, url: "https://unrelated.example.org/x" });

  assert.strictEqual(chrome.scripting._calls.length, 0,
      "a non-enabled origin is not injected on navigation");
 });

test("onUpdated ignores a non-complete status (must wait for 'complete')", async () => {
  const chrome = loadBg({ contentCensorSites: ["https://news.example.com/*"] });
  await fireUpdate(chrome, 9, { status: "loading" },
      { id: 9, url: "https://news.example.com/" });
  assert.strictEqual(chrome.scripting._calls.length, 0,
      "a 'loading' status does not inject");
 });

test("siteFor maps http/https to an exact-host match, ignores non-web origins", () => {
  loadBg({});                                    // registers listeners; gives us the exported fns
  const bg = require(path.join(ROOT, "background.js"));
  assert.strictEqual(bg.siteFor("about:blank"), null, "about: is not injectable");
  assert.strictEqual(bg.siteFor("chrome://extensions"), null, "chrome: is not injectable");
  assert.strictEqual(bg.siteFor("file:///x/y.html"), null, "file: is not injectable");
  assert.strictEqual(bg.siteFor("https://example.com/path"), "https://example.com/*",
        "https maps to an exact-host match");
  assert.strictEqual(bg.siteFor("http://a.b.co:8080/"), "http://a.b.co:8080/*",
        "non-standard ports are preserved in the match");
 });

test("cc-reload message reloads the active tab", async () => {
  const chrome = loadBg({ contentCensorSites: [] });
  global.chrome = chrome;
  const cb = chrome.runtime.onMessage._cbs[0];
  assert.ok(cb, "cc-reload onMessage listener registered");
  cb({ type: "cc-reload", tabId: 42 }, { tab: { id: 42 } }, () => {});
  await drain();
  assert.deepStrictEqual(chrome.tabs._reloads, [42],
        "a cc-reload message reloads the target tab");
});
