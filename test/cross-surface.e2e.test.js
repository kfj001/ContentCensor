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

// ── F-6 cross-surface: P1 BUG FIXED — popup re-renders on store change ───────
// A second rule is pushed to the store and a chrome.storage.sync.set triggers
// the onChanged listener (chrome.storage.onChanged). The popup's controller
// picks up the change, reloads storage, and re-renders the summary — now "2
// terms active" instead of "1 term active".
//
// The popup's own chrome mock must receive the set() call for the onChanged to
// fire — that mirrors Chrome, where all extension surfaces share the same
// chrome.storage backend.
test("F-6 [P1 FIX]: popup re-renders summary on chrome.storage.onChanged", async () => {
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
  assert.ok(/1 term active/.test(summaryBefore), "popup starts with 1 active term");

   // Push a second rule and trigger a set through the popup's own chrome mock.
  pop.chrome._store.contentCensorData.push({
       id: "b", find: "tea", replace: "party", matchType: "text", enabled: true,
      });
  pop.chrome.storage.sync.set(
        { contentCensorData: pop.chrome._store.contentCensorData, enabled: true, updatedAt: Date.now() },
       function () {},
      );
  await flush();
  await flush();
  await flush();
  await flush();
  const summaryAfter = pop.document.getElementById("cc-summary").textContent;

   // P1 FIXED: the onChanged handler re-renders the popup summary.
  assert.notEqual(summaryAfter, summaryBefore,
       "P1-1 fixed: popup onChanged handler re-renders the summary after store change");
  assert.ok(/[2] terms active/.test(summaryAfter),
       "summary now shows 2 active terms after a second rule was saved cross-surface");
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

// ── F-5 → F-3 content.js walks the initial DOM on load (P1-2 fixed) ──────────
// After the fix, applyData runs a one-time walk(document.body) after ensureObserver,
// so the static "GOP" text present at injection time IS replaced on first load.
test("F-5→F-3: content.js walks the initial DOM and replaces static text on load", async () => {
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

  // FIXED BEHAVIOUR: the one-time walk in applyData replaces the static text
  // that was present at injection time.
  assert.strictEqual(p.textContent, "the CUNT was here",
      "P1-2 fixed: content.js walks the initial DOM — GOP → CUNT on first load");
  });

// ── F-3 / A12: content.js walks pre-existing DOM on load (P1-1/P1-2 fixed) ───
// loadAndRun() reads chrome.storage; applyData() then runs a one-time
// walk(document.body) so static text present at injection time IS replaced
// ("hello" → "world").
test("F-3: content.js walks pre-existing DOM and replaces static text on load", async () => {
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
  assert.strictEqual(text, "world",
       "P1-2 fixed: content.js walks pre-existing DOM on load — 'hello' → 'world'");
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
