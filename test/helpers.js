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
  const listeners = { onChanged: [] };
  const addChanged = function (cb) { listeners.onChanged.push(cb); };
  const chrome = {
     runtime: {
       lastError: null,
       onInstalled: { addListener: function (cb) { this._cb = cb; }, _cb: null },
       onStartup: { addListener: function (cb) { this._cb = cb; }, _cb: null },
       openOptionsPage: function () { chrome.runtime._opened = true; }
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
         }
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
