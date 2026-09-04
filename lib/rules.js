/*
 * lib/rules.js — pure rule logic for Content Censor v3.0.0 (single source of truth).
 *
 * UI §4.1 data model — the Rule object:
 *   { id, find, replace, matchType: "text"|"regex", caseSensitive, enabled }
 *
 * This file is dependency-free and pure, so the SAME code is:
 *   - `require`d by the node:test unit tests,
 *   - loaded as a classic script by the extension pages (options.html / popup.html),
 *     - and mirrored, verbatim, into content.js (via the global this file
 *       sets) where it must stay CSP-safe and import-free on an arbitrary host
 *       page (UI §2.3 content-script isolation).
 *
 * Contract (UI §4.1 / §4.5): there are NO parallel arrays anywhere. One Rule
 * object per rule; storage serializes an Array<Rule>; empty-find and invalid-regex
 * rows are dropped at save + at match time, so no no-op or broken rule is ever
 * persisted or matched (defects #1/#2).
 */
"use strict";

(function (global) {
  /**
   * Escape every RegExp-special character so a literal "find" string can be used
   * as a RegExp source without treating its characters as metacharacters.
   * @param {string|number} s
   * @returns {string}
   */
  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Build the RegExp used to match one rule.
   *   - matchType "regex": compile the raw `find` source; throws on an invalid
   *     pattern (the options surface catches this and shows a role="alert").
   *   - matchType "text": a global substring match using the escaped source.
   *
   * Flags (UI §4.1 / §4.4): "g" so a single pass replaces every occurrence; add
   * "i" (case-insensitive) UNLESS the rule opts into case-sensitive matching.
   * Today's legacy default is "gi" (case-insensitive), preserved as the default.
   *
   * @param {string|RegExp} find
   * @param {boolean} caseSensitive
   * @param {("text"|"regex")} matchType
   * @returns {RegExp}
   */
  function buildPattern(find, caseSensitive, matchType) {
    var flags = "g" + (caseSensitive ? "" : "i");
    if (matchType === "regex") {
      return find instanceof RegExp
        ? new RegExp(find.source, flags)
        : new RegExp(String(find), flags);
    }
    return new RegExp(escapeRegex(String(find)), flags);
  }

  /**
   * Turn a single rule into the RegExp the content script applies.
   * Returns null for an empty find or an invalid regex (that row is skipped).
   *
   * @param {object} rule - a Rule (UI §4.1)
   * @returns {RegExp|null}
   */
  function patternForRule(rule) {
    if (!rule || !rule.find) return null;
    try {
      return buildPattern(rule.find, !!rule.caseSensitive, rule.matchType || "text");
    } catch (_e) {
      // Invalid regex — the row is skipped here and surfaced by the UI.
      return null;
    }
  }

  /**
   * Normalize a single legacy row `{find, replace, isRegex}` into the v3 Rule
   * shape (UI §4.1 migration). A new row (already v3) is passed through, with an
   * `id` minted when absent.
   *
   *   - matchType    = matchType || (isRegex ? "regex" : "text")   (kill C3 defect)
   *   - caseSensitive = false unless explicitly true  (preserves legacy "gi")
   *   - enabled      = true unless explicitly false
   *
   * @param {object} row
   * @returns {object} a v3 Rule
   */
  function normalizeRule(row) {
    var src = row || {};
    return {
      id: src.id || newId(),
      find: src.find != null ? String(src.find) : "",
      replace: src.replace != null ? String(src.replace) : "",
      matchType: src.matchType || (src.isRegex ? "regex" : "text"),
      caseSensitive: src.caseSensitive === true,
      enabled: src.enabled === undefined ? true : src.enabled === true
    };
  }

  /**
   * Migrate whatever is stored under "contentCensorData" into the v3 shape.
   * Backward compatible: accepts a legacy `[{find,replace,isRegex}]` array, a
   * single rule object, or an already-migrated v3 array. Non-array junk -> [].
   *
   * @param {*} raw
   * @returns {Array<object>} Array<Rule>
   */
  function migrateRules(raw) {
    if (raw == null) return [];
    var arr = Array.isArray(raw) ? raw : [raw];
    return arr.map(normalizeRule);
  }

  /**
   * The set of rules the content script actually applies (UI §4.1 save filter +
   * UI §4.4 transform): enabled + non-empty find, each reduced to a usable
   * pattern. Empty/invalid rows are dropped, so no no-op or broken rule is ever
   * matched (defects #1/#2).
   *
   * @param {Array<object>} rows
   * @returns {Array<{re: RegExp, replacement: string}>}
   */
  function toPatterns(rows) {
    var out = [];
    var arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (!r || r.enabled === false || !r.find) continue;
      var re = patternForRule(r);
      if (re) out.push({ re: re, replacement: r.replace != null ? String(r.replace) : "" });
    }
    return out;
  }

    /**
     * Serialize a UI state for storage (UI §4.1 save): persist only the
     * non-empty-find rules (each row's own enabled flag is respected) plus a
     * timestamp. The caller wraps this as a SINGLE atomic chrome.storage.sync.set
     * — there is NO chrome.storage.sync.clear() anywhere (M1 / MV3 Phase 0.2),
     * which removes the empty-window data race.
     *
     * @param {object} state - { rows }
     * @returns {{contentCensorData: Array<object>, updatedAt: number}}
     */
   function serializeSync(state) {
     var all = (state && state.rows ? state.rows : []);
     var rows = [];
     for (var i = 0; i < all.length; i++) {
       var r = normalizeRule(all[i]);
       if (r.enabled !== false && r.find) rows.push(r);
      }
     return {
       contentCensorData: rows,
       updatedAt: Date.now()
      };
     }

  // 22-bit-ish monotonic id; sufficient for a single-profile rules UI.
  var _seq = 0;
  /** @returns {string} a stable, collision-resistant row id */
  function newId() {
    var t = Date.now().toString(36);
    var r = Math.random().toString(36).slice(2, 8);
    return "r" + t + r + (_seq++).toString(36);
  }

  /**
   * Seed defaults on first install/startup (UI §3.6 F-5). Kept here so the test
   * and the background worker share one definition and the popup can read the
   * seeded count.
   * @returns {Array<object>} Array<Rule>
   */
  function defaultRules() {
    return [
      { find: "republican", replace: "pervert", isRegex: false },
      { find: "tea party", replace: "pervert", isRegex: false },
      { find: "iPhone", replace: "Abortion", isRegex: true },
      { find: "Republican", replace: "Pervert", isRegex: false },
      { find: "Tea Party", replace: "Rape Philosophy Party", isRegex: false },
      { find: "GOP", replace: "CUNT", isRegex: false }
    ].map(normalizeRule);
  }

  var API = {
    escapeRegex: escapeRegex,
    buildPattern: buildPattern,
    patternForRule: patternForRule,
    normalizeRule: normalizeRule,
    migrateRules: migrateRules,
    toPatterns: toPatterns,
    serializeSync: serializeSync,
    newId: newId,
    defaultRules: defaultRules
  };

  // Dual export: node `require()` gets module.exports; a browser global
  // (window.CCRules) lets the extension pages and content.js share this
  // exact code instead of inlining a duplicate.
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.CCRules = API;
  else if (typeof global !== "undefined") global.CCRules = API;
})(this);
