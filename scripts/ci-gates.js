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
