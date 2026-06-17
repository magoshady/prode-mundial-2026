# Goals-Off Accuracy Stat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "goals off" accuracy counter — the total absolute goal difference between each player's predictions and the real scores — shown on the leaderboard and player detail page.

**Architecture:** A new pure function `goalsOff` in the existing scoring module, summed per-user inside `computeStandings` (new `StandingRow` field, no effect on ranking), and surfaced as a leaderboard column and a per-match column + summary total on the player page.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript, Drizzle ORM, Vitest, Tailwind.

## Global Constraints

- Test runner: `npm test` (vitest run). Run a single file with `npx vitest run <path>`.
- The stat is **informational only** — it must NOT change leaderboard sort order or rank assignment.
- Missing predictions are **skipped** (contribute nothing), never penalized.
- `goalsOff(pred, result)` returns `null` for a missing prediction, a number otherwise.
- Leaderboard column header: `Goal Acc.` with a caption stating lower is better.
- Spec: `docs/superpowers/specs/2026-06-18-goals-off-accuracy-design.md`.

---

## File Structure

- `src/lib/scoring.ts` — add pure `goalsOff` function (alongside `predictionPoints`).
- `src/lib/scoring.test.ts` — tests for `goalsOff`.
- `src/lib/standings.ts` — add `goalsOff` field to `StandingRow`, accumulate it.
- `src/lib/standings.test.ts` — assert summing + skip-missing + rank unaffected.
- `src/app/leaderboard/page.tsx` — new column + caption.
- `src/app/player/[username]/page.tsx` — per-match column + summary total.

---

### Task 1: `goalsOff` pure function

**Files:**
- Modify: `src/lib/scoring.ts`
- Test: `src/lib/scoring.test.ts`

**Interfaces:**
- Consumes: existing `ScorePair` type from `scoring.ts`.
- Produces: `goalsOff(pred: ScorePair | null | undefined, result: ScorePair): number | null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/scoring.test.ts` (it already imports from `./scoring`):

```ts
import { goalsOff } from "./scoring";

describe("goalsOff", () => {
  it("sums absolute goal differences for both teams", () => {
    expect(goalsOff({ home: 1, away: 0 }, { home: 2, away: 1 })).toBe(2); // Martin example 1
    expect(goalsOff({ home: 1, away: 1 }, { home: 0, away: 0 })).toBe(2); // Martin example 2
  });
  it("is 0 for an exact prediction", () => {
    expect(goalsOff({ home: 3, away: 1 }, { home: 3, away: 1 })).toBe(0);
  });
  it("returns null for a missing prediction (skipped, not zero)", () => {
    expect(goalsOff(null, { home: 1, away: 0 })).toBeNull();
    expect(goalsOff(undefined, { home: 1, away: 0 })).toBeNull();
  });
});
```

Note: add `goalsOff` to the existing top import line if you prefer one import; a second `import { goalsOff }` is also fine for vitest.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scoring.test.ts`
Expected: FAIL — `goalsOff is not a function` / no export named `goalsOff`.

- [ ] **Step 3: Implement `goalsOff`**

Append to `src/lib/scoring.ts`:

```ts
/** Total goals away from reality: |Δhome| + |Δaway|. null when no prediction (skipped). */
export function goalsOff(pred: ScorePair | null | undefined, result: ScorePair): number | null {
  if (!pred) return null;
  return Math.abs(pred.home - result.home) + Math.abs(pred.away - result.away);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/scoring.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring.ts src/lib/scoring.test.ts
git commit -m "feat: add goalsOff scoring function"
```

---

### Task 2: Accumulate `goalsOff` in standings

**Files:**
- Modify: `src/lib/standings.ts`
- Test: `src/lib/standings.test.ts`

**Interfaces:**
- Consumes: `goalsOff` from Task 1.
- Produces: `StandingRow` now includes `goalsOff: number`.

- [ ] **Step 1: Write the failing test**

Append a new `it` inside the existing `describe("computeStandings", ...)` in `src/lib/standings.test.ts`:

```ts
it("sums goals off, skips missing picks, and leaves rank unaffected", () => {
  const rows = computeStandings(users, [m(10, 2, 0), m(11, 1, 1)], [
    p(1, 10, 2, 0), p(1, 11, 0, 0), // A: off 0 + (|0-1|+|0-1|)=2 -> 2
    p(2, 10, 1, 0), p(2, 11, 1, 1), // B: off (|1-2|+0)=1 + 0 -> 1
    p(3, 10, 0, 1),                 // C: off (|0-2|+|1-0|)=3; match 11 missing -> skipped -> 3
  ]);
  const byUser = Object.fromEntries(rows.map((r) => [r.username, r.goalsOff]));
  expect(byUser).toEqual({ a: 2, b: 1, c: 3 });
  // Ranking still by points: A and B tie at 4 pts/1 exact, C last. goalsOff must not reorder.
  expect(rows.map((r) => r.points)).toEqual([4, 4, 0]);
  expect(rows[2].username).toBe("c");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/standings.test.ts`
Expected: FAIL — `byUser` values undefined (no `goalsOff` field yet).

- [ ] **Step 3: Implement the field**

In `src/lib/standings.ts`:

Add the import:
```ts
import { goalsOff, predictionPoints } from "./scoring";
```
(replacing the existing `import { predictionPoints } from "./scoring";`)

Add to the `StandingRow` type, after `outcomes`:
```ts
  goalsOff: number; // total |Δgoals|, informational only — does not affect rank
```

In the per-user loop, change the accumulator declarations and body. Replace:
```ts
    let points = 0, exact = 0, outcomes = 0;
    for (const m of finished) {
      const p = byUserMatch.get(`${u.id}:${m.id}`);
      const pts = predictionPoints(
        p ? { home: p.homeScore, away: p.awayScore } : null,
        { home: m.homeScore!, away: m.awayScore! },
      );
      points += pts;
      if (pts === 3) exact++;
      if (pts === 1) outcomes++;
    }
    return { userId: u.id, name: u.name, username: u.username, points, exact, outcomes, rank: 0 };
```
with:
```ts
    let points = 0, exact = 0, outcomes = 0, off = 0;
    for (const m of finished) {
      const p = byUserMatch.get(`${u.id}:${m.id}`);
      const pred = p ? { home: p.homeScore, away: p.awayScore } : null;
      const result = { home: m.homeScore!, away: m.awayScore! };
      const pts = predictionPoints(pred, result);
      points += pts;
      if (pts === 3) exact++;
      if (pts === 1) outcomes++;
      off += goalsOff(pred, result) ?? 0;
    }
    return { userId: u.id, name: u.name, username: u.username, points, exact, outcomes, goalsOff: off, rank: 0 };
```

Leave the `rows.sort(...)` and rank-assignment lines unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/standings.test.ts`
Expected: PASS (including pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "feat: track goalsOff total per player in standings"
```

---

### Task 3: Leaderboard column

**Files:**
- Modify: `src/app/leaderboard/page.tsx`

**Interfaces:**
- Consumes: `StandingRow.goalsOff` from Task 2.
- Produces: UI only.

- [ ] **Step 1: Add the caption under the title**

In `src/app/leaderboard/page.tsx`, replace:
```tsx
        <h1 className="mb-4 text-xl font-bold">Leaderboard</h1>
```
with:
```tsx
        <h1 className="mb-1 text-xl font-bold">Leaderboard</h1>
        <p className="mb-4 text-xs text-zinc-500">Goal Acc. = total goals off from the real scores (lower is better).</p>
```

- [ ] **Step 2: Add the header cell**

Add after the `Points` header `<th>`:
```tsx
              <th className="px-2 py-2 text-right">Goal Acc.</th>
```

- [ ] **Step 3: Add the body cell**

Add after the Points body `<td>` (the one rendering `{r.points}`):
```tsx
                  <td className="px-2 py-3 text-right text-zinc-400">{r.goalsOff}</td>
```

- [ ] **Step 4: Verify build/types**

Run: `npx tsc --noEmit`
Expected: no errors. (Optional manual check: `npm run dev` and view `/leaderboard`.)

- [ ] **Step 5: Commit**

```bash
git add src/app/leaderboard/page.tsx
git commit -m "feat: show Goal Acc. column on leaderboard"
```

---

### Task 4: Player detail page — per-match + total

**Files:**
- Modify: `src/app/player/[username]/page.tsx`

**Interfaces:**
- Consumes: `goalsOff` from Task 1.
- Produces: UI only.

- [ ] **Step 1: Import `goalsOff`**

Replace:
```ts
import { predictionPoints } from "@/lib/scoring";
```
with:
```ts
import { goalsOff, predictionPoints } from "@/lib/scoring";
```

- [ ] **Step 2: Accumulate the total and per-row value**

Replace the rows-building block:
```ts
  let total = 0, exact = 0, outcomes = 0;
  const rows = visible.map((m) => {
    const pred = predByMatch.get(m.id) ?? null;
    const pts = isScoreable(m)
      ? predictionPoints(pred ? { home: pred.homeScore, away: pred.awayScore } : null, { home: m.homeScore!, away: m.awayScore! })
      : null;
    total += pts ?? 0;
    if (pts === 3) exact++;
    if (pts === 1) outcomes++;
    return { m, pred, pts };
  });
```
with:
```ts
  let total = 0, exact = 0, outcomes = 0, offTotal = 0;
  const rows = visible.map((m) => {
    const pred = predByMatch.get(m.id) ?? null;
    const predPair = pred ? { home: pred.homeScore, away: pred.awayScore } : null;
    const scoreable = isScoreable(m);
    const result = { home: m.homeScore!, away: m.awayScore! };
    const pts = scoreable ? predictionPoints(predPair, result) : null;
    const off = scoreable ? goalsOff(predPair, result) : null;
    total += pts ?? 0;
    if (pts === 3) exact++;
    if (pts === 1) outcomes++;
    offTotal += off ?? 0;
    return { m, pred, pts, off };
  });
```

- [ ] **Step 3: Add total to the summary line**

Replace:
```tsx
          {total} pts · {exact} exact · {outcomes} outcomes · played matches only
```
with:
```tsx
          {total} pts · {exact} exact · {outcomes} outcomes · {offTotal} goals off · played matches only
```

- [ ] **Step 4: Add the per-match column header**

Add after the `Pts` header `<th>`:
```tsx
              <th className="px-2 py-2 text-right">Off</th>
```

- [ ] **Step 5: Add the per-match body cell**

In the `rows.map` destructure, change `{({ m, pred, pts }) =>` to `{({ m, pred, pts, off }) =>`. Then add after the Pts body `<td>` (the one closing after the points `<span>`):
```tsx
                <td className="px-2 py-3 text-right text-zinc-400">{off !== null ? off : "—"}</td>
```

- [ ] **Step 6: Verify build/types**

Run: `npx tsc --noEmit`
Expected: no errors. (Optional manual check: `npm run dev` and view a `/player/<username>` page.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/player/[username]/page.tsx"
git commit -m "feat: show goals-off per match and total on player page"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all suites pass (scoring, standings, rules).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors.
