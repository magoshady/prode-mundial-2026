# BOMBITA — QF double-or-nothing (design)

Date: 2026-07-07
Status: approved design, pending implementation plan

## Overview

A per-player "double or nothing" bet for the quarter-finals. Each player designates
**one** QF match as their **bombita** (💣). It does not change what they predict — it
changes how *that one match* pays out: nail the 90' scoreline and your whole normal QF
haul for that match is **doubled**; miss it and you get **zero**, with a small floor if
you at least called who advanced.

Goal: add drama to the QF round ("me la juego con Francia") without disturbing the rest
of the scoring. The other three QF matches score normally (stage multiplier + clean-sheet/
cojones bonus, already shipped).

## Scoring

The bombita **replaces** the normal graduated knockout scoring for the chosen match only.
Judged on the **90-minute** scoreline; extra time and penalties never need to be predicted.

| Result on your bombita match | Points |
|---|---|
| Exact 90' score | normal match total **× 2** (jackpot) |
| Not exact, but correct advancer | **3 × stage multiplier** (floor) |
| Neither | **0** |

"Normal match total" = the value we already compute: `(knockoutPoints.total + cleanSheet +
cojones) × stageMultiplier`. The tiers are derived entirely from the existing
`KnockoutBreakdown`:

- exact 90' ⟺ `breakdown.reg === 3`
- correct advancer ⟺ `breakdown.advance === 3` (this is true even when the advancer was
  decided by ET or penalties, since `advance` compares the predicted advancer to the real
  winner)

Tiers are mutually exclusive, highest applicable wins. The jackpot triggers purely on the
90' scoreline — you keep it even if you called the wrong penalty-shootout winner.

### Worked examples (QF, ×1.5)

- **Jackpot.** Predict `2-0`, finishes `2-0` in 90' (home through).
  Normal = `(reg 3 + advance 3 + clean-sheet 1) × 1.5 = 10.5`. Bombita = **21**.
- **Floor.** Predict `2-1`, finishes `3-0` in 90' (home through).
  `reg = 1` (right outcome, not exact), `advance = 3`. Bombita = `3 × 1.5` = **4.5**.
  (Normal would have been `(1+3)×1.5 = 6` — the bombita floor is *less*, that's the risk.)
- **Downside.** Predict `2-0`, finishes `1-0` in 90'.
  `reg = 1`, `advance = 3`, and you'd have earned a clean sheet. Normal = `(1+3+1)×1.5 =
  7.5`; bombita floor = **4.5**. Betting and missing the exact costs you 3.
- **Bust.** Predict `2-1`, away wins → **0**.

## Selection, lock & reveal

- The bombita is a **💣 checkbox on the QF forecast form**, saved together with the
  prediction. Ticking it on a match designates that match as your bombita.
- **Movable until kickoff.** You may move your 💣 between QF matches that have not yet
  started. It becomes **final when the ticked match kicks off**. (This is the one point
  that softens the earlier "final once set" wording — a checkbox should be un-tickable
  until it locks.)
- **One bombita** total for the round. Ticking a new match moves it; you never have two.
- **Hidden** from other players until the bombita match kicks off, then revealed in the
  "everyone's picks" section alongside the prediction (same reveal rule as predictions via
  `othersVisible`).
- Server-enforced on save: target must be a `QUARTER_FINALS` match that has not kicked off,
  and the player must not already have a **locked** bombita (one whose match has started).

## Mandatory + penalty

Everyone must bet. The window to bombita *any* QF closes at the **last QF kickoff**.

- **Last QF match** = the `QUARTER_FINALS` match with the latest `kickoffUtc`; ties broken
  by lowest `matchId` so it is deterministic.
- If a player has **no bombita at all** by the time the last QF is scored, they take a
  **forced 0 on that last QF match** (they lose whatever they would have scored there).
- A player who bombita'd an *earlier* QF has a bombita, so no penalty — their last QF
  scores normally.

## Data model

Add one nullable column to the existing `bonusPicks` table (one row per user), mirroring
`championTeam` / `goldenBootPlayer`:

```
bonusPicks.bombitaMatchId: integer  // nullable, references matches.id
```

No new table. Updatable while the referenced match has not kicked off; effectively final
afterwards (enforced by the save action + read-time lock check).

## Scoring implementation

**Pure function** (co-located with knockout scoring, e.g. `knockout.ts`):

```ts
export function bombitaMatchPoints(
  normalTotal: number,
  mult: number,
  bd: KnockoutBreakdown,
): number {
  if (bd.reg === 3) return normalTotal * 2; // exact 90' -> jackpot
  if (bd.advance === 3) return 3 * mult;     // advancer only -> floor
  return 0;
}
```

**`computeStandings` integration** (knockout branch):

1. Compute `normalTotal = (bd.total + koCs + koCj) * koMult` (already there).
2. Compute `lastQfId` once per call: max-`kickoffUtc` QF match, tie → min id.
3. Determine this user's `bombitaMatchId` (from `BonusPickRow`).
4. Choose the match's contribution:
   - if `m.id === bombitaMatchId` → `bombitaMatchPoints(normalTotal, koMult, bd)`
   - else if `bombitaMatchId == null && m.id === lastQfId` → `0` (penalty)
   - else → `normalTotal`
5. Track the delta vs. `normalTotal` in a new `bonus.bombita` field for transparency, and
   include it in `bonus.total`.

`exact` / `outcomes` counts and `goalsOff` stay driven by the raw breakdown (unchanged),
so the bombita only moves points, not the accuracy stats.

**Context plumbing:** add `bombitaMatchId: number | null` to `BonusPickRow`. `lastQfId` is
derived inside `computeStandings` from the matches it already receives — no new ctx field.

## UI touchpoints

- **QF forecast form** (`KnockoutPredictionForm`): a 💣 checkbox.
  - Enabled + un-ticked on a not-started QF when you have no locked bombita.
  - Ticked (and movable) on your current tentative bombita.
  - Ticked + disabled (locked) once its match has kicked off.
  - Disabled on other matches once your bombita has locked.
- **Everyone's picks** (home page): once the bombita match kicks off, show a 💣 next to
  that player's pick for the match.
- **Leaderboard / player pages**: reflect the adjusted points automatically via
  `computeStandings`; the `bonus.bombita` delta feeds the existing "Bonus" column.

## Edge cases

- No prediction on the bombita match → breakdown is all zeros → 0 points (can't jackpot
  without a scoreline). The checkbox lives on the forecast form, so a tick implies a saved
  prediction.
- Bombita on the last QF match → treated as a bombita (not the penalty path).
- Two QF matches with identical kickoff → tie broken by lowest id for "last QF".
- Player sets 💣, then edits their scoreline before kickoff → allowed; bombita stays on the
  match, prediction updates as normal.

## Testing (TDD)

Pure function `bombitaMatchPoints`: jackpot (`reg 3`), floor (`advance 3, reg≠3`), bust,
and that jackpot beats floor when both could apply.

`computeStandings`: bombita jackpot doubles the match total; bombita floor pays `3×mult`
and discards outcome/bonus; bombita bust is 0; non-bombita QF matches unaffected; penalty
forces 0 on the last QF only for users with no bombita; a user who bombita'd an earlier QF
is not penalised; `bonus.bombita` delta reported and folded into `bonus.total`.

## Out of scope (YAGNI)

- Bombitas in SF / bronze / final (QF only for now).
- More than one bombita per round.
- Changing a *locked* bombita.
