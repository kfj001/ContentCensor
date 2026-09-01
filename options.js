/*
* options.js — options page controller (F-2; UI §3.2 / §4.3).
*
* Loads after storage.js (window.CCStorage) and cc-rule-row.js (window.CcRuleRow).
* Implements the §4.3 page contract:
*      - render() maps state.rows -> <cc-rule-row> with STABLE id reconciliation
*        (update-in-place, focus/scroll preserved — the React-free substitute);
*      - EXACTLY TWO delegated listeners on the grid container: one "click" that
*       switches on e.target.closest("[data-action]") (add/delete/save/toggle-all/
*       open-settings), and one "input"+"change" that forwards the cc-rule-row
*       custom events into state + sets dirty (UI §4.3 — kills jQuery's per-element
*       binding, C7);
*      - atomic single-call save via CCStorage.save() — NO chrome.storage.sync.clear()
*        (M1 / MV3 Phase 0.2 / A4); NO window.close() (UI §3.2 F-2 — keep the user on
*        the page);
*      - keyboard: Ctrl/Cmd+S saves (preventDefault); focus returns to the last
*       changed control after a save re-render and moves to the first invalid row on
*       submit (A5/A6).
*/
"use strict";

(function () {
  var S = (typeof window !== "undefined" && window.CCStorage) ? window.CCStorage : null;
  var els = {};
  var lastTouchedTag = null;   // control to refocus after a save re-render (A6)

   // Local helper: document.getElementById by id. NOT jQuery — the module is
   // dependency-free (0 KB, UI §4.3); this wraps only a native call.
   function byId(id) { return document.getElementById(id); }

  function activeCount() {
    return S.state.rows.filter(function (r) { return r.enabled !== false && !!r.find; }).length;
    }

    // Re-render the grid. Reconcile by id: update in place / append new / drop
   // removed. Preserves focus/scroll on surviving rows (A6, §4.3 render).
 function render() {
  var grid = els.grid;
  var rows = S.state.rows;
  var seen = {};
  var total = rows.length;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var el = grid.querySelector('cc-rule-row[data-rid="' + r.id + '"]');
    if (!el) {
      if (window.CcRuleRow && typeof window.CcRuleRow === "function") el = new window.CcRuleRow();
      else el = document.createElement("cc-rule-row");
      el.dataset.rid = r.id;
      el.id = r.id;
      grid.appendChild(el);
       }
    el.setAttribute("index", String(i));
    el.setAttribute("total", String(total));
    el.setAttribute("find", r.find || "");
    el.setAttribute("replace", r.replace || "");
    el.setAttribute("matchtype", r.matchType || "text");
    el.setAttribute("case-sensitive", r.caseSensitive ? "true" : "false");
    el.setAttribute("disabled", r.enabled === false ? "true" : "false");
    seen[r.id] = true;
     }

     // Drop removed rows.
  Array.prototype.slice.call(grid.querySelectorAll("cc-rule-row")).forEach(function (el) {
    if (!seen[el.dataset.rid]) el.remove();
      });

  els.empty.hidden = rows.length !== 0;
   updateStatus();
    }

  function updateStatus() {
    var n = activeCount();
    els.summary.textContent = n + (n === 1 ? " term active" : " terms active")
      + " · last updated " + formatUpdated();
    els.save.disabled = !S.state.dirty;
    els.dirtyBanner.hidden = !S.state.dirty;
    switch (S.state.status) {
      case "saving":
        els.save.textContent = "Saving…"; els.save.disabled = true; break;
      case "saved":
        els.save.textContent = "Save";
        els.message.textContent = "Saved.";
        els.message.setAttribute("role", "status");
        els.message.hidden = false;
        break;
      case "error":
        els.save.textContent = "Save";
        els.message.textContent = "Save failed; your changes are still here. Try again.";
        els.message.setAttribute("role", "alert");
        els.message.hidden = false;
        break;
      default:
        if (!S.state.dirty) { /* keep last confirmation */ }
        }
     }

  function formatUpdated() {
    var ts = S.state && S.state._updatedAt;
    if (!ts) return "—";
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    return Math.round(s / 3600) + "h ago";
      }

     // Read one row's current DOM values into state (the row owns its own form).
  function readRow(el) {
    var r = S.state.rows.find(function (x) { return x.id === el.dataset.rid; });
    if (!r || !el.values) return;
    var v = el.values;
    r.find = v.find;
    r.replace = v.replace;
    r.matchType = v.matchType;
    r.caseSensitive = v.caseSensitive;
    r.enabled = v.enabled;
      }

     /**
     * Save (UI §4.3): validate every row, focus the first invalid one and abort;
     * else atomic save. status saving -> saved (dirty=false) / error (dirty stays
      * true so the user can retry; no data loss — UI §3.2 F-2, M1).
     */
  function doSave() {
    var rows = Array.prototype.slice.call(els.grid.querySelectorAll("cc-rule-row"));
    var firstInvalid = null;
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i];
      el._validate();           // updates the row's own aria-invalid + role=alert
      readRow(el);
      if (!el.valid && !firstInvalid) firstInvalid = el;
       }
    if (firstInvalid) {
      firstInvalid.focusInvalid();
      return;
        }
    lastTouchedTag = (document.activeElement && document.activeElement.tagName)
        ? document.activeElement.tagName.toLowerCase() : null;
    S.save();
    saveComplete();
      }

     // After the async save settles, move focus and refresh the status line.
  function saveComplete() {
    var attempts = 0;
    var tick = function () {
      attempts++;
      if (S.state.status === "saving" && attempts < 1000) {
        setTimeout(tick, 5);
        return;
          }
      updateStatus();
      if (S.state.status === "saved") restoreFocus();
        };
    setTimeout(tick, 0);
      }

     // Return focus to the control the user last touched (A6).
  function restoreFocus() {
    var tag = lastTouchedTag;
    if (!tag) return;
    var cand = els.grid.querySelector("." + (tag === "input" ? "cc-find" : tag));
    if (cand && cand.focus) cand.focus();
     }

  function init() {
els.grid = byId("cc-grid");
     els.add = byId("cc-add");
     els.save = byId("cc-save");
     els.summary = byId("cc-summary");
     els.dirtyBanner = byId("cc-dirty");
     els.message = byId("cc-message");
     els.toggleAll = byId("cc-toggle-all");
     els.switch = byId("cc-master");
     els.empty = byId("cc-empty");
     els.settings = byId("cc-open-settings");

     // Master switch (F-1 / Q2): real role="switch" toggling the profile flag.
    if (els.switch) {
      els.switch.checked = S.state.enabled !== false;
      els.switch.setAttribute("aria-checked", String(S.state.enabled !== false));
      els.switch.addEventListener("change", function () {
        S.setEnabled(els.switch.checked);
        els.switch.setAttribute("aria-checked", String(S.state.enabled !== false));
        S.markDirty();
        updateStatus();
          });
        }

        // ---- EXACTLY TWO delegated listeners on the grid (§4.3) --------------
     // 1) one click listener: data-action switch (add / delete / toggle-all /
     //    open-settings live OUTSIDE the grid; the per-row Delete is in-grid).
    els.grid.addEventListener("click", function (e) {
      var t = e.target.closest("[data-action]");
      if (!t) return;
      var action = t.getAttribute("data-action");
      if (action === "delete") {
        var rowEl = e.target.closest("cc-rule-row");
        if (rowEl) { S.removeRow(rowEl.dataset.rid); S.markDirty(); render(); }
          }
           });

     // 2) one input+change listener: forward the row's custom events into state.
     function forward(evt) {
        var rowEl = evt.target.closest ? evt.target.closest("cc-rule-row") : null;
        if (!rowEl) return;
        if (evt.type === "cc-row-delete") {
          S.removeRow(evt.detail.rowId); S.markDirty(); render();
            } else if (evt.type === "cc-row-change") {
          readRow(rowEl); S.markDirty();
            }
          }
    els.grid.addEventListener("input", forward);
    els.grid.addEventListener("change", forward);

        // Toolbar buttons live outside the grid — individual (not delegated) so the
     // grid keeps exactly two listeners per §4.3.
    if (els.add) els.add.addEventListener("click", function () {
      S.addRow(); S.markDirty(); render(); els.add.focus();
        });
    if (els.save) els.save.addEventListener("click", doSave);
    if (els.toggleAll) els.toggleAll.addEventListener("click", function () {
      var anyEnabled = S.state.rows.some(function (r) { return r.enabled !== false; });
      S.state.rows.forEach(function (r) { r.enabled = !anyEnabled; });
      S.markDirty(); render();
          });
    if (els.settings) els.settings.addEventListener("click", function () {
      if (chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
          });

        // Ctrl/Cmd+S to save (§4.3 / A5).
      window.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
          e.preventDefault(); doSave();
             }
          });

            // Load, then render, then focus the master switch on open (A6).
        S.load(function () {
          render();
          if (els.switch && els.switch.focus) els.switch.focus();
            });
          }

            // Expose for tests (does not run until the page supplies #cc-grid).
        if (typeof module !== "undefined" && module.exports) module.exports = {
          render: render, doSave: doSave, init: init, updateStatus: updateStatus,
          readRow: readRow, activeCount: activeCount
            };
      })();
