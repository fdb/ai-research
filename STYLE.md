# STYLE — visual system for all experiments

A single shared visual register for every experiment in this repo. Consistency across experiments matters more than per-experiment cleverness; the experiments should read as a series.

This is the **default**. Override only when the topic genuinely needs a different emotional register, and document the deviation in the experiment's `notes.md`.

The site shell (`/index.html`) uses a different palette (Fraunces + Inter, warm cream) — that's intentional. The shell is editorial; the experiments are functional/interactive. Don't unify them.

---

## Type

Two faces, both from Google Fonts. Pin the request to the weights actually used so the load is small.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

```css
:root {
  --font-sans: 'Space Grotesk', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}

body { font-family: var(--font-sans); }
code, pre, kbd, samp, .num { font-family: var(--font-mono); }
```

**Space Grotesk** is the single sans face — used for headings AND body text. Don't mix in Inter, Fraunces, or anything else; the whole experiment carries one voice. Use weight (not a different family) to create hierarchy.

**JetBrains Mono** is for code, parameter readouts, numeric tables, keyboard hints, and anywhere alignment matters. Disable its programming ligatures in numeric contexts:

```css
.num, .readout, td.num { font-feature-settings: "calt" 0, "liga" 0; font-variant-numeric: tabular-nums; }
code, pre { font-feature-settings: "calt" 1, "liga" 1; }
```

The `tabular-nums` feature is critical for parameter readouts that update on a slider — without it, `0.123 → 0.456` shifts horizontally and hurts the eye.

### Type scale

Pick from these; don't introduce off-scale sizes.

| Token | Size | Line height | Tracking | Use |
|---|---|---|---|---|
| `--t-display` | `clamp(2.4rem, 5vw, 3.6rem)` | 1.05 | -0.02em | Page `<h1>` |
| `--t-h2` | `clamp(1.6rem, 3vw, 2.1rem)` | 1.15 | -0.015em | Section headings |
| `--t-h3` | `1.25rem` | 1.25 | -0.01em | Subsection / figure title |
| `--t-body` | `1rem` | 1.65 | 0 | Prose |
| `--t-small` | `0.875rem` | 1.5 | 0 | Captions, footnotes |
| `--t-eyebrow` | `0.7rem` | 1.4 | 0.18em | Section eyebrow (uppercase) |
| `--t-mono` | `0.95rem` | 1.5 | 0 | Inline code, readouts |

Body weight is 400. Headings are 500 (not bold) — Space Grotesk gets too dense at 700 for display sizes.

## Color

**OKLCH only.** No `#hex`, no `rgb()`, no `hsl()`. OKLCH is perceptually uniform: a lightness shift of equal magnitude looks equally large across hues, which is what keeps a palette feeling tuned rather than ad-hoc.

```css
:root {
  /* Surface */
  --bg:        oklch(98.5% 0.005 250);  /* near-white, slightly cool */
  --bg-alt:    oklch(95% 0.01 250);     /* card / well */
  --bg-sunken: oklch(92% 0.012 250);    /* code blocks, insets */

  /* Ink */
  --ink:       oklch(20% 0.02 250);     /* body text */
  --ink-muted: oklch(45% 0.02 250);     /* captions, secondary */
  --ink-faint: oklch(65% 0.015 250);    /* placeholders, axis labels */

  /* Lines */
  --line:      oklch(88% 0.01 250);     /* borders, dividers */
  --line-strong: oklch(75% 0.015 250);  /* axis lines, focused borders */

  /* Accent (single, used sparingly) */
  --accent:        oklch(55% 0.20 28);  /* warm orange-red */
  --accent-strong: oklch(48% 0.22 28);  /* hover, emphasis */
  --accent-soft:   oklch(92% 0.05 28);  /* tinted background */

  /* Data palette (categorical, max 5 series) */
  --c1: oklch(55% 0.20 28);   /* orange-red — same as --accent */
  --c2: oklch(55% 0.16 230);  /* blue */
  --c3: oklch(55% 0.18 145);  /* green */
  --c4: oklch(55% 0.18 295);  /* purple */
  --c5: oklch(60% 0.15 80);   /* yellow-ochre */

  /* Semantic */
  --positive: oklch(55% 0.16 145);
  --negative: oklch(55% 0.20 28);
  --warning:  oklch(70% 0.16 80);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg:        oklch(18% 0.01 250);
    --bg-alt:    oklch(22% 0.012 250);
    --bg-sunken: oklch(15% 0.01 250);
    --ink:       oklch(94% 0.005 250);
    --ink-muted: oklch(70% 0.01 250);
    --ink-faint: oklch(50% 0.01 250);
    --line:      oklch(30% 0.012 250);
    --line-strong: oklch(45% 0.015 250);
    --accent-soft: oklch(28% 0.06 28);
  }
}
```

Use **one accent** per experiment. The data palette (`--c1`...`--c5`) is for categorical chart series only — not for UI chrome. If a chart needs more than 5 series, the chart needs a redesign, not more colors.

## Spacing

Geometric scale, 8px base. Don't introduce off-scale values.

```css
:root {
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 16px;
  --s-4: 24px;
  --s-5: 40px;
  --s-6: 64px;
  --s-7: 96px;
  --s-8: 144px;
}
```

## Layout

```css
:root {
  --content-w: 720px;       /* prose column */
  --wide-w:    1040px;      /* figure / interactive max width */
  --radius:    6px;         /* uniform corner radius */
  --radius-lg: 10px;        /* cards */
}

.prose      { max-width: var(--content-w); margin: 0 auto; padding: 0 var(--s-3); }
.figure-wide{ max-width: var(--wide-w);    margin: 0 auto; padding: 0 var(--s-3); }
```

Prose stays narrow for reading comfort (~65–75ch). Interactive figures break out to `--wide-w` so the mechanic gets room to breathe. Don't make prose 1040px wide.

## Components

### Buttons

```css
.btn {
  font-family: var(--font-sans);
  font-size: 0.95rem;
  font-weight: 500;
  padding: 10px 18px;
  border-radius: var(--radius);
  border: 1px solid var(--line-strong);
  background: var(--bg);
  color: var(--ink);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.btn:hover  { background: var(--bg-alt); border-color: var(--ink-muted); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: oklch(98% 0 0);  /* always near-white on accent, both modes */
}
.btn-primary:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
```

Always check contrast on `.btn-primary` — accent on near-white must hit 4.5:1.

### Sliders

Native `<input type="range">` with custom track. Pair every slider with a tabular-nums readout so the value doesn't dance.

```html
<label class="slider">
  <span class="slider-label">Bias threshold</span>
  <input type="range" min="0" max="1" step="0.01" value="0.3">
  <output class="num">0.30</output>
</label>
```

```css
.slider { display: grid; grid-template-columns: 1fr auto; gap: var(--s-2) var(--s-3); align-items: center; }
.slider-label { font-size: var(--t-small); color: var(--ink-muted); grid-column: 1 / -1; }
.slider input[type=range] { accent-color: var(--accent); }
.slider output { font-family: var(--font-mono); font-variant-numeric: tabular-nums; min-width: 4ch; text-align: right; }
```

### Big-number callout

```css
.callout {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: clamp(2.4rem, 5vw, 3.6rem);
  font-weight: 500;
  line-height: 1;
  color: var(--accent);
  margin: var(--s-5) 0 var(--s-2);
}
.callout + .callout-caption {
  font-size: var(--t-small);
  color: var(--ink-muted);
  margin-bottom: var(--s-5);
}
```

### Code blocks

```css
pre, code {
  font-family: var(--font-mono);
  background: var(--bg-sunken);
  border-radius: var(--radius);
}
code { padding: 0.1em 0.35em; font-size: 0.9em; }
pre  { padding: var(--s-3) var(--s-4); overflow-x: auto; line-height: 1.55; }
pre code { background: none; padding: 0; font-size: 0.95rem; }
```

## SVG defaults

Strokes use `--line-strong` for axes, `--accent` for the primary series, `--c2`...`--c5` for additional series. All SVG `<text>` is live (never paths) and uses the page's font:

```css
svg text { font-family: var(--font-sans); fill: var(--ink); font-size: 12px; }
svg text.axis { fill: var(--ink-muted); font-size: 11px; }
svg text.value { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
```

## Motion

```css
* { transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Default transition: 200ms. Reveal animations: 600ms. **Nothing decorative animates** — every motion is functional (state change, focus shift, scrolly-driven update).

## Accessibility minimums (non-negotiable)

- Exactly one `<h1>` per page; no skipped heading levels
- All interactive elements reachable by keyboard with visible `:focus-visible`
- Color is never the only cue (pair with shape, label, or text)
- All SVG text is live `<text>`, not paths — screen readers and copy/paste depend on this
- Touch targets ≥ 40×40px on mobile
- No horizontal scroll at 360px viewport
- WCAG AA contrast: 4.5:1 body, 3:1 large display — verify in *both* light and dark mode
- Honor `prefers-reduced-motion`

## What NOT to do

- **No Tailwind, Bootstrap, or other CSS framework.** This system *is* the framework.
- **No hex colors.** OKLCH only.
- **No third font.** Two faces, that's it.
- **No `<script src=...>` to a non-ESM library.** ESM imports or import maps only — no build step.
- **No font icons.** Use inline SVG.
- **No background images, gradients, or shadows for decoration** — only when functional (e.g., elevation to indicate a draggable element).
- **No emoji in UI chrome** unless the experiment is explicitly playful.
