/*
* popup.js — lightweight status & control panel (F-1 / F-5; UI §3.1 / §3.2).
*
 * Loads after storage.js (window.CCStorage). Pattern: status-at-a-glance +
 * progressive disclosure:
 *        - a per-site "Enable on this site" switch (role="switch" aria-checked),
 *          which reveals a "Reload page" button when the site is toggled off so
 *        the user can refresh a page whose replacements they just disabled,
 *        - a summary line "N terms active · last updated Xh ago" (aria-live polite),
 *        - a primary "Open settings" button -> chrome.runtime.openOptionsPage(),
  *        - a two-line "Active / Defined" terms block (active = enabled, defined =
  *          all non-blank rules) so the user sees how many are live vs. saved, plus
*       - on first install (F-5) the summary reads "N example rules loaded —
*       edit or delete them in Settings" so the seeded defaults read as
 *       *suggestions*, not the user's own rules.
 *
 * Escape closes the popup (a small fixed-width dialog with no unsaved edits, A7).
 * No jQuery; no per-element binding.
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

   function countTerms() {
     var rows = S.state.rows;
     var active = 0;
     var defined = 0;
     for (var i = 0; i < rows.length; i++) {
       var r = rows[i];
       if (!r.find) continue;                 // a blank-find row is no-op, not defined
       defined++;
       if (r.enabled !== false) active++;
        }
     return { active: active, defined: defined };
       }

  function render() {
     var counts = countTerms();
     var n = counts.active;

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

      // Two-line status block: how many replacements are ACTIVE (enabled) vs. DEFINED
      // (every non-blank rule, disabled or not). Disabled rows now persist, so the
      // gap between the two numbers is the user's "saved but switched off" set.
     var block = $id("cc-terms");
     if (block) {
       var activeLine = block.querySelector(".cc-terms-active");
       var activeCount = block.querySelector(".cc-terms-active .cc-terms-count");
       var definedCount = block.querySelector(".cc-terms-defined .cc-terms-count");
       if (activeCount) activeCount.textContent = String(counts.active);
       if (definedCount) definedCount.textContent = String(counts.defined);
       if (activeLine) {
         if (counts.active !== counts.defined) {
            activeLine.setAttribute("title",
                counts.defined - counts.active + " defined term(s) saved but switched off");
             } else {
            activeLine.removeAttribute("title");
            }
       }
       var heading = block.querySelector(".cc-terms-title");
       if (heading) {
         heading.textContent = counts.defined === 0 ? "Replacements"
                 : (counts.defined + " "
                    + (counts.defined === 1 ? "replacement" : "replacements"));
        }
      // Empty state: no rule is defined at all — hide the two count lines and
        // show only the empty card.
       var empty = block.querySelector(".cc-empty");
       var hasRows = counts.defined !== 0;
       if (empty) empty.hidden = hasRows;
       var lines = block.querySelectorAll(".cc-terms-line");
       for (var li = 0; li < lines.length; li++) lines[li].hidden = !hasRows;
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
      var reload = $id("cc-reload");
      var sw = $id("cc-enable-site");
      if (!row) return;                         // element not in this build (e.g. tests)
      var site = siteFor(activeTab ? activeTab.url : null);
      var isOn = !!site && enabledSites.indexOf(site) !== -1;
      if (!site) {
        row.hidden = true;
        note.hidden = true;
        unsupported.hidden = false;
        if (reload) reload.hidden = true;
        return;
           }
      unsupported.hidden = true;
      row.hidden = false;
      note.hidden = isOn;
        // When the site is off, its effect is inert in the live tab; offer a
        // reload so the already-applied replacements clear on refresh.
      if (reload) reload.hidden = isOn;
      if (sw) {
       sw.setAttribute("aria-checked", String(isOn));
       var txt = $id("cc-enable-site-text");
       if (txt) txt.textContent = isOn
          ? "Enabled on this site"
          : "Enable on this site";
          }
        }

        // Reload the active tab so a just-disabled site shows clean (un-replaced)
        // page content. Routed through the background, which keeps the popup's
        // chrome.tabs surface free.
    function reloadSite() {
      var c = getChrome();
      if (!c || !c.runtime || !c.runtime.sendMessage) return;
      var tabId = activeTab && activeTab.id;
      c.runtime.sendMessage({
        type: "cc-reload", tabId: tabId != null ? tabId : null
           }, function () { if (c.runtime) c.runtime.lastError; });
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
      if (_inited) return;                 // P0-3: wire exactly once (idempotent)
       _inited = true;
      if (!S) return;
      S.load(function () {
        render();
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
        if (changes.contentCensorData) {
          if (!S.state.dirty) S.load(function () { render(); });
            }
        if (changes.contentCensorSites) loadEnabledSites();
         });
          }

      var siteToggle = $id("cc-enable-site");
      if (siteToggle) siteToggle.addEventListener("click", toggleSite);

      var rl = $id("cc-reload");
      if (rl) rl.addEventListener("click", reloadSite);

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
          countTerms: countTerms,
          formatUpdated: formatUpdated,
          renderSite: renderSite,
           siteFor: siteFor,
           toggleSite: toggleSite,
           reloadSite: reloadSite,
           loadEnabledSites: loadEnabledSites,
           queryActiveTab: queryActiveTab
            };
        }
        )();
