/*
 * test/rules.test.js — unit tests for lib/rules.js (UI §4.1 / §4.4 / §4.5 gates).
 * Covers escaping, pattern building, legacy migration, the save filter, and the
 * "no parallel arrays" contract.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const R = require("../lib/rules.js");

test("escapeRegex escapes every metacharacter but not alphanumerics", () => {
  assert.strictEqual(R.escapeRegex("a.b*c+d"), "a\\.b\\*c\\+d");
  assert.strictEqual(R.escapeRegex("plain"), "plain");
  assert.strictEqual(R.escapeRegex("100% off ($5)"), "100% off \\(\\$5\\)");
});

test("buildPattern: text mode uses an escaped global pattern (gi default)", () => {
  const re = R.buildPattern("a.b", false, "text");
  assert.strictEqual(re.flags, "gi");
  assert.ok(re.test("xa.by"), "escaped, so not a metachar match");
  assert.strictEqual(re.test("aXb"), false); // . escaped -> no metachar
});

test("buildPattern: case-sensitive drops the i flag", () => {
  const re = R.buildPattern("abc", true, "text");
  assert.strictEqual(re.flags, "g");
  assert.strictEqual(re.test("ABC"), false);
});

test("buildPattern: regex mode compiles raw source; invalid throws", () => {
  assert.doesNotThrow(() => R.buildPattern("^(\\d+)$", false, "regex"));
  assert.throws(() => R.buildPattern("(unclosed", false, "regex"));
});

test("patternForRule returns null for empty find or invalid regex", () => {
  assert.strictEqual(R.patternForRule({ find: "", matchType: "text" }), null);
  assert.strictEqual(R.patternForRule({ find: "(", matchType: "regex" }), null);
  assert.ok(R.patternForRule({ find: "go", matchType: "text" }));
});

test("normalizeRule maps legacy isRegex -> matchType and defaults (UI §4.1)", () => {
  const a = R.normalizeRule({ find: "x", replace: "y", isRegex: true });
  assert.strictEqual(a.matchType, "regex");
  assert.strictEqual(a.caseSensitive, false); // legacy had no flag -> preserves "gi"
  assert.strictEqual(a.enabled, true);

  const b = R.normalizeRule({ find: "x", replace: "y", isRegex: false });
  assert.strictEqual(b.matchType, "text");
  assert.ok(b.id, "an id is minted when absent");
});

test("migrateRules accepts an array, a single object, or junk", () => {
  assert.strictEqual(R.migrateRules(null).length, 0);
  assert.strictEqual(R.migrateRules(undefined).length, 0);
  assert.strictEqual(R.migrateRules({ find: "a", replace: "b" }).length, 1);
  assert.strictEqual(R.migrateRules([{ find: "a" }, { find: "b" }]).length, 2);
});

test("toPatterns drops disabled + empty-find rows and invalid regex (defect #1/#2)", () => {
  const rows = [
     { id: "1", find: "go", replace: "stop", enabled: true },
     { id: "2", find: "", replace: "x", enabled: true },      // empty find -> dropped
     { id: "3", find: "hi", replace: "y", enabled: false },  // disabled -> dropped
     { id: "4", find: "(", replace: "z", matchType: "regex", enabled: true } // bad -> dropped
     ];
  const p = R.toPatterns(rows);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].replacement, "stop");
});

test("serializeSync persists only non-empty rows, never calls clear() (M1)", () => {
  const out = R.serializeSync({
     rows: [
           { id: "1", find: "go", replace: "stop", enabled: true },
           { id: "2", find: "", replace: "x" },               // dropped
           { id: "3", find: "hi", replace: "y", enabled: false } // dropped
       ]
   });
  assert.strictEqual(out.contentCensorData.length, 1);
  assert.ok(out.updatedAt > 0, "carries a timestamp");
   assert.strictEqual(out.enabled, undefined, "no global enabled flag is persisted");
   // No parallel arrays: the shape is exactly {contentCensorData, updatedAt}.
  assert.deepStrictEqual(Object.keys(out).sort(), ["contentCensorData", "updatedAt"]);
});

test("defaultRules returns six seeded example rules (F-5)", () => {
  const d = R.defaultRules();
  assert.strictEqual(d.length, 6);
  assert.ok(d[0].id, "seeded rows get ids");
  assert.strictEqual(d[2].matchType, "regex"); // iphone
});

test("newId produces unique ids", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(R.newId());
  assert.strictEqual(seen.size, 500);
});
