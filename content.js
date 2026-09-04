/*
* content.js — in-page text replacement (F-2 / F-3; UI §3.3 / §3.4 / §4.4).
*
 * No longer declared in manifest.content_scripts. It is injected OPT-IN into a
 * tab by background.js (chrome.scripting.executeScript of lib/rules.js then
 * content.js) after the user enables the site from the popup. lib/rules.js first
 * sets the pure helpers as globalThis.CCRules, which this file consumes — the
 * single source of truth shared verbatim with the options/popup surfaces. It is
 * dependency-free and CSP-safe on an arbitrary host page (UI §2.3): no jQuery, no
 * import, no CDN, and no innerHTML from untrusted data — every injected node is
 * createElement + textContent.
 *
 * Site gate: the script only replaces text when its own origin is in
 * contentCensorSites (the user's opt-in list). Disabled => inert. A re-injection
 * into an already-live tab is a no-op for observers (idempotency guard) so the
 * same document never gets stacked observers.
*
* Behaviours:
*   - one Array transform via CCRules.toPatterns (no jQuery — kills C13/C14);
*   - a MutationObserver + recursive text-node walk applies it;
*   - a re-entrancy guard stops a self-matching rule pair (A→B, B→A) wedging a
*     tab: a detected cycle becomes a one-time "Cycle detected — stopped" toast
*     instead of a hang (M1 / MV3 Phase 0.3 / A12);
 *  - an opt-in, reduced-motion-aware, keyboard-dismissable role="status" toast
 *  (F-3 / A11 / A13) that counts replacements from `patterns` (never a
 *  parallel array), off by default until the user opts in via contentCensorProfile.
 *  - the only gate is per-site opt-in (contentCensorSites); a site that is
 *  disabled goes inert live. There is no global on/off flag.
 */
"use strict";

 (function () {
    // Idempotency guard: a re-injection into an ALREADY-live tab (the background
    // service worker's tabs.onUpdated can fire executeScript again for the same
    // document) must not stack a second observer or double-replace. lib/rules.js
    // is re-injected before each content.js, so the marker lives on the window and
    // survives across the rules.js/content.js pair.
    if (typeof window !== "undefined" && window.__ccInstalled) return;
    if (typeof window !== "undefined") window.__ccInstalled = true;

     var CCRules = (typeof window !== "undefined" && window.CCRules)
        ? window.CCRules
         : { toPatterns: function (d) { return d || []; } };

     // ---- module state --------------------------------------------------------
   var patterns = [];             // [{re, replacement}]
   var applying = false;          // re-entrancy latch (A12)
   var cycleDetected = false;
   var cycleToastShown = false;
   var toastEnabled = false;      // opt-in (F-3 / A11); off by default
   var reducedMotion = false;
    var observer = null;
     var selfMatch = null;            // this tab's exact-host match, or null.

        // Resolve this tab's site once, up front, so applyData's gate sees it.
     selfMatch = selfSite();

     /** This tab's exact-host match pattern ("https://host/*"), or null for a
      * non-http(s) origin the script can't act on. Mirrors background.js. */
   function selfSite() {
    if (typeof window === "undefined" || !window.location) return null;
     var u;
    try { u = new URL(window.location.href); } catch (_e) { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin + "/*";
   }

   /**
    * Rewrite one text node at most once per observer cycle. Apply every pattern,
    * then test the RESULT: if some pattern still matches the output, the system is
    * in an A→B / B→A oscillation and would rewrite this node forever. We record
    * that and the observer stops (the "cycle detected — stopped" safe failure,
    * A12) instead of wedging the tab.
    */
  function replaceIn(node) {
    if (!node || node.nodeType !== 3) return;
    var text = node.nodeValue;
    for (var i = 0; i < patterns.length; i++) {
       var p = patterns[i];
      p.re.lastIndex = 0;
      if (p.re.test(text)) {
       text = text.replace(p.re, p.replacement);
        }
        }
    if (text !== node.nodeValue) {
        node.nodeValue = text;
        // Did rewriting produce text a pattern still matches? If so, oscillate.
        for (var j = 0; j < patterns.length; j++) {
        var q = patterns[j];
        q.re.lastIndex = 0;
        if (q.re.test(text)) { cycleDetected = true; break; }
          }
        }
   }

   /** Recursively apply to the subtree under `root` (text nodes only — A14). */
  function walk(root) {
    var nodes = Array.prototype.slice.call(root.childNodes);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) replaceIn(n);
      else if (n.nodeType === 1) walk(n);
    }
   }

  function flushCycle() {
    if (cycleDetected && !cycleToastShown) {
      cycleToastShown = true;
      cycleDetected = false;
      addToast("Cycle detected — stopped");
      stopObserver();    // A12: stop the observer so it doesn't keep rewriting.
     }
    }

  function ensureObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.addedNodes && m.addedNodes.length) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1) walk(n);
            else if (n.nodeType === 3) replaceIn(n);
          }
        }
        if (m.type === "characterData") replaceIn(m.target);
      }
      flushCycle();
     });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
   }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
   }

   /**
    * Opt-in role="status" toast (F-3 / A11 / A13). Built with createElement /
    * textContent only (no innerHTML from untrusted data — UI §4.2 gate).
    * Reduced-motion aware (A13); keyboard-dismissable via Escape (A11).
    */
  function addToast(message) {
    if (!toastEnabled || !document.body) return;
    var existing = document.getElementById("cc-toast");
    if (existing) existing.remove();
    var el = document.createElement("div");
    el.id = "cc-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("tabindex", "0");
    el.textContent = message;
    el.style.position = "fixed";
    el.style.right = "12px";
    el.style.bottom = "12px";
    el.style.zIndex = "2147483647";
    el.style.padding = "8px 12px";
    el.style.background = "#333";
    el.style.color = "#fff";
    el.style.fontFamily = "system-ui, sans-serif";
    el.style.fontSize = "12px";
    el.style.borderRadius = "6px";
    el.style.transition = reducedMotion ? "none" : "opacity .18s ease";
    document.body.appendChild(el);
    el.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); el.remove(); }
     }, { once: true });
    setTimeout(function () { try { el.remove(); } catch (_e) { /* already gone */ } }, 4200);
   }

     /**
      * Build the pattern list + (re)start the observer from a storage snapshot.
      * Gates on per-site opt-in (contentCensorSites); inert when not opted in.
      */
   function applyData(items) {
      items = items || {};
      var data = items.contentCensorData;
      // Site gate: only replace when this tab's origin is in the user's opt-in
     // list. When `selfMatch` is null (node/jsdom without chrome, or a
     // direct-call test) the gate is not enforced — the caller owns the data.
     // There is no global on/off flag: the only gate is per-site opt-in.
      var sites = items.contentCensorSites;
      if (selfMatch && (!sites || sites.indexOf(selfMatch) === -1)) {
       patterns = [];
       stopObserver();
       cycleDetected = false;
       applying = false;
       return;
        }
      patterns = CCRules.toPatterns(data);
     stopObserver();
     cycleDetected = false;
     applying = false;
     ensureObserver();
        // P1-2: the observer only CATCHES future mutations. Replace any text that
       // was already present at injection time (static content, SPA hydration,
       // cached pages) with a one-time walk over the current snapshot. `patterns`
       // is [] when the site is not opted in, so the walk is a no-op there; the
       // text-node-only walk (A14) keeps host semantics intact.
      if (document.body) walk(document.body);
      }

  function loadAndRun() {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.sync) return;
     chrome.storage.sync.get(["contentCensorData", "contentCensorProfile", "contentCensorSites"],
        function (items) {
        items = items || {};
        toastEnabled = !!(items.contentCensorProfile && items.contentCensorProfile.toast);
         if (window.matchMedia) {
        try { reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
        catch (_e) { reducedMotion = false; }
         }
         applyData(items);
         });
      }

    // React to edits from options/popup without a full page reload (F-6).
    // `chrome` here is the global — NOT a module-scope var (a `var chrome`
    // declaration shadows the global and self-references the hoisted-undefined
    // value, so loadAndRun never reads chrome.storage).
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "sync") return;
       if (changes.contentCensorData || changes.contentCensorProfile
              || changes.contentCensorSites) {
          chrome.storage.sync.get(["contentCensorData", "contentCensorProfile", "contentCensorSites"],
            function (items) {
            items = items || {};
            toastEnabled = !!(items.contentCensorProfile && items.contentCensorProfile.toast);
            applyData(items);
             });
          }
           });
        }

   // Initial pass: run now if body exists, else on DOMContentLoaded.
  if (typeof document !== "undefined") {
    if (document.body) loadAndRun();
    else document.addEventListener("DOMContentLoaded", loadAndRun, { once: true });

     // Tiny debug/test hook (not a public API) so the node jsdom integration
     // test can drive applyData / inspect patterns directly.
    try {
      window.__ccContent = {
        applyData: applyData,
        ensureObserver: ensureObserver,
        get patterns() { return patterns; },
        setToastEnabled: function (v) { toastEnabled = !!v; },
        isCycleDetected: function () { return cycleDetected || cycleToastShown; }
        };
      } catch (_e) { /* globalThis may be frozen in some harnesses */ }
   }
})();
