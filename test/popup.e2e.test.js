/*
 * test/popup.e2e.test.js — F-1 status popup (lightweight control surface, Q1/Q2).
 * Driven through the wired popup controller (harness loadPopupPage).
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPopupPage, fireWin, settle } = require("./harness");

// F-1: on-open status reflects the ruleset.
test("F-1 popup renders the active count + first-3 preview", async () => {
  const r = await loadPopupPage({
     initial: {
       contentCensorData: [
             { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
             { id: "b", find: "tea", replace: "party", matchType: "text", enabled: true },
             { id: "c", find: "GOP", replace: "x", matchType: "text", enabled: true }],
       enabled: true }
        });
  const summary = r.document.getElementById("cc-summary");
  const preview = r.document.getElementById("cc-preview");
  assert.match(summary.textContent, /3 terms active/, "summary counts 3 active terms");
  assert.strictEqual(preview.querySelectorAll("li").length, 3, "preview caps at the first 3 rules");
});

// Q2 / A3: master switch toggles the profile enabled flag and saves it.
test("F-1/Q2 master switch toggles enabled + persists (role=switch, aria-checked)", async () => {
  const r = await loadPopupPage({
     initial: {
       contentCensorData: [
             { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }],
       enabled: true }
        });
  const sw = r.document.getElementById("cc-master");
  assert.strictEqual(sw.getAttribute("role"), "switch", "master is a role=switch (A3)");
  assert.strictEqual(sw.getAttribute("aria-checked"), "true");

    // Flip it off.
  sw.checked = false;
  fireWin(r.win, sw, "change");
  await settle(r.win, 8);
  assert.strictEqual(r.win.CCStorage.state.enabled, false, "toggling updates the flag");
  assert.strictEqual(r.chrome._store.enabled, false, "enabled flag persisted (not wiped rules)");
    // Rules are PRESERVED, not wiped (Q2).
  assert.strictEqual(r.chrome._store.contentCensorData.length, 1, "rules preserved when disabled (Q2)");
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
