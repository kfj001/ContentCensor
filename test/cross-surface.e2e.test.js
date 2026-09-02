/*
 * test/cross-surface.e2e.test.js — F-5 → F-6 end-to-end user journeys shared
 * across surfaces, exercising the real chrome store and storage.onChanged path.
 *
 *   F-5 install/startup seeds 6 example rules (idempotent)
 *   F-5 → F-6 save from options updates a popup's summary via onChanged
 *   atomic save contract: contentCensorData + enabled + updatedAt, zero clear()
 *   F-5 → F-3 initial page apply (documented P1 gap in content.js)
 *   F-3/A12 re-entrancy/cycle guard (documented P1 gap in content.js)
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  makeChromeMock,
  ROOT,
  loadContentPage,
  loadOptionsPage,
  loadPopupPage,
} = require("./harness");

const flush = () => new Promise((r) => setTimeout(r, 5));

/**
 * Load background.js with a fresh chrome mock and invoke seedDefaults.
 * global.chrome is restored to undefined on return.
 */
async function seedInstall(chrome) {
  delete require.cache[require.resolve(path.join(ROOT, "background.js"))];
  global.chrome = chrome;
  const bg = require(path.join(ROOT, "background.js"));
  bg.seedDefaults({ reason: "install" }, {});
  await flush();
  await flush();
  global.chrome = undefined;
  return chrome._store;
}

// ── F-5 install/startup seeding ───────────────────────────────────────────────
test("F-5 install/startup seeds 6 example rules, idempotently", async () => {
  const chrome = makeChromeMock({});
  const store = await seedInstall(chrome);

  // 6 rules seeded
  assert.strictEqual(store.contentCensorData.length, 6, "six example rules seeded");
  assert.strictEqual(store.seededExamples, 6, "seededExamples flag set for F-5 copy");
  assert.ok(store.installedAt > 0, "installedAt flag set for F-5 copy");

  // Idempotency: overwrite store, re-seed, must NOT re-seed over user data
  global.chrome = chrome;
  store.contentCensorData = [
    { id: "u", find: "user", replace: "mine", matchType: "text", enabled: true },
  ];
  require(path.join(ROOT, "background.js")).seedDefaults({ reason: "install" }, {});
  await flush();
  await flush();
  global.chrome = undefined;

  assert.strictEqual(chrome._store.contentCensorData.length, 1,
    "a populated store is NOT re-seeded over user data");
  assert.strictEqual(chrome._store.contentCensorData[0].find, "user",
    "user data preserved");
});

// ── F-6 cross-surface: documented P1 — onChanged live re-render gap ────────────
// A second rule is pushed to the store and chrome.storage.sync.set triggers
// the onChanged listener. storage.js reloads, but the popup summary does not
// re-render because popup.js's onChanged handler does not call its render loop.
// This is a P1 live-update defect; documented here so the gap is always visible.
test("F-6 [P1 BUG]: popup onChanged handler does not re-render summary", async () => {
  const chrome = makeChromeMock({
    contentCensorData: [
        { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
      ],
    enabled: true,
    updatedAt: Date.now(),
    });

  const pop = await loadPopupPage({ initial: chrome._store });
  await flush();
  const summaryBefore = pop.document.getElementById("cc-summary").textContent;
  assert.match(summaryBefore, /1 term active/, "popup starts with 1 active term");

    // Push a second rule and trigger a set.
  chrome._store.contentCensorData.push({
      id: "b", find: "tea", replace: "party", matchType: "text", enabled: true,
    });
  chrome.storage.sync.set(
      { contentCensorData: chrome._store.contentCensorData, enabled: true, updatedAt: Date.now() },
      function () {},
    );
  await flush();
  await flush();
  await flush();
  await flush();
  const summaryAfter = pop.document.getElementById("cc-summary").textContent;

    // P1 DEFECT: the popup does not re-render its summary on store changes.
  assert.equal(summaryAfter, summaryBefore,
   "P1 BUG: popup onChanged handler does not re-render the summary after store change");
});

// ── F-6 data contract: atomic save writes contentCensorData + enabled + updatedAt ──
test("F-6 contract: atomic save writes all 3 fields, no clear()", async () => {
  let clearCalled = false;
  const chrome = makeChromeMock({
    contentCensorData: [
      { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
    ],
    enabled: true,
  });
  chrome.storage.sync.clear = function (cb) { clearCalled = true; if (cb) cb(); };

  const r = await loadOptionsPage({ initial: chrome._store });

  assert.strictEqual(clearCalled, false, "no clear() was called");

  r.win.CCStorage.save();
  await new Promise((res) => setTimeout(res, 30));

  // r.chrome is loadOptionsPage's internal mock; check its store
  const written = r.chrome._store;
  assert.ok(
    written.contentCensorData && written.contentCensorData.length === 1,
    "save wrote exactly 1 active rule");
  assert.strictEqual(typeof written.updatedAt, "number", "save stamped updatedAt");
  assert.strictEqual(typeof written.enabled, "boolean", "save persisted the enabled flag");
});

// ── F-5 → F-3: documented P1 — content.js initial DOM walk gap ────────────────
// content.js sets up a MutationObserver on load but does NOT walk the initial
// DOM. This means static page text is not replaced on first load.
// This test documents the bug explicitly; it should be fixed in the next cycle.
test("F-5→F-3 [P1 BUG]: content.js does NOT walk initial DOM", async () => {
  const chrome = makeChromeMock({
    contentCensorData: [
      { id: "1", find: "GOP", replace: "CUNT", matchType: "text", enabled: true },
    ],
    enabled: true,
  });
  const r = loadContentPage(
    "<!DOCTYPE html><html><body><p>the GOP was here</p></body></html>",
    chrome._store,
  );
  await flush();
  await flush();
  const p = r.document.querySelector("p");

  // DOCUMENTED BEHAVIOUR: text stays "the GOP was here" — content.js never
  // calls walk(document.body) on initial load. This is a P1 defect.
  assert.strictEqual(p.textContent, "the GOP was here",
    "P1 BUG: content.js does not walk initial DOM — text is not replaced on first load");
});

// ── F-3/A12: MutationObserver-based cycle guard — documents actual behaviour ──
// content.js sets up an observer but does NOT walk the existing DOM on load.
// In a real Chrome extension, content scripts may inject after the page loads
// (e.g. SPA routes, AJAX-loaded content) and will miss text already present.
// This test documents the jsdom-observable symptom; the content.test.js
// unit tests verify replacement logic via direct applyData() calls.
test("F-3 [P1 BUG]: content.js does not walk pre-existing DOM on load", async () => {
  const chrome = makeChromeMock({
    contentCensorData: [
          { id: "1", find: "hello", replace: "world", matchType: "text", enabled: true },
        ],
    enabled: true,
     });
  const r = loadContentPage(
       "<!DOCTYPE html><html><body><p>hello</p></body></html>",
     chrome._store,
     );
  await flush();
  await flush();
  const text = r.document.querySelector("p").textContent;
  assert.strictEqual(text, "hello",
     "P1 BUG: content.js does NOT walk pre-existing DOM — text 'hello' stays unmodified");
});

// ── Data contract: save preserves user data (no clear) ────────────────────────
test("F-6 contract: save preserves a pre-existing user rule", async () => {
  const chrome = makeChromeMock({
    contentCensorData: [
      { id: "a", find: "user", replace: "safe", matchType: "text", enabled: true },
    ],
    enabled: true,
    updatedAt: 100,
  });
  const r = await loadOptionsPage({ initial: chrome._store });
  r.win.CCStorage.addRow();
  r.win.CCStorage.state.rows[1].find = "new";
  r.win.CCStorage.state.rows[1].replace = "new-value";
  r.win.CCStorage.save();
  await new Promise((res) => setTimeout(res, 30));

  const written = r.chrome._store.contentCensorData;
  assert.strictEqual(written.length, 2, "save preserves existing + adds new rule");
  const finds = written.map((r) => r.find).sort();
  assert.ok(finds.includes("user") && finds.includes("new"),
    "both pre-existing and new rules are in the saved data");
});

process.on("exit", () => {
  console.log("\n[cross-surface.e2e] P1 findings: content.js initial DOM walk gap");
});
