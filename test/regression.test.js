/*
 * test/regression.test.js — unit tests that guard existing behaviour.
 * These are the legacy-behaviour anchors: matching, migration,
 * disabled-rule/empty-ruleset inert, and seed-rule integrity.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { ROOT } = require("./helpers");
const CCRules = require(path.join(ROOT, "lib/rules.js"));
const { loadPopupPage } = require("./harness");

// ── Legacy migration (UI §4.1) ───────────────────────────────────────────────
test("REG-MIG-1: legacy {find,replace,isRegex} rows migrate to v3 shape", () => {
  const migrated = CCRules.migrateRules([
        { find: "a", replace: "b", isRegex: false },
        { find: "c", replace: "d", isRegex: true },
        { find: "e", replace: "f", matchType: "text" },
      ]);
  assert.strictEqual(migrated[0].matchType, "text", "non-regex legacy migrates to matchType=text");
  assert.strictEqual(migrated[1].matchType, "regex", "isRegex=true migrates to matchType=regex");
  assert.strictEqual(migrated[2].matchType, "text", "already-v3 passed through");
});

// ── Matching: text mode with case-insensitive ───────────────────────────────
test("REG-MATCH-1: toPatterns applies global substring replacement", () => {
  const patterns = CCRules.toPatterns([
        { find: "hello", replace: "world", matchType: "text", caseSensitive: false, enabled: true },
      ]);
  const text = "Hello HELLO hello";
  const result = text.replace(patterns[0].re, patterns[0].replacement);
  assert.strictEqual(result, "world world world",
      "case-insensitive global substring replacement replaces all occurrences");
});

// ── Disabled rule skipped ────────────────────────────────────────────────────
test("REG-DISABLED-1: disabled rule is never matched", () => {
  const patterns = CCRules.toPatterns([
        { find: "a", replace: "x", matchType: "text", enabled: false },
        { find: "b", replace: "y", matchType: "text", enabled: true },
      ]);
  assert.strictEqual(patterns.length, 1, "disabled rules are excluded from patterns");
  assert.strictEqual(patterns[0].re.test("b"), true, "enabled rule b still matches");
  assert.strictEqual(patterns[0].re.test("a"), false, "disabled rule a does not match");
});

// ── Empty ruleset inert: an un-opted-in site sees zero patterns ───────────────
test("REG-EMPTY-1: an empty ruleset (a non-opted-in site) yields zero patterns", () => {
    // content.js's applyData() passes CCRules.toPatterns(data); when the site is
    // not in contentCensorSites the gated branch yields [] and the walk is a no-op.
  const patterns = CCRules.toPatterns([]);
  assert.strictEqual(patterns.length, 0, "empty ruleset is inert (no patterns)");
});

// ── Seed rules integrity ─────────────────────────────────────────────────────
test("REG-SEED-1: defaultRules returns 6 seed rules with expected finds", () => {
  const rules = CCRules.defaultRules();
  assert.strictEqual(rules.length, 6, "six seed rules");
  const finds = rules.map((r) => r.find);
  assert.ok(finds.includes("republican"), "includes 'republican' seed");
  assert.ok(finds.includes("GOP"), "includes 'GOP' seed");
});

// ── Save filter: blank-find rows dropped; disabled kept as "defined" ───────────
test("REG-SAVE-1: serializeSync drops blank-find rows, keeps disabled ones", () => {
  const state = {
    enabled: true,
    rows: [
            { id: "r1", find: "hello", replace: "world", matchType: "text", enabled: true },
            { id: "r2", find: "", replace: "", matchType: "text", enabled: true },
            { id: "r3", find: "test", replace: "ok", matchType: "text", enabled: false },
          ],
         };
  const serialized = CCRules.serializeSync(state);
  assert.strictEqual(serialized.contentCensorData.length, 2,
        "the blank-find row is dropped; the active and disabled rows both persist");
  assert.strictEqual(serialized.contentCensorData[0].find, "hello",
       "the active rule with find='hello' is preserved");
  const disabled = serialized.contentCensorData.find((r) => r.find === "test");
  assert.ok(disabled, "the disabled rule still persists (so 'defined' > 'active' survives a save)");
  assert.strictEqual(disabled.enabled, false, "its disabled flag is kept");
});

// ── Popup summary counts active terms correctly ────────────────────────────────
test("REG-POPUP-1: popup summary renders active terms when enabled", async () => {
  const r = await loadPopupPage({
       initial: {
          contentCensorData: [
             { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
             { id: "b", find: "tea", replace: "party", matchType: "text", enabled: true },
        ],
          enabled: true,
          updatedAt: Date.now() - 5000,
        },
     });
  await new Promise((res) => setTimeout(res, 20));
  const summary = r.document.getElementById("cc-summary").textContent;
  assert.match(summary, /2 terms active/, "2 terms active when two enabled rules");
});

// ── Popup summary counts active terms in row data ─────────────────────────────
// popup.js displays the count of enabled+nonempty rules in state.rows. There is
// no global on/off flag — the count reflects the row data directly.
test("REG-POPUP-2: popup summary shows enabled rules count from row data", async () => {
  const r = await loadPopupPage({
        initial: {
           contentCensorData: [
                { id: "a", find: "go", replace: "stop", matchType: "text", enabled: true },
           ],
           updatedAt: Date.now(),
          },
       });
  await new Promise((res) => setTimeout(res, 20));
  const summary = r.document.getElementById("cc-summary").textContent;
    // The popup shows 1 term active straight from the row data.
  assert.match(summary, /1 term active/, "popup shows the active-term count from row data");
});
