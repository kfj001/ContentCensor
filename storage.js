/*
* storage.js — the storage controller (UI §4.1 / §4.3 load + save; M1 / MV3 0.2).
*
 * The ONLY place the UI reads/writes rules. It owns:
 *    - the state shape { rows:[{id,find,replace,matchType,caseSensitive,
 *      enabled}], dirty, status } (UI §4.1),
 *     - LOAD + backward-compatible migration of legacy {find,replace,isRegex} rows,
 *     - SAVE as a SINGLE atomic chrome.storage.sync.set (NO chrome.storage.sync.clear
 *       — eliminates the empty-window data-loss race; MV3 Phase 0.2 / A4),
 *           - per-row enable, and persisting defined rules (non-empty find, with their
      *      enabled flag) — so the popup can report "active vs defined".
*
* Loaded as a classic extension-page script. `window.CCStorage` exposes the API;
* `module.exports` exposes the same API to the node test runner (with a chrome
* mock injected as win.chrome / globalThis.chrome via getChrome()).
*/
"use strict";

(function () {
   var Rules = (typeof window !== "undefined" && window.CCRules)
       ? window.CCRules
        : require("./lib/rules.js");    // node test fallback — not hit in a page once lib/rules.js loads first (P0-1)

   // The chrome API. In a real extension page the global object is `window`, so a
   // bare `global` reference throws a ReferenceError (P0-2). Resolve the API
   // through window then globalThis, and fall back to undefined when chrome is not
   // present (the onChanged wiring below is guarded on that). In Node, globalThis
   // === global, so this still resolves a test-injected chrome mock.
  function getChrome() {
    if (typeof window !== "undefined" && window.chrome) return window.chrome;
    if (typeof globalThis !== "undefined" && globalThis.chrome) return globalThis.chrome;
    return undefined;
      }

      // Fresh projection of what the UI holds; persisted shape == Rules.serializeSync.
   function freshState() {
     return { rows: [], dirty: false, status: "idle", _updatedAt: null };
     }
  var state = freshState();

     /** @returns {Array} a fresh copy of every DEFINED rule (non-empty find),
      including disabled ones — the "defined" count the popup reports. Only blank
      no-op rows are excluded, mirroring serializeSync's persistence filter. */
   function definedRules() {
     return state.rows
        .filter(function (r) { return !!r.find; })
        .map(function (r) {
         return Rules.normalizeRule(r);
         });
      }

      /** Read storage, migrate legacy rows into the v3 shape, populate state. */
   function load(cb) {
     var c = getChrome();
     c.storage.sync.get(["contentCensorData", "updatedAt", "seededExamples"],
       function (items) {
         items = items || {};
         state.rows = Rules.migrateRules(items.contentCensorData);
         state.dirty = false;
         state.status = "idle";
         state._updatedAt = items.updatedAt || null;
         state._seededExamples = items.seededExamples || 0;
       if (cb) cb(state);
         });
      }

    /** Build one blank Rule and append it. */
  function addRow() {
    var r = { id: Rules.newId(), find: "", replace: "", matchType: "text",
        caseSensitive: false, enabled: true };
    state.rows.push(r);
    state.dirty = true;
    return r;
    }

  function removeRow(id) {
    state.rows = state.rows.filter(function (r) { return r.id !== id; });
    state.dirty = true;
    }

    /**
    * ATOMIC save (M1 / MV3 Phase 0.2): a single chrome.storage.sync.set, NO
     * clear(). Persist only enabled + non-empty-find rows (defect #2), with the
     * enabled flag + updatedAt. On chrome.runtime.lastError / quota we keep
     * dirty=true so the user can retry (no data loss — the window is never empty).
    */
  function save() {
    state.status = "saving";
    var payload = Rules.serializeSync(state);
    var c = getChrome();
    c.storage.sync.set(payload, function () {
      // In MV3 the set callback receives no error object; the error (if any) is
      // on chrome.runtime.lastError.
      var err = c.runtime && c.runtime.lastError;
      if (err) {
        state.status = "error";
        state.dirty = true;
        return;
       }
      state.status = "saved";
      state.dirty = false;
      state._updatedAt = payload.updatedAt;
      });
    }

  function markDirty() {
    if (!state.dirty) { state.dirty = true; state.status = "idle"; }
    }

    // Wire cross-surface live update WITHOUT clobbering a local unsaved edit.
  var c = getChrome();
  if (c && c.storage && c.storage.onChanged) {
    c.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync") return;
       if (changes.contentCensorData) {
         if (!state.dirty) load();
        }
      });
    }

   var api = {
     state: state,
     load: load,
     save: save,
      addRow: addRow,
      removeRow: removeRow,
      markDirty: markDirty,
      definedRules: definedRules,
      normalizeRule: Rules.normalizeRule,
      newId: Rules.newId
      };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.CCStorage = api;
})(typeof window !== "undefined" ? window : globalThis);
