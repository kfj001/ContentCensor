#!/usr/bin/env python3
import re, os, subprocess, glob

BASE = os.path.dirname(os.path.abspath(__file__))
print("=== re-check F-1 structure after header fix ===")
for f in ["F1-popup-mockup.html", "F2-options-mockup.html", "F3-inpage-notice-mockup.html"]:
    s = open(os.path.join(BASE, f), encoding="utf-8").read()
    print(f"   {f}: single<h1>={s.count('<h1')==1 and s.count('</h1>')==1}; "
          f"<header>={s.count('<header')}/{s.count('</header>')}; <body>={s.count('<body')}/{s.count('</body>')}")

print("\n=== §4.5 forbidden-pattern CI gates (run against the ACTUAL source, not the design/) ===")
SRC = "/Users/kyle/Documents/ContentCensor/.worktrees/t_d1b929c6"
src_files = glob.glob(os.path.join(SRC, "*.js")) + glob.glob(os.path.join(SRC, "*.htm"))

def grep(pattern, files, regex=True):
    out = []
    for fl in files:
        try:
            txt = open(fl, encoding="utf-8", errors="replace").read()
        except Exception:
            continue
        if regex:
            for i, line in enumerate(txt.splitlines(), 1):
                if re.search(pattern, line):
                    out.append(f"{os.path.basename(fl)}:{i}: {line.strip()[:80]}")
        else:
            if pattern in txt:
                out.append(f"{os.path.basename(fl)}: contains {pattern!r}")
    return out

# NOTE: the current source still references jquery by design (that's the P0 we document as fixed at M0).
# The gates below are what the DESIGN requires the FINAL code to satisfy. We report current vs. target.
files = src_files
print("\n[Gate 1] No jQuery (grep -E '\\$\\(|jquery') — expects CLEAN after M0/de-jQuery:")
g = grep(r"\$\(|jquery", files)
print("   current:" + (" CLEAN" if not g else ""))
for x in g: print("    " + x)

print("\n[Gate 2] No sync.clear in the save path — expects CLEAN:")
g = grep(r"sync\.clear", files)
print("   current:" + (" CLEAN" if not g else ""))
for x in g: print("    " + x)

print("\n[Gate 3] No parallel arrays (toReplace[ | replaceWith[ | Boxes[index]) — expects CLEAN:")
g = grep(r"toReplace\[|replaceWith\[|Boxes\[index\]", files)
print("   current:" + (" CLEAN" if not g else ""))
for x in g: print("    " + x)

print("\n[Gate 4] No inline handlers (on(click|input|change)=) in .htm — expects CLEAN:")
g = grep(r"on(click|input|change)\s*=", glob.glob(os.path.join(SRC,"*.htm")))
print("   current:" + (" CLEAN" if not g else ""))
for x in g: print("    " + x)

print("\n[Our design/ files — should be CLEAN of the above so they don't trip gates in a shared repo]")
design_files = glob.glob(os.path.join(BASE,"*.js")) + glob.glob(os.path.join(BASE,"*.html"))
for label, pat in [("jQuery", r"\$\(|jquery"), ("sync.clear", r"sync\.clear"),
                   ("parallel arrays", r"toReplace\[|replaceWith\[|Boxes\[index\]")]:
    g = grep(pat, design_files)
    print(f"   design/ {label}: " + ("CLEAN" if not g else "FOUND -> " + "; ".join(x.split(': ')[0] for x in g)))

print("\nDONE")
