# Explorable Explanations — house standard for experiments

For **every experiment in this repo**, the deliverable you ship inside the experiment folder should be — when at all possible — an *explorable explanation*: a single self-contained interactive web page that lets a reader **produce the phenomenon themselves**, rather than passively read about it.

The standard is *Parable of the Polygons*: the reader performs the mechanism with their own hands, sees the counterintuitive result emerge, then understands the lesson with less defensiveness and more confidence than any prose argument could deliver.

This file is the short reference. The full skill (process, gates, library catalog, exemplars) lives at `~/dotfiles/claude/skills/explorable-explanations/SKILL.md` — read it when a question here doesn't answer what you need.

---

## What you are producing

One `.html` file inside the experiment folder. All CSS inline. All page logic inline (`<script type="module">`). External libraries only via ESM imports or import maps — **no build step, no React, no Vite, no webpack**. Total reader time ≤1 hour.

Visual style follows `STYLE.md` (sibling file). Don't reinvent the palette per experiment.

## Core principle

Every interaction must answer: **what can the reader now prove, challenge, or understand that static prose could not give them?**

If the answer is "it looks engaging," cut the interaction. Decoration without implication is the most common failure mode.

## Before you write code: the Model Contract

Write this short artifact in `notes.md` before opening the HTML file:

```
Claim:              (the one thing the reader should leave understanding)
Mechanism:          (the causal device that produces it)
Reader action:      (the reader produces the phenomenon by doing X)
Visible consequence:(what changes on screen when they do X)
Evidence/assumption:(source-backed, or labeled "(assumption)")
Limit:              (what this model does NOT show)
```

If you cannot write the **Reader action** line as a single sentence, the piece doesn't have a mechanic yet — go back to the topic, not to the code.

## Mechanic ladder (high → low implication)

The closer the reader's own action is to *causing* the phenomenon, the better the piece lands. Pick the core mechanic from rungs 1–4 where possible.

1. **drag-and-arrange** — reader places inputs that yield the result
2. **parameter-slider** — reader controls a knob, watches consequence
3. **live-simulation** — reader-triggered emergence
4. **step-stepper** — reader advances pre-staged steps over a persistent canvas
5. scrubbable-timeline
6. before-after-toggle
7. minigame
8. audio-trigger
9. annotated-diagram-with-hover
10. freeform-sandbox

A mature piece composes 2–4 rungs across roles: drag/step for **setup**, sim/slider for **exploration**, toggle/hover for **reveal**, sandbox for **closer**.

## Editorial gates (the ones that bite)

| Gate | Question | If it fails |
|---|---|---|
| **G1 — Self-implication** | Where does the reader produce the phenomenon? | Warn; if no answer, the piece is a lookup, not a model |
| **G2 — On the ladder** | Is the interaction on the mechanic ladder, or decorative? | Cut the decoration |
| **G4b — Stand-in ethics** | Are you using cute stand-ins for war, oppression, trauma, identity, death? | **Stop.** Reframe. Use abstract shapes, not anthropomorphic figures |
| **G7 — Source provenance** | Does each numeric claim trace to a source or carry `(assumption)`? | Label assumptions; never invent citations |
| **G8 — Model limits visible** | Are limits in the page, not hidden in a footnote? | Add a "what this model doesn't show" section |
| **G9 — Manipulative framing** | Does the framing present a contested claim as physics? | Reframe to "here is what this model shows," not "this proves" |

## Anti-patterns (the most common failure modes)

1. **Lookup-not-model** — reader inputs themselves but learns no causal mechanism
2. **Decorative interaction** — moves on screen, contributes nothing
3. **Symbolic-only action** — interaction collapses to a single keypress
4. **On-rails stepper** — reader can't author or stress-test
5. **Sandbox without thesis** — assemblage of toys, no argument
6. **Sliders that imply precision the evidence does not support**
7. **Visual reference, no visual evidence** — prose says "the red line" but the rendering shows no red line. Always cross-check color words against actual rendered colors.
8. **Layout shift in the interactive zone** — variable-length labels above a slider make the chart jump as the user scrubs. Use fixed `min-height` containers for state-dependent text.

## Build phases (in order — non-negotiable)

| Phase | Output | Checkpoint |
|---|---|---|
| **P1 Scaffold** | HTML skeleton; sections stubbed; mechanic stubs present but unwired | Page renders top-to-bottom with no errors |
| **P2 Core mechanic in isolation** | Mechanic actually produces the phenomenon. Crude visuals OK | **Can a cold reader produce the phenomenon by interacting, with only the minimal labels needed to operate the model — no narrative persuasion?** If no, fix the mechanic, not the prose. |
| **P3 Narrative wiring** | Prose written; mechanic-prose handoffs wired; scroll/step transitions in place | Piece flows top-to-bottom *without* touching the mechanic. Piece flows if you only touch the mechanic and never read prose. |
| **P4 Design pass** | Apply `STYLE.md`; figure styling; responsive | Visual register matches the topic's emotional register |
| **P5 Polish** | Reduced-motion; keyboard nav; mobile (≥360px); state-on-scroll-back; sources section; model-limits section | No accessibility or UX bug a first-time reader will hit |

**P2 is the load-bearing checkpoint.** It is the equivalent of TDD's red step. If the mechanic doesn't prove the phenomenon under minimal-rules conditions, fix the mechanic.

## Final hand-off checklist

- [ ] **Color-claim audit** — every color word in the prose ("the red line") is actually rendered in that color on screen
- [ ] **Legend swatches present** for every chart series
- [ ] **Layout stability under interaction** — drag every slider end-to-end; nothing above or below the chart shifts vertically
- [ ] **Contrast audit** — every text-on-background combination meets WCAG AA (4.5:1 body, 3:1 large display)
- [ ] **Reduced-motion render** — works cleanly with `prefers-reduced-motion: reduce`
- [ ] **Cold-reader test** — show it to someone who hasn't read the source; they can articulate the central insight in their own words
- [ ] **Source provenance walk** — every numeric claim cites a source by name or is labeled `(assumption)`. No bare numbers.

## When an explorable explanation is the wrong shape

Use a different format (and say so in `notes.md`) when:

- The experiment is a benchmark or a measurement — a results table is more honest than a fake interactive
- The finding is "it didn't work" with no mechanism to show — a written report is the right shape
- The artifact is a tool/CLI/library — a README and example output beat a fake interactive
- The topic is a codebase or protocol — defer to a code-explainer-shaped artifact

In all of those, still produce the `notes.md` and `README.md` per `AGENTS.md`. The interactive page is the *default* deliverable, not a mandatory one.

## Reference exemplars (read at least one before starting)

- *Parable of the Polygons* — https://ncase.me/polygons/
- *Outbreak* — https://meltingasphalt.com/interactive/outbreak/
- *How ETFs Work* — https://www.bloomberg.com/features/2016-etf-files/toy/
- *Sight & Light* — https://ncase.me/sight-and-light/
- Bartosz Ciechanowski — https://ciechanow.ski/

When in doubt, point at the closest exemplar and ask: "could a reader produce the phenomenon as directly as the reader of *X* does?"
