/*
 * test/storage.test.js — storage.js controller: atomic save (no clear()), legacy
 * migration on load, per-row enable, dirty/status. UI §4.1 / §4.3 / M1.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { makeChromeMock, drain } = require("./helpers");

/** Run two async ticks so chained setTimeout(…, 0) callbacks settle. */
async function run() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function loadStorage(initial) {
  global.chrome = makeChromeMock(initial);
  delete require.cache[require.resolve("../storage.js")];
  return require("../storage.js");
}

test("load migrates legacy {find,replace,isRegex} into the v3 shape", async () => {
  const S = loadStorage({
    contentCensorData: [
         { find: "go", replace: "stop", isRegex: false },
         { find: "abc", replace: "x", isRegex: true }
         ]
    });
  let captured;
  S.load((state) => { captured = state; });
  await run();
  assert.strictEqual(captured.rows.length, 2);
  assert.strictEqual(captured.rows[0].matchType, "text");
  assert.strictEqual(captured.rows[1].matchType, "regex");
  assert.strictEqual(captured.rows[0].caseSensitive, false);
  assert.ok(captured.rows[0].id, "id minted on migration");
  assert.strictEqual(captured.status, "idle");
  assert.strictEqual(captured.dirty, false);
});

test("save is a single atomic sync.set with NO clear() (M1 / MV3 Phase 0.2)", async () => {
  let clearCalled = false;
  global.chrome = makeChromeMock({ contentCensorData: [{ find: "go", replace: "stop", enabled: true }] });
  global.chrome.storage.sync.clear = function (cb) { clearCalled = true; if (cb) cb(); };
  const S = loadStorage({ contentCensorData: [], enabled: true });

  S.load(() => {});
  await run();
  S.addRow();
  S.state.rows[0].find = "go";
  S.state.rows[0].replace = "stop";
  S.save();
  await run();

  assert.strictEqual(clearCalled, false, "clear() must NOT be called");
  assert.strictEqual(S.state.status, "saved");
  assert.strictEqual(S.state.dirty, false);
  assert.strictEqual(global.chrome._store.contentCensorData[0].find, "go");
});

test("save keeps dirty=true on a forced quota/lastError failure (no data loss)", async () => {
  global.chrome = makeChromeMock({ contentCensorData: [] });
  const S = loadStorage({ contentCensorData: [] });
  S.load(() => {});
  await run();
  S.addRow();
  S.state.rows[0].find = "go";
  S.state.rows[0].replace = "stop";
  global.chrome._failSave = true;
  S.save();
  await run();
  assert.strictEqual(S.state.status, "error");
  assert.strictEqual(S.state.dirty, true, "failure keeps the user able to retry");
});

test("save persists defined (non-empty-find) rows — including disabled ones", async () => {
  global.chrome = makeChromeMock();
  const S = loadStorage();
  S.load(() => {});
  await run();
  S.addRow(); S.state.rows[0].find = "keep"; S.state.rows[0].replace = "K";    // active
  S.addRow(); S.state.rows[1].find = "";                                       // dropped (blank)
  S.addRow(); S.state.rows[2].find = "hi"; S.state.rows[2].enabled = false;     // saved, disabled
  S.save();
  await run();
  const saved = global.chrome._store.contentCensorData;
  assert.strictEqual(saved.length, 2, "non-blank rows persist (active + disabled); only the blank find is dropped");
  assert.strictEqual(saved[0].find, "keep");
  assert.strictEqual(saved[1].find, "hi", "the disabled 'hi' row survives a save");
  assert.strictEqual(saved[1].enabled, false, "its enabled flag is preserved so 'defined' > 'active' survives a reload");
});

test("load migrates rows and exposes no global enabled flag", async () => {
  global.chrome = makeChromeMock({
    contentCensorData: [{ find: "go", replace: "stop", enabled: true }],
    enabled: true
    });
  const S = loadStorage({
    contentCensorData: [{ find: "go", replace: "stop", enabled: true }],
    enabled: true
    });
  let captured;
  S.load((state) => { captured = state; });
  await run();
  assert.strictEqual(captured.rows.length, 1, "the rule migrated");
  assert.strictEqual(captured.rows[0].find, "go");
  assert.strictEqual(captured.enabled, undefined, "no global enabled flag is loaded");
  assert.strictEqual(typeof S.setEnabled, "undefined", "setEnabled is gone (no global flag)");
});
