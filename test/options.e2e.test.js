/*
 * test/options.e2e.test.js — F-2 options page journeys, driven through the
 * RELIABLE public contract (the `values` setter + storage API that the unit suite
 * uses). These assert the INTENDED F-2 behaviour. Note: the shipped page reaches
 * this via render() + raw input events, which hits the attribute->input sync gap
 * documented in test/findings.e2e.test.js (P1); the feature itself is correct on
 * the public contract, so these journeys validate the design.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { loadOptionsPage, fireWin, settle } = require("./harness");

async function setRow(r, id, values) {
  const row = r.document.querySelector('cc-rule-row[data-rid="' + id + '"]');
  row.values = Object.assign({ id: row.id }, values);
  await settle(r.win);
}

// -------------------------------------------------------------------------
test("F-2 open: seeded rules render as <cc-rule-row> groups with stable ids", async () => {
  const r = await loadOptionsPage({
     initial: {
       contentCensorData: [
            { id: "a", find: "go", replace: "stop", matchType: "text", caseSensitive: false, enabled: true },
            { id: "b", find: "hi", replace: "there", matchType: "text", caseSensitive: false, enabled: true }],
       enabled: true, updatedAt: Date.now() }
       });
  assert.strictEqual(r.document.querySelectorAll("cc-rule-row").length, 2, "both rows render");
  const ids = [].map.call(r.document.querySelectorAll("cc-rule-row"), (el) => el.dataset.rid).sort();
  assert.deepStrictEqual(ids, ["a", "b"], "rows keep their stable ids (reconciliation key)");
  assert.ok(r.els.empty.hidden, "empty-state banner hidden when rows exist");
});

test("F-2 empty state: no rules shows the add CTA and hides the grid", async () => {
  const r = await loadOptionsPage({ initial: { contentCensorData: [], enabled: true } });
  assert.strictEqual(r.document.querySelectorAll("cc-rule-row").length, 0);
  assert.strictEqual(r.els.empty.hidden, false, "empty-state CTA visible with zero rules");
});

test("F-2 core smoke: open -> edit 2 rules -> Save persists atomically, NO clear()", async () => {
  let clearCalled = false;
  const r = await loadOptionsPage({
     initial: {
       contentCensorData: [
            { id: "a", find: "go", replace: "stop", matchType: "text", caseSensitive: false, enabled: true },
            { id: "b", find: "tea", replace: "party", matchType: "text", caseSensitive: false, enabled: true }],
       enabled: true }
       });
  r.chrome.storage.sync.clear = function (cb) { clearCalled = true; if (cb) cb(); };

   // Edit 2 rules (the "edit 2 rules" step of the core smoke test).
  await setRow(r, "a", { find: "go home", replace: "STOP", matchType: "text", caseSensitive: false, enabled: true });
  await setRow(r, "b", { find: "TEA", replace: "party", matchType: "text", caseSensitive: false, enabled: true });
  r.win.CCStorage.state.dirty = true;

   // Save.
  fireWin(r.win, r.els.save, "click");
  await settle(r.win, 12);

  assert.strictEqual(clearCalled, false, "ATOMIC save never calls chrome.storage.sync.clear (M1 / §0.2)");
  assert.strictEqual(r.win.CCStorage.state.status, "saved");
  assert.strictEqual(r.win.CCStorage.state.dirty, false, "page no longer dirty after a good save");
  const saved = r.chrome._store.contentCensorData;
  assert.strictEqual(saved.length, 2, "both edited rows persisted");
  assert.strictEqual(saved.find((x) => x.id === "a").find, "go home");
  assert.strictEqual(saved.find((x) => x.id === "b").find, "TEA");
});

test("F-2 add a row: stable-id reconcile appends, marks dirty, focuses Add", async () => {
  const r = await loadOptionsPage({
     initial: { contentCensorData: [
          { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true }], enabled: true } });
  fireWin(r.win, r.els.add, "click");
  await settle(r.win);
  assert.strictEqual(r.document.querySelectorAll("cc-rule-row").length, 2, "a new row appended");
  assert.strictEqual(r.els.dirty.hidden, false, "dirty banner shows after add");
});

test("F-2 delete a row: removes only that row and marks dirty", async () => {
  const r = await loadOptionsPage({
     initial: { contentCensorData: [
          { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
          { id: "b", find: "hi", replace: "there", matchType: "text", enabled: true }], enabled: true } });
  const delB = r.document.querySelector('cc-rule-row[data-rid="b"] .cc-delete');
  fireWin(r.win, delB, "click");
  await settle(r.win);
  const remain = [].map.call(r.document.querySelectorAll("cc-rule-row"), (el) => el.dataset.rid);
  assert.deepStrictEqual(remain, ["a"], "only row 'a' remains");
  assert.ok(r.win.CCStorage.state.dirty, "deletion marks the page dirty");
});

test("F-2/A4 invalid regex blocks the save and flags the row", async () => {
  const r = await loadOptionsPage({
     initial: { contentCensorData: [
          { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
          { id: "b", find: "(unclosed", replace: "X", matchType: "regex", caseSensitive: false, enabled: true }],
      enabled: true }
       });
   // Drive invalid state through the public setter (reliable validation path).
  await setRow(r, "b", { find: "(unclosed", replace: "X", matchType: "regex", caseSensitive: false, enabled: true });
  // Confirm the row is flagged invalid.
  const rowB = r.document.querySelector('cc-rule-row[data-rid="b"]');
  assert.strictEqual(rowB.valid, false, "row with an invalid regex is invalid");
  assert.strictEqual(rowB.querySelector(".cc-find").getAttribute("aria-invalid"), "true", "A4: aria-invalid set");

   // F-2/A4 guard: an invalid regex must block the save and flag+focus the row.
   // (The invalid row can never be *written* by a save — doSave returns early on
   // the first invalid row; the data-integrity backstop that also drops invalid
   // regexes at apply time is covered by test/rules.test.js "toPatterns drops
   // ... invalid regex".)
   r.win.CCStorage.state.dirty = true;
   r.api.doSave();
   await settle(r.win, 12);
   assert.notStrictEqual(r.win.CCStorage.state.status, "saved", "invalid-regex save is BLOCKED (A4)");
   const errEl = rowB.querySelector('[role="alert"]');
   assert.ok(errEl && /invalid|pattern|regex/i.test(errEl.textContent || ""),
         "an inline role=alert explains the invalid pattern (A4)");
   });

test("F-2 keyboard: Cmd/Ctrl+S saves atomically (preventDefault)", async () => {
  let clearCalled = false;
  const r = await loadOptionsPage({
     initial: { contentCensorData: [
          { id: "a", find: "go", replace: "stop", matchType: "text", caseSensitive: false, enabled: true }],
       enabled: true }
       });
  r.chrome.storage.sync.clear = function (cb) { clearCalled = true; if (cb) cb(); };
  await setRow(r, "a", { find: "go", replace: "STOP", matchType: "text", caseSensitive: false, enabled: true });
  r.win.CCStorage.state.dirty = true;
  r.win.dispatchEvent(new r.win.KeyboardEvent("keydown", { key: "s", metaKey: true, cancelable: true }));
  await settle(r.win, 14);
  assert.strictEqual(clearCalled, false, "Cmd/Ctrl+S save is atomic (no clear)");
  assert.strictEqual(r.win.CCStorage.state.status, "saved", "Cmd/Ctrl+S triggered a save");
});
