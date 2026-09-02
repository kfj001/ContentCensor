/*
* cc-rule-row.js — native HTML Custom Element for ONE replacement rule (UI §4.2).
*
* Zero runtime. One <cc-rule-row> renders a self-describing rule group and emits
* exactly two custom events (UI §4.2 contract):
*     cc-row-change  { detail: { rowId, changed: {find|replace|matchType|
*                  caseSensitive|enabled}, value } }    — any edit
*     cc-row-delete  { detail: { rowId } }                — Delete clicked
* Nothing else. No other DOM listeners. No innerHTML from untrusted data — every
* dynamic value is textContent / createElement (UI §4.2 gate; A1 / A10).
*
* A11y per instance (§4.2, non-negotiable):
*      - each text control has id + a matching <label for> (A1);
*      - match-type is a role="radiogroup" aria-label="Match type" with two radios;
*      - Delete is a text button, aria-label "Delete this rule" (A10 — never a
*        bare icon);
*      - inline role="alert" aria-live="assertive" error region; on a regex row
*        with an invalid pattern the row sets aria-invalid="true" and writes the
*        message (A4);
*      - a visually-hidden "Rule N of M" caption (A15);
*      - :focus-visible handled by popup.css (A5).
*
* The row's OWN listeners are the §4.2 inputs; the page controller (options.js)
* adds exactly TWO delegated listeners on the grid that forward these custom
* events into state (UI §4.3).
*/
"use strict";

(function () {
  // In the browser / jsdom the element extends a real HTMLElement. In the node
  // unit context (where HTMLElement is absent) it falls back to a plain function,
  // so `require('./cc-rule-row')` still yields a usable class.
  var Base = (typeof HTMLElement !== "undefined" && HTMLElement)
        ? HTMLElement
        : function () {};

  class CcRuleRow extends Base {
     constructor() {
      super();
      this._index = 0;
      this._total = 0;
      this._invalid = false;
      this._built = false;
      // No DOM mutation in the constructor: a custom element that is not yet
      // connected to a document rejects light-DOM mutation in some hosts
      // (e.g. jsdom). The element builds itself in connectedCallback, when it is
      // a proper, connected DOM node and DOM attribute mutations are well-defined.
       }

    connectedCallback() {
      if (!this.id) this.id = "ccrow-" + Math.random().toString(36).slice(2, 8);
      if (!this._built) {
        this._built = true;
        this._build();          // creates light DOM + wires the §4.2 events
          }
        // Reflect the attributes onto the inputs now that the id + controls exist.
      if (this._inputs) {
        var self = this;
         ["find", "replace", "matchtype", "case-sensitive", "disabled", "index", "total"].forEach(function (a) {
          var v = self.getAttribute(a);
          if (v != null) self.attributeChangedCallback(a, null, v);
            });
         }
       }

    get observedAttributes() {
      return ["find", "replace", "matchtype", "case-sensitive", "disabled", "index", "total"];
      }

    attributeChangedCallback(name, _old, val) {
      if (!this._inputs) return;
      switch (name) {
        case "find": this._inputs.find.value = val || ""; break;
        case "replace": this._inputs.replace.value = val || ""; break;
        case "matchtype": if (this._byName) this._byName[val].checked = true; break;
        case "case-sensitive": this._inputs.case.checked = val === "true"; break;
        case "disabled": this._inputs.toggle.checked = val !== "true"; break;
        case "index": this._index = parseInt(val, 10) || 0; this._caption(); break;
        case "total": this._total = parseInt(val, 10) || 0; this._caption(); break;
          }
      }

    _build() {
      var root = document.createElement("div");
      root.className = "cc-row";
      root.setAttribute("role", "group");
      this._inputs = {};
      var self = this;

        // Per-row enable toggle (leading).
      var toggleWrap = document.createElement("label");
      toggleWrap.className = "cc-toggle";
      var toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.className = "cc-toggle-box";
      var toggleText = document.createElement("span");
      toggleText.textContent = "Enabled";
      toggleWrap.appendChild(toggle);
      toggleWrap.appendChild(toggleText);
      this._inputs.toggle = toggle;

         // Match-type radiogroup (Text / Regex) — replaces the mislabeled C3.
      var rg = document.createElement("div");
      rg.className = "cc-matches";
      rg.setAttribute("role", "radiogroup");
      rg.setAttribute("aria-label", "Match type");
      this._radios = [];
      this._byName = { text: null, regex: null };
      ["text", "regex"].forEach(function (t) {
        var lab = document.createElement("label");
        lab.className = "cc-match";
        var inp = document.createElement("input");
        inp.type = "radio";
        inp.name = "match-" + self.id + "-" + t;
        inp.value = t;
        var txt = document.createElement("span");
        txt.textContent = t === "text" ? "Text" : "Regex";
        lab.appendChild(inp);
        lab.appendChild(txt);
        rg.appendChild(lab);
        self._radios.push(inp);
        self._byName[t] = inp;
          });
      this._matchTextRadio = this._byName.text;
      this._matchRegexRadio = this._byName.regex;

         // Case-sensitive checkbox (default unchecked = case-insensitive / "gi").
      var caseWrap = document.createElement("label");
      caseWrap.className = "cc-case";
      var caseInp = document.createElement("input");
      caseInp.type = "checkbox";
      caseInp.className = "cc-case-box";
      var caseText = document.createElement("span");
      caseText.textContent = "Match case";
      caseWrap.appendChild(caseInp);
      caseWrap.appendChild(caseText);
      this._inputs.case = caseInp;

         // Find / Replace — each with a real <label for> (A1).
      this._findField = this._labeledField("Find", "cc-find");
      this._inputs.find = this._findField.input;
      this._replaceField = this._labeledField("Replace with", "cc-replace");
      this._inputs.replace = this._replaceField.input;

         // Visually-hidden "Rule N of M" caption (A15).
      this._cap = document.createElement("span");
      this._cap.className = "cc-visually-hidden";

         // Delete: real text + aria-label, never a bare icon (A10).
      this._del = document.createElement("button");
      this._del.type = "button";
      this._del.className = "cc-delete";
      this._del.setAttribute("data-action", "delete");
      this._del.setAttribute("aria-label", "Delete this rule");
      this._del.textContent = "Delete";

         // Inline validation error region (A4).
      this._err = document.createElement("div");
      this._err.className = "cc-err";
      this._err.setAttribute("role", "alert");
      this._err.setAttribute("aria-live", "assertive");
      this._err.hidden = true;

      root.appendChild(toggleWrap);
      root.appendChild(rg);
      root.appendChild(caseWrap);
      root.appendChild(this._findField.wrap);
      root.appendChild(this._replaceField.wrap);
      root.appendChild(this._cap);
      root.appendChild(this._err);
      root.appendChild(this._del);
      this.appendChild(root);    // light DOM under the custom element
      this._attach();
      }

    _labeledField(labelText, cls) {
      var wrap = document.createElement("label");
      wrap.className = "cc-field";
      var id = "cc-" + cls + "-" + this.id;
      var lbl = document.createElement("span");
      lbl.className = "cc-field-lbl";
      lbl.id = id + "-lbl";
      lbl.textContent = labelText;
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = cls;
      inp.id = id;
      inp.setAttribute("aria-label", labelText);
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      return { wrap: wrap, input: inp, label: lbl };
      }

       // Event wiring: emit exactly the two §4.2 events.
    _attach() {
      var self = this;
      this._inputs.toggle.addEventListener("change", function () {
        fire(self, "cc-row-change", {
          rowId: self.id,
          changed: { enabled: self._inputs.toggle.checked },
          value: self._inputs.toggle.checked
         });
         });
      this._radios.forEach(function (r) {
        r.addEventListener("change", function () {
          fire(self, "cc-row-change", {
            rowId: self.id,
            changed: { matchType: r.value },
            value: r.value
             });
            });
          });
      this._inputs.case.addEventListener("change", function () {
        fire(self, "cc-row-change", {
          rowId: self.id,
          changed: { caseSensitive: self._inputs.case.checked },
          value: self._inputs.case.checked
           });
            });
      ["find", "replace"].forEach(function (key) {
        self._inputs[key].addEventListener("input", function () {
          var detail = { rowId: self.id, value: self._inputs[key].value };
          var changed = {}; changed[key] = self._inputs[key].value;
          detail.changed = changed;
          fire(self, "cc-row-change", detail);
            });
              });
      this._del.addEventListener("click", function () {
        fire(self, "cc-row-delete", { rowId: self.id });
          });
          }

   get values() {
    return {
      find: this._inputs ? this._inputs.find.value : "",
      replace: this._inputs ? this._inputs.replace.value : "",
      matchType: this._matchRegexRadio && this._matchRegexRadio.checked ? "regex" : "text",
      caseSensitive: this._inputs ? this._inputs.case.checked : false,
      enabled: this._inputs ? this._inputs.toggle.checked : true
     };
    }

  set values(v) {
    if (!v || !this._inputs) return;
    this._inputs.toggle.checked = v.enabled !== false;
    this._matchTextRadio.checked = (v.matchType || "text") === "text";
    this._matchRegexRadio.checked = v.matchType === "regex";
    this._inputs.case.checked = v.caseSensitive === true;
    this._inputs.find.value = v.find != null ? v.find : "";
    this._inputs.replace.value = v.replace != null ? v.replace : "";
    this._validate();
    }

  get valid() { return !this._invalid; }
  get rowId() { return this.id; }

  _caption() {
    this._cap.textContent = "Rule " + (this._index + 1) + " of " + this._total;
    this.setAttribute("aria-label", this._cap.textContent);
    }

  _showErr(msg) {
    this._invalid = !!msg;
    this._err.textContent = msg || "";
    this._err.hidden = !msg;
    if (this._inputs) {
      this._inputs.find.setAttribute("aria-invalid", this._invalid ? "true" : "false");
      this._inputs.find.setAttribute("class", this._invalid ? "cc-find cc-invalid" : "cc-find");
       }
    }

     // Validate only regex rows; surface inline role="alert" + aria-invalid (A4).
  _validate() {
    var mt = this._matchRegexRadio && this._matchRegexRadio.checked ? "regex" : "text";
    var find = this._inputs ? this._inputs.find.value : "";
    if (mt === "regex" && find) {
      try {
        new RegExp(find, this._inputs.case.checked ? "g" : "gi");
        this._showErr("");
        } catch (e) {
         this._showErr("Invalid pattern: " + e.message);
         }
      } else {
      this._showErr("");
       }
    return !this._invalid;
    }

  focusInvalid() {
    if (this._invalid && this._inputs) this._inputs.find.focus();
    }
    }

 function fire(target, type, detail) {
  target.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail: detail }));
  }

    // Register as a custom element when the host supports it (browser / jsdom).
    // Skip if the host can't construct it (node unit context falls back to Base).
  if (typeof customElements !== "undefined" && customElements.get) {
    try {
      if (!customElements.get("cc-rule-row")) customElements.define("cc-rule-row", CcRuleRow);
      } catch (_e) { /* not a real HTMLElement host */ }
      }

      // Expose the class for the DOM tests + the page controller (options.js).
    if (typeof window !== "undefined") window.CcRuleRow = CcRuleRow;
    if (typeof module !== "undefined" && module.exports) module.exports = { CcRuleRow: CcRuleRow };
})();
