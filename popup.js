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
   var _inited = false;
   var activeTab = null;             // the tab the popup is acting on
   var enabledSites = [];            // contentCensorSites mirror

   function $id(id) { return document.getElementById(id); }

      // Resolve chrome the same way the onChanged wiring does (window -> globalThis
      // -> global), so the per-site query works in both a real page and node.
   function getChrome() {
     if (typeof window !== "undefined" && window.chrome) return window.chrome;
     if (typeof globalThis !== "undefined" && globalThis.chrome) return globalThis.chrome;
     if (typeof global !== "undefined" && global.chrome) return global.chrome;
     return undefined;
       }

      /** Exact-host match pattern for a URL, or null for non-web origins. */
   function siteFor(url) {
     if (!url) return null;
     var u;
     try { u = new URL(url); } catch (_e) { return null; }
     if (u.protocol !== "http:" && u.protocol !== "https:") return null;
     return u.origin + "/*";
       }

     // Keep the switch's visible "Replacements on/off" label in sync with its state.
  function reflectLabel(on) {
    var lbl = $id("cc-switch-text");
    if (lbl) lbl.textContent = "Replacements " + (on ? "on" : "off");
     }

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

        // Master switch reflects the profile enabled flag (Q2) via aria-checked.
      var sw = $id("cc-master");
      if (sw) {
        var on = S.state.enabled !== false;
        sw.setAttribute("aria-checked", String(on));
        reflectLabel(on);
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

       // Per-site opt-in (contentCensorSites): reflect + toggle whether THIS tab's
       // origin is enabled. The background handler requests the host permission
       // and injects the content script; we only mirror enabled state here.
   function renderSite() {
     var row = $id("cc-site-row");
     var note = $id("cc-site-note");
     var unsupported = $id("cc-site-unsupported");
     var sw = $id("cc-enable-site");
     if (!row) return;                        // element not in this build (e.g. tests)
     var site = siteFor(activeTab ? activeTab.url : null);
     var isOn = !!site && enabledSites.indexOf(site) !== -1;
     if (!site) {
       row.hidden = true;
       note.hidden = true;
       unsupported.hidden = false;
       return;
         }
     unsupported.hidden = true;
     row.hidden = false;
     note.hidden = isOn;
     if (sw) {
      sw.setAttribute("aria-checked", String(isOn));
      var txt = $id("cc-enable-site-text");
      if (txt) txt.textContent = isOn
        ? "Enabled on this site"
        : "Enable on this site";
         }
       }

   function queryActiveTab() {
     var c = getChrome();
     if (!c || !c.tabs || !c.tabs.query) return;
     c.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      activeTab = tabs && tabs[0] ? tabs[0] : null;
      renderSite();
        });
       }

   function loadEnabledSites() {
     var c = getChrome();
     if (!c || !c.storage || !c.storage.sync) return;
     c.storage.sync.get("contentCensorSites", function (items) {
      enabledSites = (items && items.contentCensorSites) || [];
      renderSite();
        });
       }

   function toggleSite() {
     var site = siteFor(activeTab ? activeTab.url : null);
     if (!site) return;
     var c = getChrome();
     if (!c || !c.runtime || !c.runtime.sendMessage) return;
     var next = enabledSites.indexOf(site) === -1;
     c.runtime.sendMessage({
       type: "cc-toggle-site", enable: next, origin: site, tabId: activeTab && activeTab.id
        }, function (resp) {
         // Mirror the result immediately; onChanged also refreshes renderSite.
        enabledSites = (resp && resp.enabled)
          ? (enabledSites.indexOf(site) === -1
             ? enabledSites.concat(site) : enabledSites)
          : enabledSites.filter(function (s) { return s !== site; });
        renderSite();
          });
       }

  function init() {
     if (_inited) return;                // P0-3: wire exactly once (idempotent)
     _inited = true;
     if (!S) return;
     S.load(function () {
       render();
       var sw = $id("cc-master");
       if (sw && sw.focus) sw.focus();       // focus on open (A6)
            });

     // Per-site opt-in: discover the active tab + the persisted enabled list.
     loadEnabledSites();
     queryActiveTab();

      // P1-1: re-render on a cross-surface change (a rule saved from the options
      // page must refresh an already-open popup, F-6). Mirror storage.js's dirty
      // guard so a local unsaved edit is never clobbered by the incoming snapshot.
     var c = (typeof window !== "undefined" && window.chrome)
              || (typeof globalThis !== "undefined" && globalThis.chrome)
             || (typeof global !== "undefined" ? global.chrome : undefined);
    if (c && c.storage && c.storage.onChanged) {
      c.storage.onChanged.addListener(function (changes, area) {
        if (area !== "sync") return;
        if (changes.contentCensorData || changes.enabled) {
          if (!S.state.dirty) S.load(function () { render(); });
          }
        if (changes.contentCensorSites) loadEnabledSites();
         });
          }

       var sw = $id("cc-master");
       if (sw) sw.addEventListener("click", function () {
         var now = sw.getAttribute("aria-checked") !== "true";
         sw.setAttribute("aria-checked", String(now));
         reflectLabel(now);
         S.setEnabled(now);
         S.save();
               });

     var siteToggle = $id("cc-enable-site");
     if (siteToggle) siteToggle.addEventListener("click", toggleSite);

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

          // Load-time entry (P0-3): invoke init() when the DOM is ready so the
          // shipped popup page renders on its own — no test-harness call needed.
          if (typeof document !== "undefined") {
          if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", init, { once: true });
          } else {
          init();
          }
          }

           // Expose for tests.
        if (typeof module !== "undefined" && module.exports) module.exports = {
          render: render,
          init: init,
          previewRows: previewRows,
          formatUpdated: formatUpdated,
          renderSite: renderSite,
          siteFor: siteFor,
          toggleSite: toggleSite,
          loadEnabledSites: loadEnabledSites,
          queryActiveTab: queryActiveTab
            };
        }
        )();
