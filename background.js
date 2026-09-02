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
     enabled: true,
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

   // --- Top-level, SYNCHRONOUS listener registration (MV3 §3.1). -----------
   // Do NOT move these into a callback / async / init(). The worker is torn
  // down moments after it wakes; a later async registration would be missed.
 chrome.runtime.onInstalled.addListener(seedDefaults);
 chrome.runtime.onStartup.addListener(seedDefaults);

   // Export for node tests (a mocked chrome is injected as global.chrome). The
  // browser service worker ignores module.exports.
 if (typeof module !== "undefined" && module.exports) {
   module.exports = { seedDefaults: seedDefaults, SEED_RULES: SEED_RULES };
   }
