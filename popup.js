/*
* popup.js — lightweight status & control panel (F-1 / F-5; UI §3.1 / §3.2).
*
* Loads after storage.js (window.CCStorage). Pattern: status-at-a-glance +
* progressive disclosure:
*       - an on/off master switch (role="switch" aria-checked; Q2 profile flag),
*       - a summary line "N terms active · last updated Xh ago" (aria-live polite),
*       - a primary "Open settings" button -> chrome.runtime.openOptionsPage(),
*       - a compact read-only preview of the first 3 active rules,
*       - on first install (F-5) the summary reads "N example rules loaded —
*       edit or delete them in Settings" so the seeded defaults read as
*       *suggestions*, not the user's own rules.
*
* Focus is set to the master switch on open (A6). Escape closes the popup (a small
* fixed-width dialog with no unsaved edits here, A7). No jQuery; no per-element
* binding.
*/
"use strict";

(function () {
  var S = (typeof window !== "undefined" && window.CCStorage) ? window.CCStorage : null;

  function $id(id) { return document.getElementById(id); }

  function previewRows() {
    var active = S.state.rows.filter(function (r) {
      return r.enabled !== false && !!r.find;
       }).slice(0, 3);
    return active.map(function (r) {
      return { find: r.find, replace: r.replace, matchType: r.matchType || "text" };
      });
     }

  function render() {
    var active = S.state.rows.filter(function (r) {
      return r.enabled !== false && !!r.find;
      });
    var n = active.length;

      // Master switch reflects the profile enabled flag (Q2).
    var sw = $id("cc-master");
    if (sw) {
      sw.checked = S.state.enabled !== false;
      sw.setAttribute("aria-checked", String(S.state.enabled !== false));
       }

      // Summary line (A4 aria-live polite; F-5 example-rule copy on first install).
    var summary = $id("cc-summary");
    if (summary) {
      if (S.state._seededExamples && n === S.state._seededExamples && !S.state.dirty) {
        summary.textContent = S.state._seededExamples + " example rules loaded — "
            + "edit or delete them in Settings";
        } else {
        summary.textContent = n + (n === 1 ? " term active" : " terms active")
            + " · last updated " + formatUpdated();
        }
      }

      // Read-only preview of the first 3 active rules (no parallel arrays — F-3/A2).
    var list = $id("cc-preview");
    if (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      if (n === 0) {
        var none = document.createElement("li");
        none.className = "cc-empty";
        none.textContent = "No active terms yet.";
        list.appendChild(none);
          } else {
          previewRows().forEach(function (r) {
            var li = document.createElement("li");
            var type = document.createElement("span");
            type.className = "cc-preview-type";
            type.textContent = r.matchType === "regex" ? "regex" : "text";
            type.setAttribute("title", "match type");
            var match = document.createElement("span");
            match.className = "cc-preview-pair";
            match.textContent = "'" + r.find + "' → '" + r.replace + "'";
            li.appendChild(type);
            li.appendChild(match);
            list.appendChild(li);
             });
         }
        }

      // Toggle-all on the popup mirrors the per-row enable; marks dirty + saves.
    var t = $id("cc-toggle-all");
    if (t) t.disabled = S.state.rows.length === 0;
          }

  function formatUpdated() {
    var ts = S.state && S.state._updatedAt;
    if (!ts) return "—";
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    return Math.round(s / 3600) + "h ago";
        }

  function init() {
    if (!S) return;
    S.load(function () {
      render();
      var sw = $id("cc-master");
      if (sw && sw.focus) sw.focus();     // focus on open (A6)
         });

    var sw = $id("cc-master");
    if (sw) sw.addEventListener("change", function () {
      S.setEnabled(sw.checked);
      sw.setAttribute("aria-checked", String(S.state.enabled !== false));
      S.save();
        });

    var open = $id("cc-open-settings");
    if (open) open.addEventListener("click", function () {
      if (chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
          });

    var t = $id("cc-toggle-all");
    if (t) t.addEventListener("click", function () {
      var anyEnabled = S.state.rows.some(function (r) { return r.enabled !== false; });
      S.state.rows.forEach(function (r) { r.enabled = !anyEnabled; });
      S.save();
          });

       // Escape closes a dialog with no unsaved edits (A7).
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && window.close) {
        try { window.close(); } catch (_e) { /* some harnesses */ }
          }
          });
         }

       // Expose for tests.
       if (typeof module !== "undefined" && module.exports) module.exports = {
         render: render, init: init, previewRows: previewRows, formatUpdated: formatUpdated
          };
      }
      )();
