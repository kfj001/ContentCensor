/*
 * test/helpers.js — shared jsdom + chrome-mock harness for the extension units.
 *
 * Two load modes:
 *   (1) DOM units: a project .js is eval'd inside a jsdom window. Under jsdom
 *       `module` is undefined, so each classic-script IIFE publishes its window.*
 *       global (window.CCStorage, window.CcRuleRow, ...). Load in dependency
 *       order: lib/rules.js first (sets window.CCRules), then the consumers.
 *   (2) node units: a module is `require`d with a mocked `chrome` injected as
 *       global.chrome, for the SW (background.js) and content-script (content.js).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");

/**
 * Eval a project .js file inside a jsdom window. Any `require` fallback path is
 * never taken because we pre-load the dependency (rules.js) onto the window, so
 * the window-global branch of each module is the one that runs.
 * @param {DOMWindow} win  jsdom window
 * @param {string}   file  project-relative path ("storage.js", ...)
 */
function loadInto(win, file) {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  win.eval(code);
  return win;
}

/**
 * Build a jsdom window, optionally install a chrome mock on it, run a setup that
 * loads files in order, and return the dom pieces.
 */
function makeDom(html, { chrome, setup } = {}) {
  const dom = new JSDOM(html || "<!DOCTYPE html><html><body></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const win = dom.window;
   // jsdom ships CustomEvent, but guard anyway.
  win.CustomEvent = win.CustomEvent || class CustomEvent extends Event {
      constructor(t, o) { super(t, o); if (o) this.detail = o.detail; }
    };
  if (chrome) win.chrome = chrome;
  if (setup) setup(win);
  return { dom: dom, win: win, document: win.document };
}

/**
 * Minimal chrome.storage.sync + chrome.runtime mock. Backing store is a plain
 * object so a test can inspect what was persisted. Callbacks run on the next
 * microtask/timeout like the real async API; run `await drain()` to flush.
 */
 function makeChromeMock(initial) {
   const store = Object.assign({}, initial || {});
   const listeners = { onChanged: [], onMessage: [], onUpdated: [] };
   const addChanged = function (cb) { listeners.onChanged.push(cb); };
   const perms = { requested: [], _granted: [] };
   const chrome = {
      runtime: {
        lastError: null,
        onInstalled: { addListener: function (cb) { this._cb = cb; }, _cb: null },
        onStartup: { addListener: function (cb) { this._cb = cb; }, _cb: null },
        onMessage: { addListener: function (cb) { listeners.onMessage.push(cb); },
                    _cbs: listeners.onMessage },
         openOptionsPage: function () { chrome.runtime._opened = true; },
         // sendMessage: dispatch to every registered onMessage listener with a
         // fresh sendResponse; resolves when a listener calls sendResponse (the
         // async path, as in the real API) or immediately with undefined.
          sendMessage: function (msg) {
           const s = chrome.runtime._sender || { tab: { id: 1, url: "https://example.com/" } };
           const cbs = listeners.onMessage;
           // A single sendResponse, shared with every listener; captures the
           // reply into _lastResponse so callers can assert on it (the real
           // sendResponse keeps the channel open until called).
           const sendResponse = function (res) {
             chrome.runtime._lastResponse = res;
              };
           return new Promise(function (resolve) {
             setTimeout(function () {
               let asyncReply = false;
               cbs.forEach(function (cb) {
                 try {
                   const r = cb(msg, s, sendResponse);
                 if (r === true) asyncReply = true;
                 } catch (_e) { /* a sync listener that returns nothing */ }
                  });
               resolve(asyncReply ? chrome.runtime._lastResponse : undefined);
                  }, 0);
                });
                },
         _sender: { tab: { id: 1, url: "https://example.com/" } },
          _lastResponse: undefined,
          },
      storage: {
        sync: {
         get: function (keys, cb) {
           chrome.runtime.lastError = null;
           const out = {};
           const arr = Array.isArray(keys) ? keys : [keys];
           for (let i = 0; i < arr.length; i++)
             if (store[arr[i]] !== undefined) out[arr[i]] = store[arr[i]];
           setTimeout(function () { cb(out); }, 0);
               },
         set: function (obj, cb) {
           chrome.runtime.lastError = null;
           for (const k in obj) store[k] = obj[k];
           setTimeout(function () {
             for (const l of listeners.onChanged) l(obj, "sync");
             if (cb) cb();
                 }, 0);
               },
         clear: function (cb) {
           chrome.runtime.lastError = null;
           for (const k in store) delete store[k];
           setTimeout(function () { if (cb) cb(); }, 0);
               }
         },
        // Chrome MV3 fires chrome.storage.onChanged — real API shape.
        onChanged: { addListener: addChanged }
           },
       tabs: {
            _id: 1,
           _reloads: [],
           _changed: [],
          onUpdated: {
            addListener: function (cb) { listeners.onUpdated.push(cb); },
              _cbs: listeners.onUpdated
              },
          reload: function (tabId) {
            chrome.tabs._reloads.push(tabId);
             },
          query: function (info, cb) {
          // Return the active tab a test can override via chrome.tabs._active.
          setTimeout(function () {
            cb([chrome.tabs._active || {
               id: 1, url: "https://example.com/", active: true }]);
            }, 0);
           }
       },
      scripting: {
        _calls: [],
        executeScript: function (details) {
          const rec = { target: details.target, files: details.files,
             results: [] };
          chrome.scripting._calls.push(rec);
          return Promise.resolve([{ result: true, target: rec.target }]);
           }
       },
      permissions: {
        request: function (desc, cb) {
          // Default: grant. Tests may set chrome.permissions._deny = true to
          // simulate a user rejecting the host-permission prompt.
          var granted = chrome.permissions._deny !== true;
          if (granted) {
            (desc.origins || []).forEach(function (o) {
              if (perms.requested.indexOf(o) === -1) perms.requested.push(o);
               });
             }
          setTimeout(function () {
            if (cb) cb(granted);
            }, 0);
           },
        remove: function (desc, cb) {
          (desc.origins || []).forEach(function (o) {
            const i = perms.requested.indexOf(o);
            if (i !== -1) perms.requested.splice(i, 1);
             });
          setTimeout(function () { if (cb) cb(true); }, 0);
           },
        _perms: perms
        },
      _listeners: listeners
       };
   chrome._store = store;
  chrome._listeners = listeners;

     // Wrap set() so a test can force a lastError on the NEXT save only.
  const realSet = chrome.storage.sync.set;
  chrome.storage.sync.set = function (obj, cb) {
    if (chrome._failSave) {
      chrome._failSave = false;
      chrome.runtime.lastError = { message: "QUOTA_BYTES" };
      setTimeout(function () { if (cb) cb(); }, 0);
       return;
       }
    realSet(obj, cb);
    };
    return chrome;
}

/** Run a callback after all queued timeouts fire (flushes async chrome callbacks). */
function drain(cb) {
  setTimeout(function () {
    if (cb) cb();
     }, 0);
}

module.exports = {
  ROOT: ROOT,
  loadInto: loadInto,
  makeDom: makeDom,
  makeChromeMock: makeChromeMock,
  drain: drain
};
