# Display face for the overlay heading

**Shipping: Wremena Regular.** Roman Gornitsky / The Temporary State, 2017.
Free for commercial use; catalogued as such by <https://uncut.wtf/serif/wremena/>.
A serif against a grid of sans data, which is the contrast that makes the heading
read as a name rather than as another label.

Served as `.woff` (41KB) rather than `.otf` (62KB). A `.woff2` would save ~10KB
more but the conversion needs `brotli`, which is not installed here.

`fsType` in the file is **4** (Preview & Print), not 0. That flag governs
embedding a font INSIDE A DOCUMENT — a PDF — and is not the licence; the
published terms are. Noted because a linting tool may one day flag it.

Figures are **old-style** by default. Right for a name, wrong beside the lining
tabular numerals in the tables. The heading carries no digits today; if one is
added, `font-feature-settings: "lnum" 1, "tnum" 1` fixes it — both features are
present, along with `kern` and `case`.

---

## THE CHECK ANY CANDIDATE MUST PASS FIRST

Run the contour hash BEFORE wiring anything. A trial font can carry every
codepoint, correct glyph names and plausible advance widths while drawing a
watermark — see below, where exactly that happened.

    python -c "
    from fontTools.ttLib import TTFont
    from fontTools.pens.recordingPen import RecordingPen
    import hashlib, collections
    f = TTFont(PATH); gs = f.getGlyphSet()
    cmap = {}
    for t in f['cmap'].tables: cmap.update(t.cmap)
    def sig(g):
        p = RecordingPen(); gs[g].draw(p)
        return hashlib.sha1(repr(p.value).encode()).hexdigest()[:12]
    by = collections.defaultdict(list)
    for ch in \"0123456789.-'\\\" ABCabc,:;!?()&/\":
        g = cmap.get(ord(ch))
        if g: by[sig(g)].append(ch)
    print({k: ''.join(v) for k, v in by.items() if len(v) > 1})"

Empty output is a pass. Wremena passes. Then render a specimen with the awkward
names — hyphens, quotes, a long name — before believing it.

---

## Kalenor OX — evaluated 2026-09-04, NOT shipped

Requested, downloaded, wired, then backed out. Two independent blockers.

### 1. The trial watermarks twelve characters

`fontTools` says the codepoints are all present and the glyph names are correct
(`zero`, `hyphen`), with plausible advance widths — so a cmap check passes. It is
the OUTLINES that are substituted. Hashing the contours:

    0 1 2 3 5 6 7 8 9 - " :     one identical outline, the "pdt" watermark
    4 , . ' A-Z a-z             genuine

Only `4` survives of the digits, and the **hyphen does not**. Measured against
the export: **33 of 5,686 batter names** contain a watermarked character, 29 of
them hyphenated surnames — *Ashton Graff-Rowe*, *Ben Zeigler-Namoa*,
*Casey Leavitt-McGee* — which would render as `Graff` + `pdt` + `Rowe`.

Reproduce:

    python -c "
    from fontTools.ttLib import TTFont
    from fontTools.pens.recordingPen import RecordingPen
    import hashlib, collections
    f = TTFont(PATH); gs = f.getGlyphSet()
    cmap = {}
    for t in f['cmap'].tables: cmap.update(t.cmap)
    def sig(g):
        p = RecordingPen(); gs[g].draw(p)
        return hashlib.sha1(repr(p.value).encode()).hexdigest()[:12]
    by = collections.defaultdict(list)
    for ch in '0123456789.-\\'\\\" ABCabc,:':
        g = cmap.get(ord(ch))
        if g: by[sig(g)].append(ch)
    print({k: ''.join(v) for k, v in by.items() if len(v) > 1})"

### 2. The licence is non-commercial

`KalenorOX-LICENCE.txt` is the publisher's text verbatim: "THIS FONT IS DEMO
ONLY", "ONLY FOR PERSONAL USE", "NO COMMERCIAL USE ALLOWED", with a $5,000
corporate-licence clause. Whether a university athletics tool counts is a call
for whoever owns this project, not for the person wiring the CSS.

Full version: https://productype.com/ · https://www.fontspace.com/kalenor-ox-font-f167335

## Re-enabling a licensed copy

1. Drop the `.otf`/`.woff2` in this directory.
2. In `app/layout.tsx`, add `next/font/local` with `variable: "--font-kalenor"`,
   `preload: false` (one heading, inside an overlay most sessions never open) and
   `adjustFontFallback: false` (Next has no metrics for it; a wrong size-match
   shifts the heading on swap). Add its `.variable` to the `<html>` className.
3. In `styles/globals.css`, prepend `var(--font-kalenor)` to `--font-display`.
4. Check `.font-display`'s weight: Kalenor ships ONE weight, so `font-weight: 700`
   triggers synthetic bold. Keep 400 and let the size carry it.
5. Re-run the contour hash above. A licensed release should show no shared
   outlines.
