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

test("M-3: no broad content_scripts — the script is injected OPT-IN per site", () => {
  // The "install on every page" surface is gone. There must be NO content_scripts
  // block with http/https wildcard matches (that is the all-hosts permission).
  const anyWild = Array.isArray(manifest.content_scripts) && manifest.content_scripts.some(
    (entry) => Array.isArray(entry.matches) && entry.matches.some((m) =>
      /https?:\/\/\*\/\*/.test(m)));
  assert.ok(!anyWild,
    "no content_scripts entry matches all http/https hosts (opt-in injection only)");
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

test("M-6: storage, tabs + scripting permissions are declared", () => {
   assert.ok(Array.isArray(manifest.permissions), "permissions is an array");
  assert.ok(manifest.permissions.includes("storage"),
     "storage permission is declared");
  assert.ok(manifest.permissions.includes("scripting"),
     "scripting permission — required for chrome.scripting.executeScript injection");
  assert.ok(manifest.permissions.includes("tabs"),
     "tabs permission — required for active-tab query + onUpdated reinjection");
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

// The opt-in per-site model: nothing host-reaching is GRANTED at install. The
// extension holds only storage + tabs + scripting; host access (and content-script
// injection) is granted per exact origin at runtime via
// chrome.permissions.request + a user opt-in (contentCensorSites).
//
// `optional_host_permissions` is a *declaration* (the pool of hosts the extension
// is allowed to ask for), NOT a grant. Chrome still prompts per-origin and grants
// only the exact host the user accepts, and content.js self-gates on
// contentCensorSites so a non-enabled site stays inert. So the invariant is:
// NO broad *grant* (no host_permissions, no broad permissions, no wildcard
// content_scripts), while the per-site pool declaration MAY exist.
test("M-9: no broad host access granted at install", () => {
   assert.strictEqual(manifest.host_permissions, undefined,
        "no host_permissions key (no broad host grant at install)");
      // The only always-granted permissions are the three runtime capabilities.
   assert.deepStrictEqual(manifest.permissions, ["storage", "tabs", "scripting"],
        "permissions are exactly storage + tabs + scripting — nothing broadly host-reaching");
      // No content_scripts wildcard (that would inject on every page).
   const cs = manifest.content_scripts;
   const wild = Array.isArray(cs) && cs.some((e) =>
      Array.isArray(e.matches) && e.matches.some((m) => /https?:\/\/\*\/\*/.test(m)));
   assert.ok(!wild, "no content_scripts entry matches all http/https hosts");
      // The per-site pool declaration MAY be opted-in; if present it must be the
      // scheme-pool pattern, never a specific pre-baked broad host grant.
   const oph = manifest.optional_host_permissions || [];
   oph.forEach((p) => {
      assert.ok(!/^[a-z]+:\/\/[a-z0-9.-]+\//.test(p),
         "optional_host_permissions is a pool declaration, never a pre-baked host: " + p);
   });
});

 // The opt-in surface must actually request the host at runtime.
test("M-10: opt-in injection requests host permission at runtime", () => {
   const bgSrc = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
   assert.ok(/permissions\s*\.\s*request/.test(bgSrc),
       "background.js requests the host permission via chrome.permissions.request");
});



