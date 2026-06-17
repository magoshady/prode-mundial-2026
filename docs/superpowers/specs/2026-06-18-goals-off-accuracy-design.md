# Goals-Off Accuracy Stat — Design

## Origin

Requested by Martin Prado: a counter of how many goals a player's predictions
were off from reality, accumulated across all matches.

His exact framing (WhatsApp):
- Predicted 1-0, actual 2-1 → +2.
- Predicted 1-1, actual 0-0 → +2 (same).
- Subtract prediction vs actual per match and accumulate.
- "total es suficiente" — a single grand total is enough (no per-stage breakdown).
- "siempre acumulativo en positivo" — always positive; over- and under-shoots both
  add to the total (absolute values), never cancel out.

## The metric

For one match: `|pred.home − actual.home| + |pred.away − actual.away|`.

The player's total is the sum of that quantity over every **scoreable** match
(`isScoreable`: status FINISHED with both scores recorded) **that the player
actually predicted**.

Lower is better — it measures distance from reality.

## Decisions (confirmed with user)

- **Missing picks:** skipped — a match with no prediction contributes nothing.
  Consistent with how standings already treats a missing pick (0 points), and
  avoids penalizing differently from the points system.
- **Ranking role:** informational only. Does **not** affect leaderboard
  ranking or tiebreaks. It is a displayed counter, as Martin described.
- **Where shown:** leaderboard column **and** player detail page (with
  per-match values).
- **Label:** column header **"Goal Acc."** with a caption clarifying that lower
  is better.
- **Scope:** grand total only. No per-stage / per-group breakdown.

## Components

### 1. Pure function — `src/lib/scoring.ts`

```ts
/** Total goals away from reality: |Δhome| + |Δaway|. null when no prediction (skipped). */
export function goalsOff(pred: ScorePair | null | undefined, result: ScorePair): number | null {
  if (!pred) return null;
  return Math.abs(pred.home - result.home) + Math.abs(pred.away - result.away);
}
```

Returns `null` (not `0`) for a missing prediction so callers can distinguish a
skipped match from a perfect (0-off) prediction. Accumulators add `?? 0`.

### 2. Standings — `src/lib/standings.ts`

- Add `goalsOff: number` to `StandingRow`.
- In the per-user loop over scoreable matches, accumulate
  `goalsOff(pred, result) ?? 0`.
- **Do not change the sort or rank logic.** The existing sort
  (points desc, exact desc, name asc) and rank assignment are untouched.

### 3. Leaderboard — `src/app/leaderboard/page.tsx`

- New right-aligned column after **Points**, header `Goal Acc.`, value `r.goalsOff`.
- Add a caption under the `<h1>`: e.g.
  *"Goal Acc. = total goals off from the real scores (lower is better)."*

### 4. Player detail page — `src/app/player/[username]/page.tsx`

- Accumulate the player's total goals-off alongside the existing total/exact/outcomes.
- Append to the summary line: `… · {goalsOffTotal} goals off`.
- Add a right-aligned per-match column (header e.g. `Off`) showing the match's
  goals-off number for scoreable matches and `—` otherwise (matching the
  existing `—` convention for non-scoreable rows).

## Testing

- `src/lib/scoring.test.ts` — new `describe("goalsOff")`:
  - `{1,0}` vs `{2,1}` → `2` (Martin's example 1).
  - `{1,1}` vs `{0,0}` → `2` (Martin's example 2).
  - exact prediction → `0`.
  - missing prediction (`null` / `undefined`) → `null`.
- `src/lib/standings.test.ts` — extend to assert:
  - `goalsOff` sums across multiple scoreable matches.
  - a user with a missing pick on a scoreable match has that match skipped
    (contributes 0), and ranking is unchanged by goals-off.

## Out of scope (YAGNI)

- Per-stage / per-group breakdowns.
- Using goals-off as a ranking tiebreaker.
- Penalizing missing predictions.
