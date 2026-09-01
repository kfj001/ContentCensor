#!/usr/bin/env node
/*
 * scripts/check-syntax.js — syntax-check every shipped .js file (extension + tests).
 *
 * Exit 0 = all clean. Exit 1 = first failure with file + error.
 */
const { execSync } = require("node:child_process");
const path = require("node:path");

const files = [
  "background.js",
  "content.js",
  "cc-rule-row.js",
  "lib/rules.js",
  "options.js",
  "popup.js",
  "storage.js",
  "scripts/ci-gates.js",
  "test/helpers.js",
  "test/rules.test.js",
  "test/storage.test.js",
  "test/background.test.js",
  "test/content.test.js",
  "test/dom.test.js",
];

let failed = 0;
for (const f of files) {
  const abs = path.resolve(f);
  try {
    execSync(`node --check ${JSON.stringify(abs)}`, { stdio: "pipe" });
    process.stdout.write(`✔  ${f}\n`);
  } catch (e) {
    process.stderr.write(`✘  ${f}\n${e.stderr || e.message}\n`);
    failed++;
  }
}
if (failed > 0) {
  process.stderr.write(`\n${failed} file(s) failed.\n`);
  process.exit(1);
}
process.stdout.write(`\n${files.length} file(s) OK.\n`);
