# BOMBITA — QF double-or-nothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each player flag one quarter-final as their 💣 bombita — a double-or-nothing bet on the 90' scoreline that doubles their normal haul on a hit, pays a 3×multiplier floor for calling the advancer, and zero otherwise, with a forced-zero penalty for never betting.

**Architecture:** A pure scoring function derives the bombita payout from the existing `KnockoutBreakdown`. `computeStandings` applies it (and the no-bet penalty) inside its knockout branch. Storage is one nullable `bombitaMatchId` column on `bonusPicks`. The 💣 is a checkbox on the QF forecast form, saved through the existing `savePrediction` action, hidden from others until the match kicks off.

**Tech Stack:** Next.js (server components + server actions), Drizzle ORM + Neon Postgres (schema-first via `drizzle-kit push`), Vitest.

## Global Constraints

- Points are DERIVED on every render (never stored). No points migration.
- TDD: every function gets a failing test first (`npm test` = `vitest run`).
- Keep half-points — never round (`×1.5`, `×2.5` can yield `.5`).
- Bombita scoring tiers (highest wins): exact 90' (`breakdown.reg === 3`) → `normalTotal × 2`; else correct advancer (`breakdown.advance === 3`) → `3 × mult`; else `0`.
- "Normal match total" = `(knockoutPoints.total + cleanSheet + cojones) × stageMultiplier` (already shipped).
- Last QF = `QUARTER_FINALS` match with the latest `kickoffUtc`; ties broken by lowest `id`.
- QF only. One bombita per player. Movable between not-yet-started QFs; final when the ticked match kicks off.
- Commit after every task. This project commits directly to `main`; do not push unless the user asks.

---

## File Structure

- `src/lib/knockout.ts` — add `bombitaMatchPoints` pure function (co-located with knockout scoring).
- `src/lib/knockout.test.ts` — its tests.
- `src/lib/standings.ts` — add `lastQuarterFinalId` helper, `bombitaMatchId` on `BonusPickRow`, `bombita` on the bonus breakdown, and bombita+penalty scoring in the knockout branch.
- `src/lib/standings.test.ts` — scoring + penalty tests.
- `src/db/schema.ts` — add `bombitaMatchId` column to `bonusPicks`.
- `src/app/actions.ts` — `savePrediction` reads the `bombita` checkbox and sets/clears the pick.
- `src/lib/bonus.ts` — add `bombitaWindowOpen` pure helper (validation).
- `src/lib/bonus.test.ts` — its test.
- `src/components/KnockoutPredictionForm.tsx` — the 💣 checkbox.
- `src/components/MatchRow.tsx` — thread bombita props to the form; show 💣 in everyone's picks.
- `src/app/page.tsx` — load bonus picks, compute the current user's bombita state, thread props, set the reveal flag.

---

### Task 1: `bombitaMatchPoints` pure function

**Files:**
- Modify: `src/lib/knockout.ts` (append after `knockoutPoints`, near line 66)
- Test: `src/lib/knockout.test.ts`

**Interfaces:**
- Consumes: `KnockoutBreakdown` (already exported from `knockout.ts`).
- Produces: `bombitaMatchPoints(normalTotal: number, mult: number, bd: KnockoutBreakdown): number`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/knockout.test.ts` (import `bombitaMatchPoints` from `./knockout`):

```ts
describe("bombitaMatchPoints", () => {
  const bd = (over: Partial<KnockoutBreakdown>): KnockoutBreakdown =>
    ({ reg: 0, etReached: 0, etExact: 0, advance: 0, pens: 0, total: 0, ...over });

  it("doubles the normal total on an exact 90' score (reg 3)", () => {
    expect(bombitaMatchPoints(10.5, 1.5, bd({ reg: 3, advance: 3, total: 6 }))).toBe(21);
  });
  it("pays 3 x multiplier on the advancer floor when the 90' is not exact", () => {
    expect(bombitaMatchPoints(6, 1.5, bd({ reg: 1, advance: 3, total: 4 }))).toBe(4.5);
  });
  it("is zero when neither the exact 90' nor the advancer is hit", () => {
    expect(bombitaMatchPoints(6, 1.5, bd({ reg: 1, advance: 0, total: 1 }))).toBe(0);
  });
  it("keeps half-points from the doubled total", () => {
    expect(bombitaMatchPoints(10.5, 1.5, bd({ reg: 3, total: 7 }))).toBe(21);
  });
});
```

Ensure `KnockoutBreakdown` is imported in the test file: add it to the existing import from `./knockout`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/knockout.test.ts -t bombitaMatchPoints`
Expected: FAIL — `bombitaMatchPoints is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/knockout.ts`:

```ts
/**
 * BOMBITA payout for a single QF match. The bet is on the 90' scoreline:
 * exact 90' doubles the whole normal haul; otherwise you get a 3×multiplier
 * floor only if you called the advancer; else zero. Derived from the breakdown:
 * reg===3 means exact 90', advance===3 means the advancer was right.
 */
export function bombitaMatchPoints(normalTotal: number, mult: number, bd: KnockoutBreakdown): number {
  if (bd.reg === 3) return normalTotal * 2; // exact 90' -> jackpot
  if (bd.advance === 3) return 3 * mult;    // advancer only -> floor
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/knockout.test.ts -t bombitaMatchPoints`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/knockout.ts src/lib/knockout.test.ts
git commit -m "feat: bombitaMatchPoints — QF double-or-nothing payout"
```

---

### Task 2: Bombita scoring + no-bet penalty in `computeStandings`

**Files:**
- Modify: `src/lib/standings.ts` (add helper; extend `BonusPickRow`, `StandingRow.bonus`; edit the knockout branch and the pick lookup)
- Test: `src/lib/standings.test.ts`

**Interfaces:**
- Consumes: `bombitaMatchPoints` (Task 1); `stageMultiplier`, `cleanSheetBonus`, `cojonesBonus`, `knockoutPoints` (existing).
- Produces:
  - `lastQuarterFinalId(matches: { id: number; stage: string; kickoffUtc: Date }[]): number | null`
  - `BonusPickRow` gains optional `bombitaMatchId?: number | null`
  - `StandingRow.bonus` gains `bombita: number`

- [ ] **Step 1: Write the failing test for `lastQuarterFinalId`**

Add to `src/lib/standings.test.ts` (import `lastQuarterFinalId` from `./standings`):

```ts
describe("lastQuarterFinalId", () => {
  const mk = (id: number, iso: string) => ({ id, stage: "QUARTER_FINALS", kickoffUtc: new Date(iso) });
  it("picks the latest-kickoff QF", () => {
    expect(lastQuarterFinalId([mk(70, "2026-07-10T18:00:00Z"), mk(71, "2026-07-11T18:00:00Z")])).toBe(71);
  });
  it("breaks kickoff ties by lowest id", () => {
    expect(lastQuarterFinalId([mk(73, "2026-07-11T18:00:00Z"), mk(71, "2026-07-11T18:00:00Z")])).toBe(71);
  });
  it("is null when there are no QF matches", () => {
    expect(lastQuarterFinalId([{ id: 1, stage: "GROUP_STAGE", kickoffUtc: new Date("2026-06-11T18:00:00Z") }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/standings.test.ts -t lastQuarterFinalId`
Expected: FAIL — `lastQuarterFinalId is not a function`.

- [ ] **Step 3: Implement `lastQuarterFinalId`**

Add near the top of `src/lib/standings.ts` (after the imports, before `computeStandings`):

```ts
/** The last QF fixture (latest kickoff; ties → lowest id), or null if none. Drives the no-bet penalty. */
export function lastQuarterFinalId(matches: { id: number; stage: string; kickoffUtc: Date }[]): number | null {
  const qf = matches.filter((m) => m.stage === "QUARTER_FINALS");
  if (qf.length === 0) return null;
  let best = qf[0];
  for (const m of qf) {
    const t = m.kickoffUtc.getTime();
    const bt = best.kickoffUtc.getTime();
    if (t > bt || (t === bt && m.id < best.id)) best = m;
  }
  return best.id;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/standings.test.ts -t lastQuarterFinalId`
Expected: PASS (3 tests).

- [ ] **Step 5: Extend the types**

In `src/lib/standings.ts`, add the optional field to `BonusPickRow`:

```ts
export type BonusPickRow = {
  userId: number;
  championTeam: string | null;
  goldenBootPlayer: string | null;
  darkHorseTeam: string | null;
  bombitaMatchId?: number | null;
};
```

And add `bombita` to the bonus breakdown in `StandingRow`:

```ts
  bonus: { perMatch: number; champion: number; goldenBoot: number; darkHorse: number; bombita: number; total: number };
```

- [ ] **Step 6: Write the failing scoring tests**

Add a new describe block at the end of `src/lib/standings.test.ts`:

```ts
describe("computeStandings bombita", () => {
  const u = [{ id: 1, name: "A", username: "a" }];
  const FROM = new Date("2026-01-01");
  const qf = (id: number, iso: string, over: Record<string, unknown>) => ({
    id, stage: "QUARTER_FINALS", status: "FINISHED",
    kickoffUtc: new Date(iso), homeTeam: "X", awayTeam: "Y",
    homeScore: null, awayScore: null,
    regularTimeHome: null, regularTimeAway: null, etHome: null, etAway: null,
    extraTimeHome: null, extraTimeAway: null, duration: null, winner: null,
    ...over,
  });
  // Exact 2-1 home win in 90': knockout base = reg 3 + advance 3 = 6; no clean sheet, no cojones.
  const exactWin = (id: number, iso: string) =>
    qf(id, iso, { homeScore: 2, awayScore: 1, regularTimeHome: 2, regularTimeAway: 1, duration: "REGULAR", winner: "HOME_TEAM" });
  const pred = (matchId: number, h: number, a: number) =>
    ({ userId: 1, matchId, homeScore: h, awayScore: a, etHomeScore: null, etAwayScore: null, penAdvance: null });
  const ctx = (bombitaMatchId: number | null) => ({
    picks: [{ userId: 1, championTeam: null, goldenBootPlayer: null, darkHorseTeam: null, bombitaMatchId }],
    championTeam: null, goldenBootWinner: null, doubleMatchId: null, perMatchBonusFrom: FROM,
  });

  it("doubles the bombita match on an exact 90' (jackpot) and reports the delta", () => {
    const rows = computeStandings(u, [exactWin(70, "2026-07-10T18:00:00Z"), exactWin(71, "2026-07-11T18:00:00Z")],
      [pred(70, 2, 1)], ctx(70)); // bombita on QF #70 (not the last QF), no pred on #71
    expect(rows[0].points).toBe(18);        // normal 6 x1.5 = 9, doubled = 18
    expect(rows[0].bonus.bombita).toBe(9);  // delta over the normal 9
  });

  it("pays the 3 x mult floor when the bombita 90' is wrong but the advancer is right", () => {
    // Predict 3-0 home; actual 2-1 home in 90': reg=1 (not exact), advance=3.
    const m = qf(70, "2026-07-10T18:00:00Z", { homeScore: 2, awayScore: 1, regularTimeHome: 2, regularTimeAway: 1, duration: "REGULAR", winner: "HOME_TEAM" });
    const rows = computeStandings(u, [m as never, exactWin(71, "2026-07-11T18:00:00Z")], [pred(70, 3, 0)], ctx(70));
    expect(rows[0].points).toBe(4.5); // floor 3 x 1.5
  });

  it("is zero when the bombita misses both the score and the advancer", () => {
    // Predict 0-2 away; actual 2-1 home: reg=0, advance=0.
    const m = qf(70, "2026-07-10T18:00:00Z", { homeScore: 2, awayScore: 1, regularTimeHome: 2, regularTimeAway: 1, duration: "REGULAR", winner: "HOME_TEAM" });
    const rows = computeStandings(u, [m as never, exactWin(71, "2026-07-11T18:00:00Z")], [pred(70, 0, 2)], ctx(70));
    expect(rows[0].points).toBe(0);
  });

  it("forces a 0 on the last QF for a player who never set a bombita", () => {
    // No bombita; predicts both QFs exactly. #71 is the last QF -> forced 0. #70 scores normally (9).
    const rows = computeStandings(u, [exactWin(70, "2026-07-10T18:00:00Z"), exactWin(71, "2026-07-11T18:00:00Z")],
      [pred(70, 2, 1), pred(71, 2, 1)], ctx(null));
    expect(rows[0].points).toBe(9);          // 9 (QF#70) + 0 (QF#71 penalty)
    expect(rows[0].bonus.bombita).toBe(-9);  // the penalty delta on #71
  });

  it("does NOT penalise a player who bombita'd an earlier QF", () => {
    // Bombita on #70 (jackpot 18); #71 is the last QF but they have a bombita, so it scores normally (9).
    const rows = computeStandings(u, [exactWin(70, "2026-07-10T18:00:00Z"), exactWin(71, "2026-07-11T18:00:00Z")],
      [pred(70, 2, 1), pred(71, 2, 1)], ctx(70));
    expect(rows[0].points).toBe(27); // 18 + 9
  });
});
```

- [ ] **Step 7: Run the scoring tests, verify they fail**

Run: `npx vitest run src/lib/standings.test.ts -t "computeStandings bombita"`
Expected: FAIL — points are the un-adjusted normal totals; `bonus.bombita` is undefined.

- [ ] **Step 8: Implement the scoring + penalty**

In `src/lib/standings.ts`:

(a) Import the helpers — extend the existing imports:

```ts
import { cleanSheetBonus, cojonesBonus, goalsOff, predictionPoints } from "./scoring";
import { championPoints, darkHorsePoints, goldenBootPoints, stageMultiplier } from "./bonus";
import { bombitaMatchPoints, knockoutPoints, toKnockoutPrediction, toKnockoutResult } from "./knockout";
```

(b) At the top of `computeStandings`, after `const perMatchFrom = ...`, compute the last QF once:

```ts
  const lastQfId = lastQuarterFinalId(matches);
```

(c) Inside `users.map`, initialise a bombita accumulator and hoist the pick lookup ABOVE the match loop. Change the counters line and add `bombitaBonus`, then read the pick and its bombita id before the `for (const m of finished)` loop:

```ts
    let points = 0, exact = 0, outcomes = 0, off = 0, perMatchBonus = 0, bombitaBonus = 0;
    const pick = picksByUser.get(u.id);
    const bombitaMatchId = pick?.bombitaMatchId ?? null;
```

(Delete the later `const pick = picksByUser.get(u.id);` line that currently sits after the loop — it is now hoisted.)

(d) Replace the knockout-branch body (the block that currently computes `normalTotal`/`points += ...`) with:

```ts
        const bd = knockoutPoints(koPred, koResult);
        const koEligible = perMatchFrom !== null && m.kickoffUtc.getTime() >= perMatchFrom.getTime();
        const koCs = koEligible ? cleanSheetBonus(koPred?.reg ?? null, koResult.reg) : 0;
        const koCj = koEligible ? cojonesBonus(koPred?.reg ?? null, koResult.reg) : 0;
        const koMult = stageMultiplier(m.stage);
        const normalTotal = (bd.total + koCs + koCj) * koMult;

        let contribution = normalTotal;
        if (bombitaMatchId === m.id) {
          contribution = bombitaMatchPoints(normalTotal, koMult, bd); // double-or-nothing on this match
          bombitaBonus += contribution - normalTotal;
        } else if (bombitaMatchId == null && m.id === lastQfId) {
          contribution = 0; // never bet -> forced 0 on the last QF
          bombitaBonus += contribution - normalTotal;
        }

        points += contribution;
        perMatchBonus += (koCs + koCj) * koMult; // normal bonus part (bombita delta is tracked separately)
        if (bd.reg === 3) exact++;
        else if (bd.reg === 1) outcomes++;
        off += goalsOff(koPred?.reg ?? null, koResult.reg) ?? 0;
        continue;
```

(e) Update the bonus total + returned row to include `bombita`:

```ts
    const bonusTotal = perMatchBonus + champion + goldenBoot + darkHorse + bombitaBonus;

    return {
      userId: u.id, name: u.name, username: u.username,
      points, exact, outcomes, goalsOff: off,
      bonus: { perMatch: perMatchBonus, champion, goldenBoot, darkHorse, bombita: bombitaBonus, total: bonusTotal },
      rank: 0,
    };
```

- [ ] **Step 9: Run the full standings suite, verify green**

Run: `npx vitest run src/lib/standings.test.ts`
Expected: PASS (existing + new bombita tests).

- [ ] **Step 10: Typecheck (other files read `bonus.*`), then commit**

Run: `npx tsc --noEmit`
Expected: no errors. (The player page reads `standing.bonus.total`; the new `bombita` field is additive.)

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "feat: apply bombita scoring and the no-bet penalty in standings"
```

---

### Task 3: Persist the bombita — schema column, validation helper, and the save action

**Files:**
- Modify: `src/db/schema.ts` (add column), then `npm run db:push`
- Modify: `src/lib/bonus.ts` (add `bombitaWindowOpen`)
- Test: `src/lib/bonus.test.ts`
- Modify: `src/app/actions.ts` (`savePrediction`)

**Interfaces:**
- Produces: `bombitaWindowOpen(match: { stage: string; kickoffUtc: Date }, now: Date): boolean`
- Produces: `savePrediction` sets/clears `bonusPicks.bombitaMatchId` from the `bombita` form field.

- [ ] **Step 1: Add the schema column**

In `src/db/schema.ts`, add to `bonusPicks`:

```ts
export const bonusPicks = pgTable("bonus_picks", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  championTeam: text("champion_team"),
  goldenBootPlayer: text("golden_boot_player"),
  darkHorseTeam: text("dark_horse_team"),
  bombitaMatchId: integer("bombita_match_id").references(() => matches.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Push the schema to the database**

Run: `npm run db:push`
Expected: drizzle-kit reports adding `bombita_match_id` to `bonus_picks`; confirm/apply. No data loss (nullable column).

- [ ] **Step 3: Write the failing test for `bombitaWindowOpen`**

Add to `src/lib/bonus.test.ts` (import `bombitaWindowOpen`):

```ts
describe("bombitaWindowOpen", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  it("is open for a QF match that has not kicked off", () => {
    expect(bombitaWindowOpen({ stage: "QUARTER_FINALS", kickoffUtc: new Date("2026-07-10T18:00:00Z") }, now)).toBe(true);
  });
  it("is closed once the QF match has kicked off", () => {
    expect(bombitaWindowOpen({ stage: "QUARTER_FINALS", kickoffUtc: new Date("2026-07-10T10:00:00Z") }, now)).toBe(false);
  });
  it("is closed for non-QF stages", () => {
    expect(bombitaWindowOpen({ stage: "SEMI_FINALS", kickoffUtc: new Date("2026-07-14T18:00:00Z") }, now)).toBe(false);
  });
});
```

- [ ] **Step 4: Run it, verify it fails**

Run: `npx vitest run src/lib/bonus.test.ts -t bombitaWindowOpen`
Expected: FAIL — `bombitaWindowOpen is not a function`.

- [ ] **Step 5: Implement `bombitaWindowOpen`**

Append to `src/lib/bonus.ts`:

```ts
/** You may set/move a bombita only onto a QF match that has not yet kicked off. */
export function bombitaWindowOpen(match: { stage: string; kickoffUtc: Date }, now: Date): boolean {
  return match.stage === "QUARTER_FINALS" && now.getTime() < match.kickoffUtc.getTime();
}
```

- [ ] **Step 6: Run it, verify it passes**

Run: `npx vitest run src/lib/bonus.test.ts -t bombitaWindowOpen`
Expected: PASS (3 tests).

- [ ] **Step 7: Wire the save action**

In `src/app/actions.ts`, extend the imports:

```ts
import { GOLDEN_BOOT_CANDIDATES, bombitaWindowOpen, picksDeadlinePassed, UNDERDOG_TEAMS } from "@/lib/bonus";
```

In `savePrediction`, after the existing prediction upsert (after the `.onConflictDoUpdate({...})` block and before `revalidatePath("/")`), add:

```ts
  // 💣 bombita: a QF-only flag saved with the forecast. Set/move it while the match is open
  // and your current bombita has not locked (its match has not kicked off).
  if (bombitaWindowOpen(match, new Date())) {
    const wantsBombita = String(formData.get("bombita") ?? "") === "on";
    const existing = await db.query.bonusPicks.findFirst({ where: eq(bonusPicks.userId, user.id) });
    const curId = existing?.bombitaMatchId ?? null;
    let curLocked = false;
    if (curId !== null) {
      const curMatch = await db.query.matches.findFirst({ where: eq(matches.id, curId) });
      curLocked = !!curMatch && new Date().getTime() >= curMatch.kickoffUtc.getTime();
    }
    if (!curLocked) {
      const next = wantsBombita ? matchId : curId === matchId ? null : curId;
      await db.insert(bonusPicks)
        .values({ userId: user.id, bombitaMatchId: next, updatedAt: new Date() })
        .onConflictDoUpdate({ target: bonusPicks.userId, set: { bombitaMatchId: next, updatedAt: new Date() } });
    }
  }
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Run the full suite + lint**

Run: `npx vitest run && npm run lint`
Expected: all pass, lint clean.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.ts src/lib/bonus.ts src/lib/bonus.test.ts src/app/actions.ts
git commit -m "feat: persist the bombita pick via the QF forecast save"
```

---

### Task 4: 💣 checkbox on the forecast form + thread state from the page

**Files:**
- Modify: `src/components/KnockoutPredictionForm.tsx` (add checkbox + props)
- Modify: `src/components/MatchRow.tsx` (add props, pass through)
- Modify: `src/app/page.tsx` (load bonus picks, compute current-user bombita state, pass props)

**Interfaces:**
- Consumes: nothing new (uses `savePrediction` field `bombita`).
- Produces: `KnockoutPredictionForm` accepts `showBombita?: boolean`, `bombitaChecked?: boolean`, `bombitaDisabled?: boolean`.

- [ ] **Step 1: Add the checkbox to `KnockoutPredictionForm`**

Extend `Props` in `src/components/KnockoutPredictionForm.tsx`:

```ts
  penAdvance: "HOME" | "AWAY" | null;
  showBombita?: boolean;
  bombitaChecked?: boolean;
  bombitaDisabled?: boolean;
```

Add controlled state (after the `pen` state line):

```ts
  const [bombita, setBombita] = useState(!!p.bombitaChecked);
```

Render the checkbox — insert just before the `{state?.error && ...}` line:

```tsx
      {p.showBombita && (
        <label className={`flex items-center gap-1.5 text-xs ${p.bombitaDisabled ? "opacity-50" : "cursor-pointer"}`}>
          <input
            type="checkbox" name="bombita" checked={bombita} disabled={p.bombitaDisabled}
            onChange={(e) => setBombita(e.target.checked)}
          />
          <span className="font-semibold">💣 Bombita</span>
          <span className="text-zinc-500">— doble o nada en los 90&apos;</span>
        </label>
      )}
```

- [ ] **Step 2: Thread props through `MatchRow`**

In `src/components/MatchRow.tsx`, add to `Props` (after `finalScoreLabel`):

```ts
  /** Current user's bombita state for this QF match. */
  bombitaChecked?: boolean;
  bombitaDisabled?: boolean;
```

Add to the destructured params list:

```ts
  knockout, stage, mineEtHome, mineEtAway, minePenAdvance, finalScoreLabel,
  bombitaChecked, bombitaDisabled,
```

Pass to the form (in the `knockout ?` branch):

```tsx
            <KnockoutPredictionForm
              matchId={matchId} homeTeam={homeTeam} awayTeam={awayTeam} stage={stage ?? ""}
              home={mine?.home ?? null} away={mine?.away ?? null}
              etHome={mineEtHome ?? null} etAway={mineEtAway ?? null} penAdvance={minePenAdvance ?? null}
              showBombita={stage === "QUARTER_FINALS"}
              bombitaChecked={bombitaChecked} bombitaDisabled={bombitaDisabled}
            />
```

- [ ] **Step 3: Load bombita state in `page.tsx` and pass it to each match**

In `src/app/page.tsx`, load the current user's bonus pick alongside the existing queries. Find the `Promise.all([...])` (or the sequential `db.query...` calls) that fetch matches/predictions/users/meta and add:

```ts
  const myBonus = await db.query.bonusPicks.findFirst({ where: eq(bonusPicks.userId, user.id) });
```

Import `bonusPicks` from `@/db/schema` (extend the existing schema import) and ensure `eq` is imported from `drizzle-orm`.

Compute the current user's bombita lock state once (after loading `allMatches`/`now`):

```ts
  const myBombitaId = myBonus?.bombitaMatchId ?? null;
  const myBombitaMatch = myBombitaId !== null ? allMatches.find((m) => m.id === myBombitaId) : null;
  const myBombitaLocked = !!myBombitaMatch && now.getTime() >= myBombitaMatch.kickoffUtc.getTime();
```

In `renderMatch`, pass the two props on the `<MatchRow ... />` (only meaningful for QF; the form gates on `showBombita`):

```tsx
        bombitaChecked={m.id === myBombitaId}
        bombitaDisabled={myBombitaLocked}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, lint clean.

- [ ] **Step 5: Manual smoke (drive the real app)**

Run: `npm run dev`, log in, open a QF match's forecast. Verify: the 💣 checkbox shows only on QF matches; ticking + Save persists (reopen shows it checked); ticking a second QF moves it (first unchecks); once a bombita match kicks off, the checkbox on other open QFs is disabled.

- [ ] **Step 6: Commit**

```bash
git add src/components/KnockoutPredictionForm.tsx src/components/MatchRow.tsx src/app/page.tsx
git commit -m "feat: 💣 bombita checkbox on the QF forecast form"
```

---

### Task 5: Reveal the 💣 in everyone's picks after kickoff

**Files:**
- Modify: `src/components/MatchRow.tsx` (`OtherPred` type + render)
- Modify: `src/app/page.tsx` (load all picks; set the reveal flag)

**Interfaces:**
- Produces: `OtherPred` gains `bombita?: boolean`.

- [ ] **Step 1: Add the field to `OtherPred` and render it**

In `src/components/MatchRow.tsx`, extend `OtherPred`:

```ts
  detail?: string | null;
  /** True once this match kicked off and this player had it as their bombita. */
  bombita?: boolean;
```

In the everyone's-picks list item, add a 💣 badge next to the score (after the `{o.pts !== null && <Badge v={o.pts} />}` line, still inside the flex row):

```tsx
                  {o.bombita && <span title="Bombita">💣</span>}
```

- [ ] **Step 2: Set the reveal flag in `page.tsx`**

In `src/app/page.tsx`, the `others` array is only built when `othersVisible(m, now)` (post-kickoff), so revealing there is automatically correctly timed. Load every player's bombita pick once (near the other top-level queries):

```ts
  const allBonus = await db.query.bonusPicks.findMany();
  const bombitaByUser = new Map(allBonus.map((b) => [b.userId, b.bombitaMatchId ?? null]));
```

In the `others = allUsers.map((u) => { ... })` object, add:

```ts
          bombita: bombitaByUser.get(u.id) === m.id,
```

(Reuse `allBonus` for the current user's pick from Task 4 instead of a second query if convenient: `const myBonus = allBonus.find((b) => b.userId === user.id);`.)

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, lint clean.

- [ ] **Step 4: Manual smoke**

With a QF match kicked off (or temporarily set a QF's kickoff in the past via the admin/DB), expand "everyone's picks" and confirm the 💣 appears next to the players who bombita'd that match, and does NOT appear before kickoff.

- [ ] **Step 5: Commit**

```bash
git add src/components/MatchRow.tsx src/app/page.tsx
git commit -m "feat: reveal each player's 💣 bombita once the match kicks off"
```

---

## Notes / accepted limitations

- Per-match **Pts** cells on the home/player pages keep showing the *normal* knockout points, not the bombita-adjusted value — the same convention already used for group-stage bonuses (cells show base, bonuses roll into the leaderboard total). The bombita swing is visible in the leaderboard "Bonus" column via `bonus.bombita`. Revisit only if the group finds it confusing.
- The no-bet penalty resolves at scoring time: it applies once the last QF is finished and the player still has `bombitaMatchId === null`.

## Self-Review

- **Spec coverage:** scoring tiers → Task 1 + Task 2; storage column → Task 3; per-match lock + movable + QF-only validation → Task 3 (`bombitaWindowOpen` + action) + Task 4 (disabled state); hidden-until-kickoff reveal → Task 5; penalty → Task 2; 💣 checkbox on forecast → Task 4; `bonus.bombita` breakdown → Task 2. All spec sections map to a task.
- **Placeholder scan:** none — every step has concrete code and exact commands.
- **Type consistency:** `bombitaMatchPoints(normalTotal, mult, bd)` defined in Task 1 and called with the same signature in Task 2; `BonusPickRow.bombitaMatchId` (optional) defined in Task 2 and set in Task 3; `bombitaWindowOpen(match, now)` defined and consumed in Task 3; `showBombita/bombitaChecked/bombitaDisabled` defined in Task 4 form and passed from MatchRow/page; `OtherPred.bombita` defined and set in Task 5.
