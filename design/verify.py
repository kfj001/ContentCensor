#!/usr/bin/env python3
import re, os, subprocess, sys, glob

BASE = os.path.dirname(os.path.abspath(__file__))
os.makedirs("/tmp/ccjs", exist_ok=True)
for old in glob.glob("/tmp/ccjs/*.js"):
    os.remove(old)

print("=== JS syntax check (node --check on each inline <script>) ===")
ok_all = True
for f in ["F1-popup-mockup.html", "F2-options-mockup.html", "F3-inpage-notice-mockup.html"]:
    s = open(os.path.join(BASE, f), encoding="utf-8").read()
    blocks = re.findall(r"<script>(.*?)</script>", s, re.S)
    for i, b in enumerate(blocks):
        path = f"/tmp/ccjs/{f}.{i}.js"
        open(path, "w").write(b)
        r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
        status = "OK" if r.returncode == 0 else "FAIL"
        if r.returncode != 0:
            ok_all = False
        print(f"  {f} block{i}: {status}")
        if r.returncode != 0:
            print("   " + r.stderr.strip())

# well-formedness of HTML structure
print("\n=== structure checks ===")
for f in ["F1-popup-mockup.html", "F2-options-mockup.html", "F3-inpage-notice-mockup.html"]:
    s = open(os.path.join(BASE, f), encoding="utf-8").read()
    checks = {
        "<!DOCTYPE html>": s.lstrip().lower().startswith("<!doctype html>"),
        "balanced <body": s.count("<body") == s.count("</body>") == 1,
        "single <h1>": s.count("<h1") >= 1,
        "has <main": "<main" in s,
        "links tokens.css": "CC-design-tokens.css" in s,
        "no stray <ok/> tag": "<ok/>" not in s,
    }
    print(f"  {f}: " + "; ".join(f"{k}={v}" for k, v in checks.items()))

# a11y token presence
print("\n=== a11y token presence (must all be present) ===")
f3 = open(os.path.join(BASE, "F2-options-mockup.html"), encoding="utf-8").read()
for tok in ['role="switch"', 'role="radiogroup"', 'role="alert"', 'role="list"', 'role="group"',
            'aria-checked', 'aria-invalid', 'Match case', 'matchType', 'cc-rule-row',
            'cc-row-change', 'cc-row-delete', 'sync.clear', 'data-action="add"', 'data-action="save"']:
    print(f"  F2 contains {tok!r}: {tok in f3}")

print("\n=== CSS token presence ===")
css = open(os.path.join(BASE, "CC-design-tokens.css"), encoding="utf-8").read()
for tok in ["--focus-ring", "prefers-reduced-motion", ":focus-visible", "--accent", "--danger"]:
    print(f"  tokens.css contains {tok!r}: {tok in css}")

print("\nALL_JS_OK=" + str(ok_all))
