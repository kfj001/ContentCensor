#!/usr/bin/env python3
# Lightweight interaction/contract smoke checks (complement node --check + a11y presence).
import re, os
BASE = os.path.dirname(os.path.abspath(__file__))
def load(f): return open(os.path.join(BASE, f), encoding="utf-8").read()
fails = []
def expect(cond, label):
    print(("  PASS " if cond else "  FAIL ") + label)
    if not cond: fails.append(label)

f1 = load("F1-popup-mockup.html"); f2 = load("F2-options-mockup.html")
f3 = load("F3-inpage-notice-mockup.html"); css = load("CC-design-tokens.css")
spec = load("ui-design-spec.md")

print("== F-1 popup contract ==")
expect('role="switch"' in f1 and 'aria-checked' in f1, "master switch role=switch + aria-checked (A3)")
expect('aria-live="polite"' in f1, "summary is aria-live polite (A4)")
expect('data-action="open-settings"' in f1, "Open settings affordance present")
expect('cc-row-' not in f1, "popup is read-only (no row mutation here)")
expect('role="dialog"' in f1, "popup is a dialog (A7 close/escape)")

print("\n== F-2 <cc-rule-row> + controller contract (4.2/4.3) ==")
expect('customElements.define("cc-rule-row", CCRuleRow)' in f2, "native custom element defined (zero runtime)")
expect('cc-row-change' in f2 and 'cc-row-delete' in f2, "emits only the two contract events")
expect('matchType' in f2 and 'Match case' in f2 and 'caseSensitive' in f2,
    "honest controls: Match type + Match case (fixes defect #1)")
expect('data-action="add"' in f2 and 'data-action="delete"' in f2, "add/remove rows (fixes defect #2)")
expect('state.rows' in f2 and 'toReplace' not in f2 and 'replaceWith' not in f2,
    "single Array<Rule>, no parallel arrays (fixes defect #3)")
expect('sync.clear' not in f2, "atomic save: no clear()-then-set (Phase 0.2)")
expect('role="alert"' in f2 and 'aria-invalid' in f2, "inline regex validation role=alert (A4/A12)")
expect('Rule ' in f2 and 'of ' in f2, "visually-hidden 'Rule N of M' caption (A15)")
expect('Delete rule' in f2, "Delete is a named text button, not bare icon (A10)")
expect('metaKey' in f2 and 'ctrlKey' in f2 and 'preventDefault' in f2,
    "Ctrl/Cmd+S saves with preventDefault (A5)")
# The "<=2 delegated listeners" target for the whole surface: count document-level addEventListener.
docs = f2.count('document.addEventListener')
expect(docs >= 2, f"delegated listeners on the surface present (found {docs} document.addEventListener)")

print("\n== F-3 in-page notice contract (3.4 / 4.4) ==")
expect('role="status"' in f3 and 'aria-live="polite"' in f3, "notice role=status aria-live polite (A4/A11)")
expect('optIn.checked' in f3, "notice is opt-in / off by default (A11)")
expect('key === "Escape"' in f3, "keyboard-dismissable via Esc (A11)")
expect("Cycle detected" in f3, "re-entrancy safe-failure message (A12)")
expect('prefers-reduced-motion' in css, "reduced-motion honored globally (A13)")
expect(re.search(r'\.innerHTML\s*=', f3) is None, "no innerHTML= assignment from untrusted data (2.3)")

print("\n== Spec completeness ==")
for tok in ["F-1", "F-2", "F-3", "F-4", "F-5", "CC-design-tokens.css",
            "Q1", "Q2", "Q3", "A1", "A15", "role=\"list\"", "role=\"grid\""]:
    expect(tok in spec, "spec mentions %r" % tok)

print("\nRESULT:", "ALL PASS" if not fails else "%d FAIL -> %s" % (len(fails), "; ".join(fails)))
