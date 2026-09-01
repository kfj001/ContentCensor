/*
 * test/dom.test.js — DOM units for <cc-rule-row> (UI §4.2 component contract + A1/A3/A10/A11).
 * Runs against jsdom, which supports full native CustomElements.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { ROOT } = require("./helpers");

// Load cc-rule-row.js (and its dependency, rules.js) into a fresh jsdom window.
function loadRow() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>",
       { runScripts: "outside-only", pretendToBeVisual: true });
   const w = dom.window, d = w.document;
   w.eval(fs.readFileSync(path.join(ROOT, "lib/rules.js"), "utf8"));
   w.eval(fs.readFileSync(path.join(ROOT, "cc-rule-row.js"), "utf8"));
   return { dom, w, d };
}

// Helper: create + attach a <cc-rule-row> with the given attrs, then flush one
// tick so attributeChangedCallback has run.
function makeRow(w, d, attrs) {
  const el = d.createElement("cc-rule-row");
  el.id = attrs.id || "r-1";
  Object.keys(attrs).forEach((k) => el.setAttribute(k, String(attrs[k])));
  d.body.appendChild(el);
  return el;
}

async function flush() { await new Promise((r) => setTimeout(r, 0)); }

// ---------------------------------------------------------------------------

test("cc-rule-row renders all controls with visible labels (A1)", async () => {
  const { w, d } = loadRow();
  const row = makeRow(w, d, { find: "go", replace: "stop", matchtype: "text",
      "case-sensitive": "false", disabled: "false", index: "0", total: "1" });
  await flush();

  const findInput = row.querySelector(".cc-find");
  const findLbl = row.querySelector(".cc-field-lbl");
  assert.ok(findInput, "find text input exists");
  assert.ok(findLbl && (findLbl.textContent || "").match(/find/i),
       "find has a programmatic label element for its input (A1)");

  const repInput = row.querySelector(".cc-replace");
  const repLbl = row.querySelectorAll(".cc-field-lbl");
  assert.ok(repInput, "replace text input exists");
  assert.strictEqual(repLbl.length, 2, "exactly two label elements (A1 — Find + Replace)");
});

test("cc-rule-row exposes a role=radiogroup and a Delete button with text (A10)", async () => {
  const { w, d } = loadRow();
  const row = makeRow(w, d, { find: "go", replace: "stop", matchtype: "text",
      "case-sensitive": "false", disabled: "false" });
  await flush();

  // A3 match-type radiogroup with aria-label.
  const rg = row.querySelector('[role="radiogroup"]');
  assert.ok(rg, "match-type role=radiogroup exists");
  assert.strictEqual(rg.getAttribute("aria-label"), "Match type");
  const radios = rg.querySelectorAll('input[type="radio"]');
  assert.strictEqual(radios.length, 2, "exactly two match-type options");

  // A10 Delete button — real text + aria-label (never a bare icon in AT).
  const del = row.querySelector(".cc-delete");
  assert.ok(del, "Delete button exists");
  assert.strictEqual(del.getAttribute("aria-label"), "Delete this rule");
  assert.match((del.textContent || "").trim(), /^delete$/i,
      "Delete has visible text — not a bare icon (A10)");
});

test("cc-rule-row emits exactly cc-row-change / cc-row-delete (UI §4.2 output contract)", async () => {
  const { w, d } = loadRow();
  const row = makeRow(w, d, { find: "go", replace: "stop", matchtype: "text",
       "case-sensitive": "false", disabled: "false" });
  row.setAttribute("index", "0");
  row.setAttribute("total", "1");
  await flush();

  const fired = [];
  row.addEventListener("cc-row-change", (e) => fired.push(["change", JSON.parse(JSON.stringify(e.detail))]));
  row.addEventListener("cc-row-delete", (e) => fired.push(["delete", JSON.parse(JSON.stringify(e.detail))]));

      // Edit the find value — the event is "input" (not "change") on a text input.
  const findInput = row.querySelector(".cc-find");
  findInput.value = "hello";
  findInput.dispatchEvent(new w.Event("input", { bubbles: true }));
   await flush();

      // Click Delete.
  const del = row.querySelector(".cc-delete");
  del.click();
   await flush();

  assert.ok(fired.some((f) => f[0] === "change"
          && "find" in f[1].changed),
        "cc-row-change fired on input edit with detail.changed populated");
  assert.ok(fired.some((f) => f[0] === "delete" && f[1].rowId === row.id),
         "cc-row-delete fired on Delete click with rowId in detail");
});

test("cc-rule-row sets aria-invalid + role=alert on an invalid regex (A4)", async () => {
  const { w, d } = loadRow();
  const row = makeRow(w, d, { find: "", replace: "", matchtype: "regex",
      "case-sensitive": "false", disabled: "false" });
  await flush();

     // Toggle to regex mode, set a bad pattern.
  const regexRadio = row.querySelector('input[type="radio"][value="regex"]');
  regexRadio.checked = true;
  regexRadio.dispatchEvent(new w.Event("change", { bubbles: true }));
   await flush();

  const findInput = row.querySelector(".cc-find");
  findInput.value = "(unclosed";
  findInput.dispatchEvent(new w.Event("input", { bubbles: true }));
   await flush();

     // Trigger validation via the row's own setter (options.js calls _validate()).
  row._validate();
  assert.strictEqual(row.valid, false, "row is invalid when regex doesn't compile");
  assert.strictEqual(findInput.getAttribute("aria-invalid"), "true", "A4: aria-invalid=true");

  const err = row.querySelector('[role="alert"]');
  assert.ok(err, "A4: inline role=alert error region exists");
  assert.match((err.textContent || "").toLowerCase(), /invalid|pattern|regex/,
     "A4: error text describes the problem");
});

test("cc-rule-row 'values' property round-trips the Rule shape (UI §4.1)", async () => {
  const { w, d } = loadRow();
  const row = makeRow(w, d, { find: "", replace: "", matchtype: "text",
      "case-sensitive": "false", disabled: "false" });
  await flush();
  row.values = {
    id: row.id,
    find: "go",
    replace: "STOP",
    matchType: "regex",
    caseSensitive: true,
    enabled: true
    };
  const v = row.values;
  assert.strictEqual(v.find, "go");
  assert.strictEqual(v.replace, "STOP");
  assert.strictEqual(v.matchType, "regex");
  assert.strictEqual(v.caseSensitive, true);
  assert.strictEqual(v.enabled, true);
});

test("cc-rule-row 'values' setter validates a regex field on set (A4)", async () => {
  const { w, d } = loadRow();
  const row = makeRow(w, d, { find: "", replace: "", matchtype: "regex",
      "case-sensitive": "false", disabled: "false" });
  await flush();
  row.values = {
    id: row.id,
    find: "(unclosed",
    replace: "x",
    matchType: "regex",
    caseSensitive: false,
    enabled: true
    };
  assert.strictEqual(row.valid, false, "setter runs validation on a bad regex");
  assert.strictEqual(row.querySelector(".cc-find").getAttribute("aria-invalid"), "true");
});
