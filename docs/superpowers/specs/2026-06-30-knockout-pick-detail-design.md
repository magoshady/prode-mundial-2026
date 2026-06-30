# Reveal ET/penalty plans in "Everyone's picks" — design

**Date:** 2026-06-30
**Status:** Approved

## Problem

In the fixture page's "Everyone's picks" list, a knockout draw prediction (e.g.
`1-1`) shows only the 90' score. The extra-time aggregate and penalty pick the
player also made — required and already stored for any draw — are never surfaced.

## Goal

Show each player's full knockout plan in the picks list: under the score, a muted
secondary line with the extra-time aggregate and (if ET is level) who they have
advancing on penalties.

## Behaviour

| Prediction | Secondary line |
|---|---|
| `2-0` (decisive 90') | *(none)* |
| `1-1` → `2-1` ET | "2-1 a.e.t." |
| `1-1` → `1-1` ET, pen Morocco | "1-1 a.e.t., Morocco on pens" |

Group-stage rows are unaffected (never a knockout detail).

## Architecture

- **Pure helper** `knockoutPredictionDetail(pred, homeTeam, awayTeam): string | null`
  in `src/lib/knockout.ts`. Returns the secondary-line text, or `null` when no ET
  was predicted (decisive 90'). Pluralized wording fixed as `a.e.t.` and
  `{team} on pens`.
- **`page.tsx`** computes the string server-side per other-pick (knockout matches
  only) and passes it on `OtherPred` via a new `detail: string | null` field.
- **`MatchRow.tsx`** stays presentational: each `<li>` becomes a small column —
  the existing `name … score [badge]` row, plus, when `detail` is set, a muted
  second line beneath, indented under the name. Styling `text-xs text-zinc-500`.

## Out of scope

- The player profile page keeps its own inline format (left untouched by request).
- No schema/storage changes — all fields already exist.

## Testing

Unit tests for `knockoutPredictionDetail`: decisive 90' → null; draw + decisive ET;
draw + level ET with each penalty side; group-stage-style decisive input.
