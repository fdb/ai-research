# Inside an OpenType font &middot; an explorable explanation

A single-page, self-contained explorable explanation that parses a TrueType-flavored OpenType font from raw bytes, all the way to a rendered glyph outline — showing every step with a custom hex viewer, decoded field tables, and live SVG visualisations.

Drop in your own `.ttf` or `.otf` and watch the same parser run on it.

> Open `index.html` over `http://` or `https://` (e.g. `python3 -m http.server`) — `file://` works too in most browsers, but Chrome blocks `fetch()` for local files, so use the file picker / drop-zone there.

## What it teaches

Walking top-to-bottom through the page, the reader sees:

1. **The container** — the 12-byte SFNT header, with the `0x00010000` "version" tag that distinguishes TrueType outlines from CFF.
2. **The table directory** — `numTables` &times; 16-byte records, each naming one table by ASCII tag, with offset and length into the file. The only index in the file.
3. **`maxp`** — the glyph count.
4. **`head`** — `unitsPerEm` (the design grid every glyph lives in), the `0x5F0F3CF5` magic number, the font bounding box, and `indexToLocFormat` (which determines whether `loca` offsets are 16- or 32-bit).
5. **`hhea` + `hmtx`** — vertical metrics (ascender, descender, line gap) plus a per-glyph (advance width, left side bearing) array, with the trailing-glyph-share-the-last-advance optimisation.
6. **`cmap`** — Unicode character → glyph index. Pick the format-4 subtable, walk its segment array, run the lookup formula for the character the user types.
7. **`loca` + `glyf`** — read the per-glyph offset, parse the glyph header (`numberOfContours`, bbox), then run-length-decoded flag bytes, then x and y deltas. Build the contours, draw quadratic Béziers, mark on-curve, off-curve and the **implicit on-curve midpoints** between consecutive off-curves — the fact that surprises everyone the first time.

CFF outlines, variable-font axes, hinting, GSUB/GPOS layout, kerning — all explicitly out of scope and noted on the page where they would otherwise muddy the explanation.

## Files

| file | purpose |
|---|---|
| `index.html` | Page structure and CSS (Tufte-ish: warm beige paper, colored grays, one off-red accent). All colors are OKLCH via CSS variables. |
| `app.js` | Self-contained ES module: a `FontParser` class that reads from a `DataView`, a custom hex viewer with per-byte highlight classes, and one `render*` function per page section. |
| `SpaceGrotesk-Regular.ttf` | Default font (Space Grotesk by Florian Karsten), fetched at startup. The user can drop in a different font at any time. |
| `notes.md` | Working notes kept while building. |
| `test-parser.mjs` | Node smoke-test that exercises `FontParser` against the bundled font without a browser. |

## Design

- **No parsing library.** The point of an explorable explanation is to show the work, so `FontParser` reads every field by hand. `opentype.js` was considered as a fallback for outline rendering but never needed.
- **Custom hex viewer.** Each section calls `renderHexView(target, parser, start, end, highlights)` where `highlights` is `[{start, length, className, label}]`. Bytes covered by a highlight pick up its background color; the first byte of each highlight gets a coloured underline so field boundaries are visible at a glance. The matching rows in the field table use the same swatch color, so reader-eye tracking is one-to-one.
- **Tufte palette.** Light beige paper (`oklch(97% 0.012 85)`), warm dark ink, dotted/dashed rules, one off-red accent (`oklch(54% 0.18 28)`) used sparingly for keywords and the active highlight. Six soft highlight families (blue, green, purple, amber, teal, red) for the hex byte spans.
- **Visible-where-possible.** Wherever a value can be drawn, it is: the font bounding box gets an SVG with em-square overlay; a glyph gets a full SVG with baseline / ascender / descender / advance-width / origin annotations and clickable point markers; common letters get a clickable mini-grid for quick navigation.

## Verifying the parser

`node test-parser.mjs` runs the parser against the bundled font without a browser. Recent run, for the curious:

```
flavour: truetype, numTables: 21
head.unitsPerEm: 1000, magicNumber: 0x5F0F3CF5
indexToLocFormat: 0 (short), bbox: -49 -274 1203 1081
hhea.ascender: 984, descender: -292, numberOfHMetrics: 1001
maxp.numGlyphs: 1001
cmap subtables: 0/3 fmt=4, 3/1 fmt=4
'A' (U+41) -> gid 4 via delta
'!' (U+21) -> gid 89 via idRangeOffset
'g' (gid 36) -> 2 contours, 44 points (22 on / 22 off)
```

## Open extensions

Things that would round out the explanation but were deliberately left out of v1:

- Composite glyphs — currently shown by their bounding box only. Recursively decomposing them and showing the affine transforms would be a great addition.
- The CFF / CFF2 outline path: a parallel walk through `CharStrings`, `subr`s and the type 2 stack-based byte code.
- Variable fonts: `fvar` axes, `gvar` deltas, the math of interpolation. Probably its own page.
- A full text-layout demo combining `cmap` &rarr; gid &rarr; outline + advanceWidth across a string of characters, into a rendered baseline of glyphs.

## License of the bundled font

Space Grotesk is © Florian Karsten, distributed under the SIL Open Font License v1.1 (see [its repository](https://github.com/floriankarsten/space-grotesk)).
