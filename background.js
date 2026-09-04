/*
* background.js — Manifest V3 service worker (M2 rename of eventPages.js; M4 flip).
*
* In MV3 the background is an EPHEMERAL service worker, so:
*      - chrome.runtime.onInstalled / onStartup listeners are registered
*       SYNCHRONOUSLY at the top level (MV3 §3.1). An async registration would let
*       the worker tear down before the listener attaches and the seed would no-op.
*      - There are ZERO persistent globals (MV3 §3.2): the ruleset is touched only
*       through chrome.storage.sync. No long-lived state survives a wake.
*      - There is NO artificial keep-alive (MV3 §3.3): no alarms ping loop. Every
*       call below is a chrome.* API that resets the idle timer naturally.
*
* Seeding (UI §3.6 F-5 / MV3 §3.6): on install/startup, if the store is empty we
* seed a small set of example rules and flag them as *suggestions* via
* installedAt + seededExamples so the popup can read "N example rules loaded —
* edit or delete them in Settings".
*/
"use strict";

  // The six example rules (UI §1 F-5). Stored in the v3 shape directly so the
  // options surface and content script consume them unchanged.
const SEED_RULES = [
    { find: "republican", replace: "pervert", matchType: "text", caseSensitive: false, enabled: true },
    { find: "tea party", replace: "pervert", matchType: "text", caseSensitive: false, enabled: true },
    { find: "iPhone", replace: "Abortion", matchType: "regex", caseSensitive: false, enabled: true },
    { find: "Republican", replace: "Pervert", matchType: "text", caseSensitive: false, enabled: true },
    { find: "Tea Party", replace: "Rape Philosophy Party", matchType: "text", caseSensitive: false, enabled: true },
    { find: "GOP", replace: "CUNT", matchType: "text", caseSensitive: false, enabled: true }
   ];

  /**
   * Seed defaults if (and only if) the store is empty. Idempotent: a populated
  * store is left untouched, so a wake/terminate/re-wake cycle never re-seeds
   * over the user's data (MV3 §3.2 M2 DoD).
   */
 function seedDefaults() {
  chrome.storage.sync.get(["contentCensorData"], function (items) {
   var raw = items && items.contentCensorData;
   var hasData = raw && (Array.isArray(raw) ? raw.length : true);
   if (hasData) {
     console.log("[content-censor] store already populated; keeping user data");
     return;
    }
    chrome.storage.sync.set({
      contentCensorData: SEED_RULES,
      installedAt: Date.now(),
      seededExamples: SEED_RULES.length
      }, function () {
     if (chrome.runtime.lastError) {
       console.warn("[content-censor] seed failed:", chrome.runtime.lastError.message);
      } else {
       console.log("[content-censor] seeded", SEED_RULES.length, "example rules");
      }
    });
  });
   }

// ---- Opt-in per-site injection ----------------------------------------------
    // The extension holds NO host permission at install and declares NO
    // content_scripts, so nothing injects on its own. A user grants a site from
    // the popup ("Enable on this site"); we then (1) record the origin match in
    // contentCensorSites, (2) chrome.permissions.request that single origin, and
    // (3) executeScript lib/rules.js + content.js into the tab. content.js
    // self-gates on contentCensorSites, so a site that is later disabled goes
    // inert live.
    //
    // NOTE: permissions.request needs a host pool to succeed. The manifest
    // declares optional_host_permissions: ["*://*/*"] — a *declaration*, not a
    // grant. Chrome still prompts per-origin and grants only the exact host;
    // without the pool the request returns false and nothing is injected.
  var INJECT_FILES = ["lib/rules.js", "content.js"];

    /** Exact-host match pattern for a URL, or null for non-http(s) origins the
     * content script can't (and shouldn't) reach (about:, chrome:, file:). */
  function siteFor(url) {
    if (!url) return null;
    var u;
    try { u = new URL(url); } catch (_e) { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin + "/*";
  }

    /** Inject the rules into one tab (order matters: rules sets CCRules first). */
  function inject(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: INJECT_FILES
      });
  }

    // --- Top-level, SYNCHRONOUS listener registration (MV3 §3.1). -----------
    // Do NOT move these into a callback / async / init(). The worker is torn
    // down moments after it wakes; a later async registration would be missed.
  chrome.runtime.onInstalled.addListener(seedDefaults);
  chrome.runtime.onStartup.addListener(seedDefaults);

      // Popup -> background: enable/disable a site for the active tab. Async reply,
      // so return true to keep the message channel open until sendResponse runs.
   chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
     if (!msg || msg.type === "cc-reload") {
        var t = msg.tabId != null ? msg.tabId
              : (sender && sender.tab && sender.tab.id);
        if (t != null) chrome.tabs.reload(t);
        sendResponse({ ok: true });
        return;
     }
     if (!msg || msg.type !== "cc-toggle-site" || !msg.origin) return;
    var enable = msg.enable === true;
    var origin = msg.origin;
    var tabId = msg.tabId != null ? msg.tabId : (sender && sender.tab && sender.tab.id);
     chrome.storage.sync.get("contentCensorSites", function (items) {
      var sites = (items && items.contentCensorSites) || [];
      var at = sites.indexOf(origin);
      if (enable) {
        chrome.permissions.request({ origins: [origin] }, function (granted) {
          chrome.runtime.lastError;     // read to clear any stale error
          // Only record + inject when the host grant is actually given.
          // content.js self-gates on contentCensorSites, so a record we skip
          // (denied) keeps the site inert.
          if (!granted) {
            sendResponse({ enabled: false, granted: false, tabId: tabId });
            return;
              }
          if (at === -1) sites.push(origin);
          chrome.storage.sync.set({ contentCensorSites: sites }, function () {
            chrome.runtime.lastError;
            var done = function () {
              sendResponse({ enabled: true, granted: true, tabId: tabId });
                };
             // Apply live to the active tab (no reload).
            if (tabId != null) {
              inject(tabId).then(done, done);
                } else {
              done();
                }
             });
          });
       return true;
        } else {
        if (at !== -1) sites.splice(at, 1);
        chrome.storage.sync.set({ contentCensorSites: sites }, function () {
          chrome.runtime.lastError;
          chrome.permissions.remove({ origins: [origin] }, function () {
            chrome.runtime.lastError;
            sendResponse({ enabled: false, tabId: tabId });
            });
           });
        return true;
        }
     });
   return true;     // async sendResponse inside the storage callbacks
    });

    // Auto-reinjection on navigation: when a tab finishes loading and its origin
    // is in contentCensorSites, re-run the content script for the new document.
  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (!changeInfo || changeInfo.status !== "complete") return;
    var url = (tab && tab.url) || changeInfo.url;
    var site = siteFor(url);
    if (!site) return;
    chrome.storage.sync.get("contentCensorSites", function (items) {
      var sites = (items && items.contentCensorSites) || [];
      if (sites.indexOf(site) !== -1) {
        inject(tabId).catch(function () { /* tab gone / closed */ });
        }
     });
  });

     // Export for node tests (a mocked chrome is injected as global.chrome). The
    // browser service worker ignores module.exports.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      seedDefaults: seedDefaults,
      SEED_RULES: SEED_RULES,
      siteFor: siteFor,
      inject: inject,
      INJECT_FILES: INJECT_FILES
      };
     }
