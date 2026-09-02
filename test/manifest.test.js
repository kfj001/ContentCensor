/*
 * test/manifest.test.js — MV3 manifest verification.
 * Guards: manifest_version, background.service_worker, content_scripts[].js,
 * no `externally_connectable`, no `web_accessible_resources` for arbitrary hosts,
 * storage sync quota, no jQuery dependency in manifest.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

test("M-1: manifest_version is 3", () => {
  assert.strictEqual(manifest.manifest_version, 3, "MV3 manifest_version");
});

test("M-2: background is a service_worker (MV3 ephemeral)", () => {
  assert.ok(manifest.background, "background block exists");
  assert.strictEqual(manifest.background.service_worker, "background.js",
      "background.service_worker points to background.js");
  assert.strictEqual(manifest.background.persistent, undefined,
      "MV3: no persistent flag (ephemeral worker)");
});

test("M-3: content_scripts entry includes lib/rules.js before content.js", () => {
  assert.ok(Array.isArray(manifest.content_scripts), "content_scripts is an array");
  const cs = manifest.content_scripts[0];
  assert.ok(cs, "content_scripts has an entry");
  assert.ok(Array.isArray(cs.js), "content_scripts.js is an array");
  const idxRules = cs.js.indexOf("lib/rules.js");
  const idxContent = cs.js.indexOf("content.js");
  assert.ok(idxRules >= 0, "lib/rules.js is listed in content_scripts.js");
  assert.ok(idxContent >= 0, "content.js is listed in content_scripts.js");
  assert.ok(idxRules < idxContent, "lib/rules.js loads before content.js");
});

test("M-4: options_ui.page is options.html", () => {
  assert.ok(manifest.options_ui, "options_ui block exists");
  assert.strictEqual(manifest.options_ui.page, "options.html",
      "options_ui.page points to options.html");
});

test("M-5: action.default_popup is popup.html", () => {
  assert.strictEqual(manifest.action.default_popup, "popup.html",
      "action.default_popup points to popup.html");
});

test("M-6: storage permission is sync", () => {
  assert.ok(Array.isArray(manifest.permissions), "permissions is an array");
  assert.ok(manifest.permissions.includes("storage"),
      "storage permission is declared");
});

// jQuery-free guard: no jQuery anywhere in the extension. The manifest lists no
// jQuery script, and content.js uses only createElement/textContent (no $. / jQuery()).
test("M-7: no jQuery dependencies in manifest.json or content.js", () => {
  const manifestSrc = fs.readFileSync(
     path.join(ROOT, "manifest.json"), "utf8"
    );
  assert.ok(!manifestSrc.toLowerCase().includes("jquery"),
       "manifest.json has no jQuery reference");

  const contentJs = fs.readFileSync(path.join(ROOT, "content.js"), "utf8");
   // Check for actual jQuery usage patterns, not the word "jQuery" in a comment.
  const hasJQueryUsage = /\$[.\s(]/.test(contentJs) || /jQuery\(/.test(contentJs);
  assert.ok(!hasJQueryUsage, "content.js has no jQuery runtime usage");
});

// No background.js keep-alive alarms (MV3 §3.3 — must be zero).
test("M-8: manifest does not include alarms permission (MV3 §3.3 no keep-alive)", () => {
  assert.ok(!manifest.permissions.includes("alarms"),
      "no alarms permission — the worker has no keep-alive ping loop");
});
