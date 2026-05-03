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
