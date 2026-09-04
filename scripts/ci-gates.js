#!/usr/bin/env node
/*
 * scripts/ci-gates.js — the §4.5 "forbidden patterns" grep gates.
 *
 * Each gate is a verifiable, greppable guarantee from next_gen.md §4.5. We scan
 * the extension source (excluding node_modules, the test harness, and the
 * lockfile). Exits non-zero if any gate fails. Run: `npm run gates` or
 * `node scripts/ci-gates.js`.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = [
  "manifest.json",
  "background.js",
  "content.js",
  "lib/rules.js",
  "cc-rule-row.js",
  "storage.js",
  "options.js",
  "popup.js",
  "options.html",
  "popup.html",
  "popup.css",
];

const files = SRC.filter((f) => fs.existsSync(path.join(ROOT, f)));
const htmlFiles = SRC.filter((f) => f.endsWith(".html") || f.endsWith(".htm"));
const html = htmlFiles.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");

// The extension manifest — the opt-in per-site injection invariant is verified
// structurally here (broad host access is forbidden; the surface must exist).
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

// Strip comment lines so gate regexes don't match explanatory text like
// "no jQuery" written in a doc comment.
const code = src.split("\n").filter((l) => {
  const t = l.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
  if (t.startsWith("<!--")) return false;
  return true;
}).join("\n");
const htmlCode = html.split("\n").filter((l) => {
  const t = l.trim();
  if (t.startsWith("<!--")) return false;
  return true;
}).join("\n");

function htmlNoComments(re) {
  return re.test(htmlCode);
}
function codeNoComments(re) {
  return re.test(code);
}

const gates = [
  {
   name: "1. No jQuery ($ jQuery selector or 'jquery' reference)",
    fail() {
       // (a) the 'jquery' token, or
       // (b) a global-$ selector $( " / $( ' in a file that does NOT declare
       //       its own `function $(...)` helper (options.js uses a local
       //       byId wrapper, which is allowed).
      let bad = false;
      for (const f of SRC) {
       if (!fs.existsSync(path.join(ROOT, f))) continue;
       let c = fs.readFileSync(path.join(ROOT, f), "utf8")
        .split("\n").filter((l) => {
         const t = l.trim();
         if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ||
           t.startsWith("<!--")) return false;
          return true;
            }).join("\n");
       if (/jquery/i.test(c)) { bad = true; break; }
       const hasLocalHelper = /function\s+\$\s*\(/.test(c);
       if (!hasLocalHelper && /\$\s*\(?\s*['"]/.test(c)) { bad = true; break; }
         }
      return bad;
        },
  },
  {
    name: "2. No chrome.storage.sync.clear in the save path",
    fail: () => /sync\s*\.\s*clear/.test(code),
  },
  {
    name: "3. No parallel arrays (toReplace[ / replaceWith[ / Boxes[index])",
    fail: () => /toReplace\s*\[|replaceWith\s*\[|Boxes\s*\[\s*index\s*\]/.test(code),
  },
  {
    name: "4. No innerHTML from untrusted data",
    fail: () => /innerHTML\s*=/i.test(code),
  },
  {
    name: "5. No inline event handlers in popup/options markup",
    fail: () => htmlNoComments(/\son(click|input|change|load|submit|mouseover|mousedown)\s*=/i),
  },
    {
     name: "6. No inline <script>/ <style> in popup/options markup",
     fail: () =>
       htmlNoComments(/<script(?![^>]*\bsrc\s*=)/i) ||
       htmlNoComments(/<style[\s>]/i),
    },
      {
          // Opt-in per-site model: NO broad host access is GRANTED at install
          // (no host_permissions, <all_urls> out of permissions, no wildcard
          // content_scripts). Per-site host access is requested at RUNTIME via
          // chrome.permissions.request({origins:[exactHost]}), which requires a
          // pool declaration in optional_host_permissions. Chrome still prompts
          // per-origin and grants only the exact host; content.js self-gates on
          // contentCensorSites so a non-enabled site stays inert.
      name: "7. No broad host access at install (no host_permissions/all_urls/wildcard content_scripts; pool declared)",
      fail() {
        const perms = manifest.permissions || [];
        const hostPerms = manifest.host_permissions || [];
        const broadGrant =
          perms.includes("<all_urls>") ||
          hostPerms.includes("<all_urls>") ||
          hostPerms.length > 0;
        if (broadGrant) return true;
        // No content_scripts wildcard (that would inject on every page).
        const cs = manifest.content_scripts;
        if (Array.isArray(cs) && cs.some((e) =>
          Array.isArray(e.matches) && e.matches.some((m) => /https?:\/\/\*\/\*/.test(m))))
         return true;
        // The per-site pool must be declared so runtime requests can succeed;
        // it must be the scheme-pool pattern, never a pre-baked specific host.
        const pool = manifest.optional_host_permissions || [];
        if (pool.length === 0) return true;
        return pool.some((p) =>
          !/^[a-z\*]:\/\/[a-z\*\/\.\-]+\/*$|^<all_urls>$/i.test(p));
             },
       },
    {
       // The opt-in injection surface must exist: background.js injects via
       // chrome.scripting, so it must request a host permission at enable time.
     name: "8. Opt-in injection surface present (chrome.permissions.request in background.js)",
     fail() {
       const bg = fs.readFileSync(path.join(ROOT, "background.js"), "utf8")
         .split("\n").filter((l) => {
            const t = l.trim();
            if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"))
             return false;
            return true;
        }).join("\n");
       return !/permissions\s*\.\s*request/.test(bg);
          },
    },
];

let failed = 0;
for (const g of gates) {
  if (g.fail()) {
    console.log("✖ FAIL  " + g.name);
    failed++;
  } else {
    console.log("✔ PASS  " + g.name);
  }
}

console.log("");
console.log((gates.length - failed) + "/" + gates.length + " §4.5 gates passed.");
process.exit(failed ? 1 : 0);
