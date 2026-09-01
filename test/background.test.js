/*
 * test/background.test.js — background.js service worker (M2/M4).
 * Verifies: top-level synchronous listener registration (MV3 §3.1), seed-on-install
 * behaviour (UI §3.6 F-5), and idempotency (a populated store is left alone —
 * no re-seed over user data, MV3 §3.2 M2 DoD).
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { makeChromeMock } = require("./helpers");

async function flush() { await new Promise((r) => setTimeout(r, 0)); }

function loadBg(initial) {
  global.chrome = makeChromeMock(initial);
  delete require.cache[require.resolve("../background.js")];
  return require("../background.js");
}

test("onInstalled + onStartup listeners are registered at top level (sync)", () => {
  const bg = loadBg();
   // The mock records the cb on .addListener at module load time.
  assert.strictEqual(typeof global.chrome.runtime.onInstalled._cb, "function",
    "onInstalled listener attached synchronously at module load");
  assert.strictEqual(typeof global.chrome.runtime.onStartup._cb, "function",
    "onStartup listener attached synchronously at module load");
  assert.strictEqual(bg.SEED_RULES.length, 6, "six seeded example rules (F-5)");
});

test("seed on install populates an empty store with 6 rules + flags (F-5)", async () => {
  const bg = loadBg({});
  bg.seedDefaults();
  await flush(); await flush();
  const store = global.chrome._store;
  assert.strictEqual(store.contentCensorData.length, 6);
  assert.strictEqual(store.enabled, true);
  assert.ok(store.installedAt > 0, "installedAt flag set for the F-5 copy");
  assert.strictEqual(store.seededExamples, 6);
});

test("a populated store is NOT re-seeded (idempotent — no data clobber)", async () => {
  const bg = loadBg({
    contentCensorData: [{ find: "user", replace: "rule", matchType: "text", enabled: true }]
   });
  bg.seedDefaults();
  await flush(); await flush();
  const store = global.chrome._store;
  assert.strictEqual(store.contentCensorData.length, 1, "user data untouched");
  assert.strictEqual(store.contentCensorData[0].find, "user");
  assert.strictEqual(store.seededExamples, undefined, "did not re-flag as a seed");
});
