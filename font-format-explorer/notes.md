# Font Format Explorer — working notes

## Goal

Build an explorable explanation of how to parse a TrueType-flavored OpenType font:

- The offset table + table directory at the head of the file
- `maxp` — number of glyphs
- `head` — overall metrics (units per EM, indexToLocFormat)
- `hhea` + `hmtx` — horizontal metrics (advance width, lsb)
- `cmap` — character → glyph index mapping
- `loca` + `glyf` — glyph outlines (TrueType only; CFF/CFF2 explicitly out of scope)

Variable fonts and CFF are out of scope per the spec.

## Design choices

- Tufte-ish: light beige background, colored grays, single off-red accent.
- OKLCH for everything, CSS variables for the palette.
- Self-contained single-file HTML, deps via esm.sh / unpkg.
- Space Grotesk for UI copy.
- Decided NOT to depend on opentype.js for parsing — that defeats the point of an explorable explanation. We parse from scratch with DataView. opentype.js stays available as an escape hatch if useful for outline fallbacks later.

## Hex viewer

Custom hex view component:
- Renders a byte buffer as 16-byte rows with offset, hex, and ASCII gutter.
- Supports a list of "highlights" — `{start, length, className, label}` — that color the byte spans.
- Each row scrolls into view when its highlight is selected.
- Hovering a byte cell shows offset / value tooltip.

This is the centerpiece — every parsing step is "here are the bytes we just consumed".

## Embedded font

The page needs a font to parse on first load. Easiest route: ship a small TTF as a base64 string and decode it at startup. Space Grotesk Regular is ~80KB which is reasonable. (Alternative: fetch from Google Fonts — but Google Fonts serves WOFF2, which is compressed, and we want a raw TTF. Better to ship a TTF.)

Update: shipping the TTF inline as base64 was bloating the HTML. Switched to fetching a .ttf binary file alongside the HTML, with the file-input fallback if the fetch fails (CORS / file:// protocol). For local viewing, dropping a font onto the page works regardless.

## Things I learned along the way

- The `head` table contains a `magicNumber` field that's literally `0x5F0F3CF5` — fun.
- `unitsPerEm` is typically 1000 for PostScript-derived fonts (CFF) and 1024 or 2048 for TrueType. Space Grotesk is 1000.
- `cmap` has many subtable formats; format 4 (segment mapping to delta values) is the workhorse for the BMP, format 12 handles supplementary planes. We render format 4 in detail and acknowledge format 12.
- `loca` table format is determined by `head.indexToLocFormat`: 0 = short (uint16, divided by 2), 1 = long (uint32). Easy to get wrong.
- Glyph outlines: a header (numberOfContours, xMin/yMin/xMax/yMax), then either simple (numberOfContours >= 0) or composite (== -1). For the exploration we render simple glyphs; composites are explained but rendered via their resolved outline.
- The on-curve / off-curve flag bit (0x01) is the key to drawing — consecutive off-curve points implicitly create on-curve midpoints.

## Color palette (OKLCH)

```
--paper:        oklch(97% 0.012 85)   /* light beige */
--ink:          oklch(22% 0.02 60)    /* warm dark gray */
--ink-soft:     oklch(45% 0.015 60)
--rule:         oklch(82% 0.012 70)
--accent:       oklch(55% 0.18 28)    /* off-red */
--accent-soft:  oklch(88% 0.06 28)
--hl-blue:      oklch(70% 0.08 240)
--hl-green:     oklch(72% 0.09 150)
--hl-purple:    oklch(70% 0.10 320)
--hl-amber:     oklch(78% 0.10 75)
```

## Rendering steps in the page

1. **The file** — drop zone + hex view of the whole file (truncated, with virtualized window).
2. **Offset Table** — sfnt version, numTables. Highlight 12 bytes.
3. **Table Directory** — list of records. Click a record → jumps to that table's bytes.
4. **maxp** — numGlyphs.
5. **head** — unitsPerEm, indexToLocFormat, xMin/yMin/xMax/yMax (the font bounding box).
6. **hhea** — ascent, descent, line gap, numberOfHMetrics.
7. **hmtx** — advance widths array. Show a glyph's metrics next to its outline.
8. **cmap** — pick format 4 subtable, walk segments, demo "type a character" → glyph index.
9. **loca** — glyph offsets.
10. **glyf** — pick a glyph, render its outline (canvas) with on-curve / off-curve points and the implicit midpoints.

## Open questions / TODO during build

- Need to handle the `null` glyph (0) which can have empty outline.
- Composite glyphs: just show "this is composite" rather than try to recompose for v1. Pick a simple glyph by default to demo.
- Performance: a full hex dump of an 80KB font is 5000 rows. Render only the visible window (virtualized) or chunks per-table.

Decision: each "step" panel renders only the bytes of the current table being explained. A separate top-level "all bytes" view shows the file with rough table boundaries colored, but uses a virtualized canvas-style render.

## 2026-05-03 — sandbox + scroll fix

Two follow-up tasks landed today.

### 1. Auto-scroll bug

On initial load the page jumped down to the format-4 cmap section. Cause:
`renderCmap` ends with `matchRow.scrollIntoView({ block: 'nearest' })`, where
`matchRow` is the highlighted row in the segment table. Even with
`block: 'nearest'`, `scrollIntoView` walks every scrollable ancestor, including
the document — so when the cmap section is below the viewport on first render,
the document scrolls down to put it in view.

Fix: instead of `scrollIntoView`, manually adjust the inner wrapper's
`scrollTop` so the matching row is visible only within the wrapper's
overflow-auto container. The document is left alone.

### 2. Sandbox: type a word, see the whole pipeline

A new section at the bottom of the page that takes free-form text and shows:

- character → codepoint
- codepoint → glyph index via the existing format-4 cmap lookup
- ligature substitution via GSUB `liga` (lookup type 4, format 1)
- per-glyph advance width and lsb from `hmtx`
- pair kerning via either GPOS `kern` (lookup type 2, formats 1 and 2) or the
  legacy `kern` table (format 0)
- glyph outlines (including composite resolution for letters like `i`, `j`, `é`)
  laid out along the baseline with negative kerning shown as red bands and
  positive kerning shown as blue bands

Implementation notes:

- **GSUB ligature parser.** Walks the feature list for `liga`/`clig`/`rlig`,
  collects their lookup indices, then parses each LookupType-4 subtable
  (LigatureSubstitutionFormat1 only — format isn't a thing for type 4 in the
  spec but the substFormat field exists; we accept format 1). Sorts by
  component count descending so longest matches win (e.g. `ffi` beats `ff`+`i`).
  Indexed by first-glyph in a Map for O(1) prefix matching at apply-time.

- **GPOS kerning parser.** OT kerning lives in GPOS LookupType 2 these days,
  not in the legacy `kern` table — Space Grotesk and most modern fonts have
  only the GPOS form. PairPosFormat1 stores explicit (left, right) pair
  records; PairPosFormat2 stores a class×class table that compresses several
  thousand pairs into a few hundred classes. Both are needed; modern fonts
  often ship one of each in different subtables. ValueRecord is variable-sized
  by valueFormat — only XAdvance (bit 0x0004) is relevant for horizontal
  kerning, but we still need to skip XPlacement / YPlacement bytes preceding
  it. Cached the explicit pairs into a flat `Map((left<<16)|right -> xAdvance)`
  for fast lookup; fell back to scanning class-based subtables for misses.

- **Composite glyph resolution.** Originally we punted on composite glyphs
  (drew a dashed bbox). The sandbox needs them: `i`, `j`, `é`, `ñ`, etc. are
  all composites in Space Grotesk. Added a recursive resolver that parses the
  composite component header (flags, glyphIndex, dx/dy, optional 2x2 affine in
  F2DOT14) and applies the transform to each component's contours. Depth cap of
  8 to avoid pathological recursion.

- **Layout math.** Pen advances by `advanceWidth - kernAdjustment` between
  glyphs (the kern is applied *before* drawing the next glyph). The stage SVG
  scales the design-unit pen position by `(stageHeight - 2*pad) / (ascender -
  descender)` so the baseline lines up across glyphs of any size.

- **UI feedback.** Toggling kerning off animates Σ to zero and grows total
  advance by the sum of kerning values; toggling ligatures off de-merges
  ligature rows back into individual character rows. Composite glyph is
  rendered with the resolved contours, not just a bbox, so 'i' looks like 'i'.

### Things I confirmed during testing

- `affiliate` shapes to 7 glyphs with one `ffi` ligature — greedy match works.
- `office` shapes to 4 glyphs (o, ffi, c, e); the `ffi` 3-component liga
  beats the `ff` 2-component one, as required.
- Space Grotesk has 9 ligatures total (ff, fi, fl, ffi, ffl, fb, ffb, fh, ffh)
  and 2609 explicit GPOS kern pairs plus a class-based subtable.
- The `AV`, `To`, `Va`, `T,` and `T o` pairs all kern as expected.
