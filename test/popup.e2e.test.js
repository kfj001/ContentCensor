/*
 * test/popup.e2e.test.js — F-1 status popup (lightweight control surface, Q1/Q2).
 * Driven through the wired popup controller (harness loadPopupPage).
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPopupPage, fireWin, settle } = require("./harness");

// F-1: on-open status reflects the ruleset (active vs. defined).
test("F-1 popup renders the active/defined status block", async () => {
  const r = await loadPopupPage({
     initial: {
       contentCensorData: [
              { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
              { id: "b", find: "tea", replace: "party", matchType: "text", enabled: true },
              { id: "c", find: "GOP", replace: "x", matchType: "text", enabled: true }],
       enabled: true }
          });
  const summary = r.document.getElementById("cc-summary");
  const terms = r.document.getElementById("cc-terms");
  assert.match(summary.textContent, /3 terms active/, "summary counts 3 active terms");
  assert.strictEqual(terms.querySelectorAll(".cc-terms-line").length, 2,
         "the status block shows two lines (active / defined)");
  assert.match(terms.querySelector(".cc-terms-active .cc-terms-count").textContent,
          /^3$/, "active line counts 3 active terms");
  assert.match(terms.querySelector(".cc-terms-defined .cc-terms-count").textContent,
           /^3$/, "defined line counts 3 defined terms");
});

// A disabled rule counts as DEFINED but NOT active — the gap is the whole point.
test("F-1 disabled rule shows as defined, not active", async () => {
  const r = await loadPopupPage({
     initial: {
       contentCensorData: [
               { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
               { id: "b", find: "tea", replace: "party", matchType: "text", enabled: true },
               { id: "c", find: "GOP", replace: "x", matchType: "text", enabled: false }],
       enabled: true }
            });
  const terms = r.document.getElementById("cc-terms");
  assert.strictEqual(terms.querySelector(".cc-terms-active .cc-terms-count").textContent,
          "2", "only the two enabled rules count as active");
  assert.strictEqual(terms.querySelector(".cc-terms-defined .cc-terms-count").textContent,
          "3", "all three non-blank rules count as defined, disabled included");
  const activeLine = terms.querySelector(".cc-terms-active");
  assert.match(activeLine.getAttribute("title") || "", /saved but switched off/,
          "a gap between active and defined surfaces a 'saved but switched off' hint");
});

// The per-site reload button routes a "cc-reload" message to the background,
// which reloads the active tab so a just-disabled site shows clean content.
test("F-1 per-site reload button is present and wired", async () => {
  const r = await loadPopupPage({
     initial: {
       contentCensorData: [
              { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }] }
           });
  const btn = r.document.getElementById("cc-reload");
  assert.ok(btn, "a reload button is present in the popup");
  assert.strictEqual(btn.getAttribute("type"), "button", "the reload control is a button");
  assert.strictEqual(typeof r.api.reloadSite, "function", "popup exposes reloadSite");
});

// A7: Escape closes the popup when there are no unsaved edits.
test("F-1/A7 Escape closes the popup (no unsaved edits)", async () => {
  const r = await loadPopupPage({
     initial: { contentCensorData: [
            { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
       enabled: true }
         });
  let closed = 0;
  try {
    Object.defineProperty(r.win, "close", {
       value: function () { closed++; },
       configurable: true, writable: true
         });
  } catch (_e) {
    r.win.close = function () { closed++; };
      }
   // The Escape handler is attached to document (popup.js line 127).
  r.document.dispatchEvent(new r.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle(r.win);
  assert.ok(closed > 0, "Escape closes the popup (window.close)");
});

// A3: the "Open settings" affordance routes to openOptionsPage.
test("F-6/A3 'Open settings' routes to chrome.runtime.openOptionsPage()", async () => {
  const r = await loadPopupPage({ initial: { enabled: true } });
  let opened = false;
  r.chrome.runtime.openOptionsPage = () => { opened = true; };
  fireWin(r.win, r.document.getElementById("cc-open-settings"), "click");
  await settle(r.win);
  assert.strictEqual(opened, true, "Open settings invokes openOptionsPage (Q1 split popup/options)");
});

// F-3/A11: in-page toast is OFF by default (opt-in) until enabled via profile.
test("F-3/A11 in-page toast is opt-in (off by default)", async () => {
  const loadContentPage = require("./harness").loadContentPage;
      // No contentCensorProfile.toast => toastEnabled stays false.
  const c = loadContentPage(
       "<!DOCTYPE html><html><body><p>replace this</p></body></html>",
       { contentCensorData: [
            { id: "a", find: "replace", replace: "X", matchType: "text", enabled: true }],
          enabled: true });
  await new Promise((res) => setTimeout(res, 10));
  assert.ok(!c.document.getElementById("cc-toast"),
     "no role=status toast rendered when the user has not opted in (F-3 default off)");
});
