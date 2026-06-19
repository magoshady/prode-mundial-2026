# Bonus Scoring — Design

Date: 2026-06-20
Status: Approved (pending spec review)

## Goal

Add new ways to earn points, with near-zero extra effort for players. Two are
scored automatically from the per-match score predictions friends already submit
(Clean Sheet, Cojones). Three are one-time set-and-forget picks made before the
tournament starts (Champion, Golden Boot, Dark Horse), surfaced in a new **BONUS** tab.
A sixth feature — a **secret double-points game** — requires no player input at all.

All bonus points roll into the **existing leaderboard total** — there is no separate
ranking.

## Scoring rules

### Clean Sheet (automatic, per match)
For each side a player correctly predicts to concede zero, award +1.

- Home keeps a clean sheet when the away team scores 0: `pred.away === 0 && result.away === 0` → +1
- Away keeps a clean sheet when the home team scores 0: `pred.home === 0 && result.home === 0` → +1
- A correctly-called **0-0** therefore earns **+2**.

Independent of and stacks on top of the existing exact/outcome points.

### Cojones (automatic, per match)
Rewards ballsy exact-score calls. **Applies only when the prediction is an exact-score
hit** (the existing +3). Bonus scales with the total goals scored in the match
(`result.home + result.away`):

| Total goals | Cojones bonus |
|---|---|
| 0–3 | +0 |
| 4–6 | +1 |
| 7+  | +2 |

Example: predict 4-3 and it finishes 4-3 → 3 (exact) + 2 (cojones) = **5**.
Predict 1-0 and it finishes 1-0 → 3 + 0 = **3**.

### Champion (one-time pick)
+5 if the player's picked team wins the cup. Resolved against the admin-entered
`champion_team` value (see "Resolving results").

### Golden Boot (one-time pick)
+3 if the player's picked player is the tournament top scorer. Picked from a curated
shortlist (~35 names). Resolved against the admin-entered `golden_boot_winner` value.

### Dark Horse (one-time pick, from a curated underdog pool)
Cumulative — the player earns every threshold their picked team reaches:

| Achievement | Stage reached | Points |
|---|---|---|
| Pass group stage | reaches `LAST_32` | +2 |
| Pass 16vos (R32) | reaches `LAST_16` | +2 |
| Pass 8vos (R16)  | reaches `QUARTER_FINALS` | +3 |
| Pass 4tos (QF)   | reaches `SEMI_FINALS` | +3 |
| Pass Semis       | reaches `FINAL` | +5 |
| Wins the Final   | is `champion_team` | +10 |

Maximum 25 points. "Reaches stage X" = the team appears as home or away in any match of
stage X (auto-derived from the synced `matches` table; immune to penalty-shootout
ambiguity). "Wins the Final" uses the admin-entered `champion_team`.

### Secret double-points game (no player input)
Exactly **one** match — chosen at random from the **final round of the group stage**
(matchday 3: 24 games, played 2026-06-24 → 06-28) — is worth **double points**. The
selection is made once, automatically, and kept **secret**: it is never displayed
anywhere until that match is `FINISHED`, at which point a "⭐ DOBLE PUNTOS" badge appears
on it and everyone learns it after the fact.

- **What doubles:** the player's entire haul on that match ×2 — base prediction points
  (3/1) **and** the clean-sheet and cojones bonuses earned on it.
- **When it's picked:** once, before the first matchday-3 game kicks off (06-24). The
  pick is idempotent — set only if not already set — so it can never shift based on
  results or be re-rolled.
- **Secrecy:** stored as a single `meta` value, never surfaced by any page (including
  admin) until the match is finished. The selection routine does not log which match it
  chose. Caveat: a determined admin with direct database access could query the value;
  honoring "don't tell me" relies on not doing so. This is acceptable for a private
  friends' league.

## Picks: locking and editability

The three picks lock at **first kickoff** — `min(kickoffUtc)` across all matches.
Before that moment picks are freely editable; after it the BONUS page renders them
read-only. Enforced server-side in the save action, not just the UI.

## Resolving results

- **Champion / Dark Horse stage thresholds** auto-resolve from the `matches` table.
- **Wins the Final (+10) and Champion (+5)** depend on the actual winner. Because a
  final decided on penalties leaves `homeScore === awayScore` in our DB (we store only
  the regulation/full-time score), the champion is taken from an admin-entered
  `meta` key `champion_team` rather than inferred — bulletproof, entered once.
- **Golden Boot** resolves from an admin-entered `meta` key `golden_boot_winner`
  (the free-tier `/scorers` endpoint is rate-limited and lags; one manual entry at the
  end is simpler and reliable).

Admin enters two values at tournament end (`champion_team`, `golden_boot_winner`) via
the existing admin page.

## Data model

New table `bonus_picks` (one row per user):

```
bonus_picks
  userId            integer  PK, references users.id
  championTeam      text     null
  goldenBootPlayer  text     null
  darkHorseTeam     text     null
  updatedAt         timestamptz not null default now()
```

New `meta` keys: `champion_team`, `golden_boot_winner`, `double_match_id`.

## Curated lists

New `src/lib/bonus.ts` exports two constants (using the exact team/player name strings
the football-data.org API emits, since resolution matches against the `matches` table):

- `UNDERDOG_TEAMS` — the Dark Horse selectable pool, confirmed against the live 48-team
  field:

  ```
  Morocco, Croatia, Uruguay, Colombia, Japan, Senegal, Mexico, United States,
  Switzerland, South Korea, Ecuador, Norway, Turkey, Ivory Coast, Egypt, Australia
  ```

- `GOLDEN_BOOT_CANDIDATES: string[]` — the Golden Boot shortlist (~35 names). **Stub**;
  the user fills real names. Must match the player-name strings used by the eventual
  `golden_boot_winner` admin entry.

Champion is picked from the distinct team names already present in the `matches` table
(all 48 appear in the group stage), so it needs no constant.

## Code structure

Pure, unit-tested functions; aggregation in `standings.ts`; thin UI/server-action layer.

- **`src/lib/scoring.ts`** — add `cojonesBonus(pred, result)` and
  `cleanSheetBonus(pred, result)` alongside the existing `predictionPoints`/`goalsOff`.
- **`src/lib/bonus.ts`** — curated constants, the Dark Horse stage→points map, and pure
  resolvers: `championPoints(pick, championTeam)`, `goldenBootPoints(pick, winner)`,
  `darkHorsePoints(pick, reachedStages: Set<string>, wonFinal: boolean)`.
- **`src/lib/double.ts`** — the secret double-points helpers: `lastRoundCandidates(matches)`
  (matchday-3 group-stage games), `pickDoubleMatch(candidates, rng)` (pure selection
  given an RNG), and `isDoubleRevealed(matchId, doubleMatchId, status)` (true only once
  the chosen match is `FINISHED`).
- **`scripts/pick-double.ts`** — one-shot routine: if `double_match_id` is unset and no
  matchday-3 game has kicked off, randomly select one and write it to `meta`. Logs only
  "double game sealed" — never the chosen match. Run once during setup.
- **`src/lib/standings.ts`** — `computeStandings` extended to accept `bonus_picks`, the
  three meta values, and `double_match_id`, folding clean-sheet, cojones, the three picks,
  and the ×2 multiplier (applied to base + clean-sheet + cojones on the double match) into
  each player's `points`. Add a per-category bonus breakdown to `StandingRow` for the
  BONUS page.
- **`src/db/schema.ts`** — `bonus_picks` table.
- **`src/app/bonus/page.tsx`** — new BONUS tab: three pick dropdowns (Champion = all
  teams; Golden Boot = shortlist; Dark Horse = underdog pool), locked after first
  kickoff; a rules panel explaining all five bonuses; the signed-in player's bonus-point
  breakdown.
- **`src/components/Nav.tsx`** — add the `BONUS` nav link.
- **`src/components/MatchRow.tsx`** — show a "⭐ DOBLE PUNTOS" badge when
  `isDoubleRevealed` is true (chosen match, finished); nothing before that.
- **`src/app/actions.ts`** — `saveBonusPicks(formData)` server action: rejects edits
  after lock, upserts the current user's `bonus_picks` row.
- **`src/app/admin/page.tsx`** + admin action — inputs for `champion_team` and
  `golden_boot_winner`. Does **not** surface `double_match_id`.

## Testing

- `scoring.test.ts` — cojones bands (boundaries at 3/4, 6/7; non-exact hits get +0) and
  clean-sheet cases (single side, nailed 0-0 = +2, predicted-0-but-conceded = +0).
- `bonus.test.ts` (new) — champion/golden-boot match vs miss; dark-horse cumulative
  totals at each stage and the full 25-point run; no points for a team that didn't
  advance.
- `double.test.ts` (new) — `lastRoundCandidates` filters to matchday-3 group games;
  `pickDoubleMatch` is deterministic given a seeded RNG and always returns a candidate;
  `isDoubleRevealed` is false until the chosen match is `FINISHED`.
- `standings.test.ts` — bonuses fold correctly into the leaderboard total; the double
  match multiplies base + clean-sheet + cojones ×2; players with no picks are unaffected.

## Out of scope

- Live `/scorers` / `/standings` API integration (admin manual entry instead).
- Editing picks after lock; partial credit for Champion/Golden Boot.
- Separate bonus-only leaderboard.
- Cryptographic secrecy of the double-match pick (private league; honor-system instead).
