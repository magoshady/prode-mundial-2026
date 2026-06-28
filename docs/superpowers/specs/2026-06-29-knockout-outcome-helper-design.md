# Knockout outcome helper — design

**Date:** 2026-06-29
**Status:** Approved

## Problem

When entering a knockout prediction, the extra-time inputs hold the **aggregate**
score (90' + ET combined). This is non-obvious: a user typing `2-1` after a `1-1`
at 90' may not realize they've said "1 goal in extra time, home advances", or that
re-entering `1-1` means "no goals in extra time → penalties". Nothing on screen
reflects the implied outcome until after submission.

## Goal

Add an **always-on, English, client-side helper line** to
`KnockoutPredictionForm.tsx` that translates the current inputs into a plain-language
outcome as the user types. Purely a reading aid — no server changes, never blocks.

## Behaviour

The helper is derived live from form state (`home`, `away`, `etHome`, `etAway`,
`penAdvance`) and the existing `homeTeam` / `awayTeam` props.

| Situation | Helper line |
|---|---|
| 90' not a draw (e.g. 2-1) | *nothing* (decided in 90') |
| Draw at 90', ET inputs empty | "Tied at 90' — enter the score after extra time" |
| Draw at 90', ET decisive (1-1 → 2-1) | "1 goal in extra time — {winner} wins 2-1 and advances" |
| Draw at 90', ET level, no new goals (1-1 → 1-1) | "No goals in extra time — straight to penalties" |
| Draw at 90', ET level with goals (1-1 → 2-2) | "2 goals in extra time, still level — straight to penalties" |
| Penalty winner picked | "…straight to penalties — {winner} advances" |
| ET below 90' (1-1 → 0-1) | warn-colored: "Extra-time score can't be below the 90' score" |

- Goals in ET = `(etHome − home) + (etAway − away)`, pluralized ("1 goal" / "2 goals").
- Winner of a decisive ET = side with the higher aggregate.

## Architecture

- A small **pure helper** (e.g. `knockoutOutcomeHint`) takes the parsed inputs plus
  team names and returns `{ text, tone: "muted" | "warn" } | null`. Lives alongside
  the other knockout pure logic in `src/lib/knockout.ts` so it can be unit-tested
  without rendering.
- `KnockoutPredictionForm.tsx` calls it with the current state (parsing the string
  inputs to numbers) and renders the returned line in the existing
  `flex flex-col gap-1.5` stack, below the visible inputs.

## Styling

- Normal: `text-xs text-zinc-400`.
- Below-90' warning: `text-xs text-amber-400`.

## Out of scope

- No changes to `normalizeKnockoutPrediction` (server already enforces hard rules).
- No changes to how scores are displayed elsewhere (player page, share label).
- No language toggle / Spanish translation of existing labels.

## Testing

Unit tests for `knockoutOutcomeHint` covering every row of the table above, including
the empty-ET, no-goals, level-with-goals, decisive, penalty-picked, and below-90'
cases.
