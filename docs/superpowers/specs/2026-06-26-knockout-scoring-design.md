# Knockout Scoring — Design

**Date:** 2026-06-26
**Status:** Approved (pending implementation plan)
**Deadline:** Round of 32 begins Monday 2026-06-29 05:00 (local). Must ship before then.

## Problem

The app was built for group-stage scoring: each match stores a single
`fullTime` score and awards 3 (exact) / 1 (outcome) / 0. Knockout matches can go
to extra time and penalties, which this model does not handle. Two consequences:

1. **No richer scoring** for the parts of a knockout tie that matter to players
   (does it reach ET, who advances, do penalties decide it).
2. **A latent bug:** the football-data.org API corrupts `score.fullTime` for
   knockouts. For an extra-time match `fullTime` is the post-ET aggregate, not
   the 90' score. For a penalty shootout `fullTime` is **the shootout result**
   (e.g. Portugal 0-0 Slovenia after ET is reported as `fullTime: 3-0`).
   Left unchanged, every knockout match would be mis-scored.

## Goal

A layered knockout scoring system, with a progressive prediction UX, shipped
before the Round of 32. Group-stage scoring and the tournament-long bonuses
(champion, golden boot, dark horse) are unchanged.

## Scope decisions (locked)

- **Progressive / derived prediction UX.** Players enter the 90' score always.
  An ET-aggregate field appears only if they predicted a 90' draw. A
  "who advances" pick appears only if they predicted an ET draw too. Everything
  else (reaches-ET, penalties, advancing team in decided cases) is inferred from
  those inputs, so contradictory states are impossible.
- **ET score is entered and scored as the aggregate after extra time**
  (e.g. 1-1 at 90', a goal each way in ET → enter 2-2), not goals-in-ET-only.
- **Knockouts use the layered system only.** No clean-sheet bonus, no cojones
  bonus, no secret double on knockout matches — keeps the 6/10 caps exact. (The
  secret double is a last-round-of-groups feature and never applied to knockouts
  anyway.) Group-stage scoring is untouched.
- **Tournament-long bonuses unchanged:** champion, golden boot, dark horse still
  resolve at the end of the tournament.
- **"Advances" is weighted 3** (equal to an exact 90' score) — an intentional
  safety net so reliably calling who goes through is rewarded.

## Data model

### `matches` table — new columns

The API already returns these; we persist them so knockouts score from clean
fields instead of the corrupted `fullTime`.

- `duration` text — `REGULAR` | `EXTRA_TIME` | `PENALTY_SHOOTOUT`
- `winner` text — `HOME_TEAM` | `AWAY_TEAM` | `DRAW` | null
- `regularTimeHome` / `regularTimeAway` integer — the **90'** score (Layer 1)
- `extraTimeHome` / `extraTimeAway` integer — goals scored during ET
- `penaltiesHome` / `penaltiesAway` integer — shootout score

`homeScore` / `awayScore` are retained unchanged for group-stage scoring. For
knockouts the scoring code reads the new fields, never `fullTime`.

### `predictions` table — new nullable columns

- `etHomeScore` / `etAwayScore` integer null — predicted **aggregate after ET**.
  Set only when the player predicted a 90' draw.
- `penAdvance` text null — `HOME` | `AWAY`. Set only when the player predicted an
  ET draw too (i.e. predicted penalties).

Group-stage predictions leave all three null.

## Sync

In `syncMatches`, additionally read `score.regularTime`, `score.extraTime`,
`score.penalties`, `score.winner`, `score.duration` and upsert them.

**Gotcha (must be handled):** for `PENALTY_SHOOTOUT` matches the API overwrites
`fullTime` with the shootout result. The end-of-ET aggregate must therefore be
computed as `regularTime + extraTime`, never read from `fullTime`.

For non-knockout matches these fields may be absent/REGULAR; store what the API
gives (regularTime falls back to fullTime for REGULAR matches, extraTime /
penalties null).

## Scoring

New pure function `knockoutPoints(pred, result)` in `src/lib/scoring.ts`
(or a sibling module), fully unit-tested. Inputs:

- `pred`: `{ reg: ScorePair; et: ScorePair | null; penAdvance: 'HOME'|'AWAY'|null }`
  where `et`/`penAdvance` derive from the stored prediction columns.
- `result`: derived from match columns — `reg` (regularTime), end-of-ET
  aggregate (`regularTime + extraTime`), `duration`, `winner`.

### Layers

| Layer | Condition | Points |
|---|---|---|
| 1 — 90' exact | predicted 90' == actual `regularTime` | 3 |
| 1 — 90' outcome | correct W/D/L at 90', wrong score | 1 |
| 2 — reaches ET | player predicted a 90' draw **and** match actually reached ET (`duration` ≠ REGULAR) | +1 |
| 2 — ET exact | player predicted ET **and** predicted ET aggregate == actual end-of-ET aggregate | +2 |
| 3 — advances | predicted advancing team == actual `winner` | 3 |
| 3 — penalties | player predicted penalties (90' draw + ET draw) **and** match actually went to penalties | +1 |

### Derivation of the predicted advancing team

- Decisive 90' prediction → 90' winner.
- 90' draw + decisive ET prediction → ET winner.
- 90' draw + ET draw → explicit `penAdvance` pick.

### Caps

- Decided in 90': max **6** (90' exact 3 + advances 3).
- Full distance: max **10** (90' exact 3 + reaches ET 1 + ET exact 2 +
  advances 3 + penalties 1).

Layers are independent. A player can miss the 90' score entirely yet still earn
the 3 for correctly calling who advances (the safety net).

No prediction → 0, as today.

### Edge cases

- Layer 2 "ET exact" requires the match to have actually reached ET; otherwise 0.
- Layer 2 "ET exact" is independent of Layer 1 exactness (it compares ET
  aggregates only).
- THIRD_PLACE and FINAL are scored with the same function.

## Prediction UX

Progressive form (replacing/extending `PredictionForm` for knockout matches):

1. 90' score — two inputs, always shown. If decisive, the form is complete
   (advancing team shown as derived, read-only).
2. If 90' is a draw → reveal "after extra time" aggregate inputs.
3. If ET is also a draw → reveal "Penalties — who goes through?" with a
   home/away pick.

**Server-side validation** (in the save action):
- 90' draw requires ET aggregate present.
- ET draw requires `penAdvance` present.
- ET aggregate must be ≥ the 90' draw score per side (can't un-score goals).

Lock at kickoff and reveal-to-others at kickoff are unchanged
(`isOpenForPrediction`, `othersVisible`).

Group-stage matches keep the existing single-score form.

## Display

- Leaderboard totals absorb knockout points automatically via `computeStandings`.
- The player detail page shows a per-match knockout breakdown (which layers each
  player hit), consistent with how per-match points already render there.

## Standings integration

`computeStandings` branches per match: group-stage matches use the existing
`predictionPoints` (+ existing per-match bonuses where eligible); knockout
matches (`stage` ≠ `GROUP_STAGE`) use `knockoutPoints` and skip clean-sheet /
cojones / double. `goalsOff` continues to be computed from the 90' score for
knockouts (informational).

## Testing

Unit tests for `knockoutPoints`:
- decided in 90' (exact, outcome, miss)
- ET-decided (exact ET, wrong ET, didn't predict ET)
- ET → penalties (penalty pick correct / wrong)
- safety net: wrong 90', correct advance
- no prediction → 0
- shootout `fullTime` gotcha: end-of-ET aggregate from regularTime+extraTime

Standings integration tests mixing group-stage and knockout matches.

## Launch announcement

Draft a short Spanish in-app / WhatsApp message explaining the knockout layers,
ready before Monday 05:00.

## Out of scope

- Changing group-stage scoring or existing bonuses.
- Two-legged ties / aggregate-over-two-matches (World Cup knockouts are single
  matches).
