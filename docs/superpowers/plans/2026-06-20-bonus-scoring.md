# Bonus Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five point-earning bonuses (Clean Sheet, Cojones, Champion, Golden Boot, Dark Horse) plus a secret random double-points game, all folded into the existing leaderboard total.

**Architecture:** Pure, unit-tested scoring/resolver functions in `src/lib`; aggregation in `computeStandings`; a new `/bonus` tab for the three one-time picks; a one-shot script that secretly seals the double-points match. Auto-resolved results come from the synced `matches` table; Champion/Golden Boot winners and the double-match id live in the `meta` key-value table.

**Tech Stack:** Next.js 16.2.9 (App Router, server actions), React 19, Drizzle ORM + Neon Postgres, Vitest, Tailwind v4.

## Global Constraints

- **DO NOT COMMIT.** Per user instruction, verify each task with `npm test` and `npm run lint` instead of git commits. Build runs locally only.
- **Next.js is non-standard here** — per `AGENTS.md`, before writing any new page/form/server-action, skim the relevant guide under `node_modules/next/dist/docs/`. Follow the existing patterns in `PredictionForm.tsx` / `actions.ts` for `useActionState` + `FormState`.
- Team and player name strings must match the football-data.org API exactly (resolution compares against `matches` rows).
- Bonus points roll into the single existing leaderboard total; no separate ranking.
- The three picks lock at the earliest `kickoffUtc` across all matches; enforce server-side, not just in UI.
- The double-points match is never displayed anywhere until it is `FINISHED`. The picker logs nothing identifying.

---

### Task 1: Per-match bonus scoring (Clean Sheet + Cojones)

**Files:**
- Modify: `src/lib/scoring.ts`
- Test: `src/lib/scoring.test.ts`

**Interfaces:**
- Consumes: existing `ScorePair` type from `scoring.ts`.
- Produces: `cleanSheetBonus(pred, result): 0|1|2` and `cojonesBonus(pred, result): 0|1|2`.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/scoring.test.ts`:

```ts
import { cleanSheetBonus, cojonesBonus } from "./scoring";

describe("cleanSheetBonus", () => {
  it("gives +1 when one predicted-clean side keeps the sheet", () => {
    expect(cleanSheetBonus({ home: 2, away: 0 }, { home: 2, away: 0 })).toBe(1);
    expect(cleanSheetBonus({ home: 0, away: 1 }, { home: 0, away: 3 })).toBe(1);
  });
  it("gives +2 for a correctly predicted 0-0 (two clean sheets)", () => {
    expect(cleanSheetBonus({ home: 0, away: 0 }, { home: 0, away: 0 })).toBe(2);
  });
  it("gives 0 when the predicted-clean side actually conceded", () => {
    expect(cleanSheetBonus({ home: 2, away: 0 }, { home: 2, away: 1 })).toBe(0);
  });
  it("gives 0 for a missing prediction", () => {
    expect(cleanSheetBonus(null, { home: 0, away: 0 })).toBe(0);
  });
});

describe("cojonesBonus", () => {
  it("only triggers on an exact-score hit", () => {
    expect(cojonesBonus({ home: 1, away: 0 }, { home: 2, away: 0 })).toBe(0); // outcome, not exact
  });
  it("gives 0 for an exact hit of 0-3 total goals", () => {
    expect(cojonesBonus({ home: 1, away: 0 }, { home: 1, away: 0 })).toBe(0);
    expect(cojonesBonus({ home: 2, away: 1 }, { home: 2, away: 1 })).toBe(0); // total 3
  });
  it("gives +1 for an exact hit of 4-6 total goals", () => {
    expect(cojonesBonus({ home: 3, away: 1 }, { home: 3, away: 1 })).toBe(1); // total 4
    expect(cojonesBonus({ home: 3, away: 3 }, { home: 3, away: 3 })).toBe(1); // total 6
  });
  it("gives +2 for an exact hit of 7+ total goals", () => {
    expect(cojonesBonus({ home: 4, away: 3 }, { home: 4, away: 3 })).toBe(2); // total 7
  });
  it("gives 0 for a missing prediction", () => {
    expect(cojonesBonus(null, { home: 4, away: 3 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- scoring` → FAIL (functions not exported).

- [ ] **Step 3: Implement** — append to `src/lib/scoring.ts`:

```ts
/** +1 for each side correctly predicted to keep a clean sheet. Nailed 0-0 = +2. */
export function cleanSheetBonus(pred: ScorePair | null | undefined, result: ScorePair): 0 | 1 | 2 {
  if (!pred) return 0;
  let b = 0;
  if (pred.away === 0 && result.away === 0) b++; // home kept a clean sheet
  if (pred.home === 0 && result.home === 0) b++; // away kept a clean sheet
  return b as 0 | 1 | 2;
}

/** Bonus for a ballsy EXACT-score call, scaled by total goals: 0-3 → 0, 4-6 → +1, 7+ → +2. */
export function cojonesBonus(pred: ScorePair | null | undefined, result: ScorePair): 0 | 1 | 2 {
  if (!pred) return 0;
  if (pred.home !== result.home || pred.away !== result.away) return 0; // exact hits only
  const total = result.home + result.away;
  if (total >= 7) return 2;
  if (total >= 4) return 1;
  return 0;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- scoring` → PASS. Then `npm run lint` → clean.

---

### Task 2: One-time pick resolvers (Champion, Golden Boot, Dark Horse) + curated lists

**Files:**
- Create: `src/lib/bonus.ts`
- Test: `src/lib/bonus.test.ts`

**Interfaces:**
- Produces:
  - `UNDERDOG_TEAMS: readonly string[]`, `GOLDEN_BOOT_CANDIDATES: string[]`
  - `DARK_HORSE_STAGE_POINTS: Record<string, number>` and `DARK_HORSE_FINAL_WIN_POINTS: number`
  - `championPoints(pick: string | null, championTeam: string | null): number`
  - `goldenBootPoints(pick: string | null, winner: string | null): number`
  - `darkHorsePoints(pick: string | null, reachedStages: Set<string>, wonFinal: boolean): number`

- [ ] **Step 1: Write the failing tests** — create `src/lib/bonus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  championPoints, goldenBootPoints, darkHorsePoints,
  UNDERDOG_TEAMS, GOLDEN_BOOT_CANDIDATES,
} from "./bonus";

describe("curated lists", () => {
  it("has the 16-team underdog pool and a non-empty golden boot shortlist", () => {
    expect(UNDERDOG_TEAMS).toHaveLength(16);
    expect(UNDERDOG_TEAMS).toContain("Morocco");
    expect(GOLDEN_BOOT_CANDIDATES.length).toBeGreaterThan(0);
  });
});

describe("championPoints", () => {
  it("gives +5 on a correct champion, 0 otherwise", () => {
    expect(championPoints("Brazil", "Brazil")).toBe(5);
    expect(championPoints("Brazil", "France")).toBe(0);
    expect(championPoints(null, "Brazil")).toBe(0);
    expect(championPoints("Brazil", null)).toBe(0);
  });
});

describe("goldenBootPoints", () => {
  it("gives +3 on a correct top scorer, 0 otherwise", () => {
    expect(goldenBootPoints("Kylian Mbappé", "Kylian Mbappé")).toBe(3);
    expect(goldenBootPoints("Harry Kane", "Kylian Mbappé")).toBe(0);
    expect(goldenBootPoints(null, "Kylian Mbappé")).toBe(0);
  });
});

describe("darkHorsePoints", () => {
  const all = new Set(["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "FINAL"]);
  it("is 0 with no pick or no progress", () => {
    expect(darkHorsePoints(null, all, true)).toBe(0);
    expect(darkHorsePoints("Morocco", new Set(), false)).toBe(0);
  });
  it("stacks cumulatively per stage reached", () => {
    expect(darkHorsePoints("Morocco", new Set(["LAST_32"]), false)).toBe(2);
    expect(darkHorsePoints("Morocco", new Set(["LAST_32", "LAST_16"]), false)).toBe(4);
    expect(darkHorsePoints("Morocco", new Set(["LAST_32", "LAST_16", "QUARTER_FINALS"]), false)).toBe(7);
    expect(darkHorsePoints("Morocco", new Set(["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS"]), false)).toBe(10);
    expect(darkHorsePoints("Morocco", all, false)).toBe(15); // reached final, did not win
  });
  it("gives the full 25 for winning the final", () => {
    expect(darkHorsePoints("Morocco", all, true)).toBe(25);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- bonus` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/lib/bonus.ts`:

```ts
/** Dark Horse selectable pool — confirmed against the live 48-team field. API name strings. */
export const UNDERDOG_TEAMS: readonly string[] = [
  "Morocco", "Croatia", "Uruguay", "Colombia", "Japan", "Senegal", "Mexico",
  "United States", "Switzerland", "South Korea", "Ecuador", "Norway", "Turkey",
  "Ivory Coast", "Egypt", "Australia",
];

/** Golden Boot shortlist. Functional default — edit names freely; must match the
 *  `golden_boot_winner` value an admin enters at tournament end. */
export const GOLDEN_BOOT_CANDIDATES: string[] = [
  "Kylian Mbappé", "Erling Haaland", "Harry Kane", "Lionel Messi", "Julián Álvarez",
  "Lautaro Martínez", "Vinícius Júnior", "Rodrygo", "Cristiano Ronaldo", "Gonçalo Ramos",
  "Lamine Yamal", "Álvaro Morata", "Mohamed Salah", "Romelu Lukaku", "Memphis Depay",
  "Cody Gakpo", "Jamal Musiala", "Kai Havertz", "Antoine Griezmann", "Jude Bellingham",
  "Bukayo Saka", "Phil Foden", "Christian Pulisic", "Darwin Núñez", "Federico Valverde",
  "Alexander Isak", "Viktor Gyökeres", "Takefusa Kubo", "Youssef En-Nesyri", "Kenan Yıldız",
];

export const CHAMPION_POINTS = 5;
export const GOLDEN_BOOT_POINTS = 3;

/** Cumulative points awarded the first time the Dark Horse pick reaches each stage. */
export const DARK_HORSE_STAGE_POINTS: Record<string, number> = {
  LAST_32: 2,        // passed group stage
  LAST_16: 2,        // passed round of 32 (16avos)
  QUARTER_FINALS: 3, // passed round of 16 (8vos)
  SEMI_FINALS: 3,    // passed quarter-finals (4tos)
  FINAL: 5,          // passed semis
};
export const DARK_HORSE_FINAL_WIN_POINTS = 10;

export function championPoints(pick: string | null, championTeam: string | null): number {
  return pick && championTeam && pick === championTeam ? CHAMPION_POINTS : 0;
}

export function goldenBootPoints(pick: string | null, winner: string | null): number {
  return pick && winner && pick === winner ? GOLDEN_BOOT_POINTS : 0;
}

export function darkHorsePoints(pick: string | null, reachedStages: Set<string>, wonFinal: boolean): number {
  if (!pick) return 0;
  let pts = 0;
  for (const [stage, p] of Object.entries(DARK_HORSE_STAGE_POINTS)) {
    if (reachedStages.has(stage)) pts += p;
  }
  if (wonFinal) pts += DARK_HORSE_FINAL_WIN_POINTS;
  return pts;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- bonus` → PASS. `npm run lint` → clean.

---

### Task 3: Secret double-points helpers

**Files:**
- Create: `src/lib/double.ts`
- Test: `src/lib/double.test.ts`

**Interfaces:**
- Produces:
  - `type DoubleCandidate = { id: number; stage: string; matchday: number }`
  - `lastRoundCandidates(apiMatches: DoubleCandidate[]): DoubleCandidate[]`
  - `pickDoubleMatch(candidates: DoubleCandidate[], rng: () => number): DoubleCandidate | null`
  - `isDoubleRevealed(matchId: number, doubleMatchId: number | null, status: string): boolean`

- [ ] **Step 1: Write the failing tests** — create `src/lib/double.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lastRoundCandidates, pickDoubleMatch, isDoubleRevealed, type DoubleCandidate } from "./double";

const ms: DoubleCandidate[] = [
  { id: 1, stage: "GROUP_STAGE", matchday: 1 },
  { id: 2, stage: "GROUP_STAGE", matchday: 3 },
  { id: 3, stage: "GROUP_STAGE", matchday: 3 },
  { id: 4, stage: "LAST_32", matchday: 4 },
];

describe("lastRoundCandidates", () => {
  it("keeps only the highest group-stage matchday", () => {
    expect(lastRoundCandidates(ms).map((m) => m.id)).toEqual([2, 3]);
  });
  it("returns [] when there are no group games", () => {
    expect(lastRoundCandidates([{ id: 9, stage: "FINAL", matchday: 7 }])).toEqual([]);
  });
});

describe("pickDoubleMatch", () => {
  it("is deterministic for a given rng and always returns a candidate", () => {
    const cands = lastRoundCandidates(ms);
    expect(pickDoubleMatch(cands, () => 0)!.id).toBe(2);
    expect(pickDoubleMatch(cands, () => 0.99)!.id).toBe(3);
  });
  it("returns null with no candidates", () => {
    expect(pickDoubleMatch([], () => 0)).toBeNull();
  });
});

describe("isDoubleRevealed", () => {
  it("is true only for the chosen match once finished", () => {
    expect(isDoubleRevealed(2, 2, "FINISHED")).toBe(true);
    expect(isDoubleRevealed(2, 2, "IN_PLAY")).toBe(false);
    expect(isDoubleRevealed(3, 2, "FINISHED")).toBe(false);
    expect(isDoubleRevealed(2, null, "FINISHED")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- double` → FAIL.

- [ ] **Step 3: Implement** — create `src/lib/double.ts`:

```ts
export type DoubleCandidate = { id: number; stage: string; matchday: number };

/** The final round of group matches = the highest matchday among GROUP_STAGE games. */
export function lastRoundCandidates(apiMatches: DoubleCandidate[]): DoubleCandidate[] {
  const group = apiMatches.filter((m) => m.stage === "GROUP_STAGE");
  if (group.length === 0) return [];
  const last = Math.max(...group.map((m) => m.matchday));
  return group.filter((m) => m.matchday === last);
}

/** Pick one candidate using an injected RNG (testable; pass Math.random in production). */
export function pickDoubleMatch(candidates: DoubleCandidate[], rng: () => number): DoubleCandidate | null {
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

/** The double match is revealed only after it has finished. */
export function isDoubleRevealed(matchId: number, doubleMatchId: number | null, status: string): boolean {
  return doubleMatchId !== null && matchId === doubleMatchId && status === "FINISHED";
}
```

- [ ] **Step 4: Run to verify pass** — `npm test -- double` → PASS. `npm run lint` → clean.

---

### Task 4: `bonus_picks` table

**Files:**
- Modify: `src/db/schema.ts`

**Interfaces:**
- Produces: `bonusPicks` Drizzle table — columns `userId` (PK, FK→users.id), `championTeam`, `goldenBootPlayer`, `darkHorseTeam` (all nullable text), `updatedAt`.

- [ ] **Step 1: Add the table** — append to `src/db/schema.ts` (after `predictions`):

```ts
export const bonusPicks = pgTable("bonus_picks", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  championTeam: text("champion_team"),
  goldenBootPlayer: text("golden_boot_player"),
  darkHorseTeam: text("dark_horse_team"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Push schema to the local/dev DB** — `npm run db:push`. Expected: drizzle-kit reports the new `bonus_picks` table created, no destructive changes to existing tables.

- [ ] **Step 3: Typecheck** — `npm run lint` → clean.

---

### Task 5: Fold all bonuses into `computeStandings`

**Files:**
- Modify: `src/lib/standings.ts`
- Modify call sites: `src/app/leaderboard/page.tsx`, `src/app/player/[username]/page.tsx`, and any other importer (run `grep -rl computeStandings src` first).
- Test: `src/lib/standings.test.ts`

**Interfaces:**
- Consumes: `predictionPoints`, `goalsOff`, `cleanSheetBonus`, `cojonesBonus` (scoring.ts); `championPoints`, `goldenBootPoints`, `darkHorsePoints`, `DARK_HORSE_STAGE_POINTS` (bonus.ts).
- Produces: extended `computeStandings(users, matches, preds, ctx?)` where
  ```ts
  type BonusPickRow = { userId: number; championTeam: string | null; goldenBootPlayer: string | null; darkHorseTeam: string | null };
  type BonusContext = { picks: BonusPickRow[]; championTeam: string | null; goldenBootWinner: string | null; doubleMatchId: number | null };
  ```
  `StandingRow` gains `bonus: { perMatch: number; champion: number; goldenBoot: number; darkHorse: number; total: number }`.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/standings.test.ts` (reuse its existing helpers/imports; if it builds users/matches/preds inline, mirror that style). Add:

```ts
import { computeStandings } from "./standings";

describe("computeStandings bonuses", () => {
  const users = [{ id: 1, name: "A", username: "a" }];
  // finished matches: a 2-0 (home clean sheet) and a 4-3 (high-scoring)
  const matches = [
    { id: 10, stage: "GROUP_STAGE", kickoffUtc: new Date(0), homeTeam: "X", awayTeam: "Y", status: "FINISHED", homeScore: 2, awayScore: 0 },
    { id: 11, stage: "GROUP_STAGE", kickoffUtc: new Date(0), homeTeam: "P", awayTeam: "Q", status: "FINISHED", homeScore: 4, awayScore: 3 },
    { id: 12, stage: "SEMI_FINALS", kickoffUtc: new Date(0), homeTeam: "Morocco", awayTeam: "Z", status: "FINISHED", homeScore: 1, awayScore: 0 },
    { id: 13, stage: "FINAL", kickoffUtc: new Date(0), homeTeam: "Brazil", awayTeam: "W", status: "FINISHED", homeScore: 1, awayScore: 0 },
  ];
  const preds = [
    { userId: 1, matchId: 10, homeScore: 2, awayScore: 0 }, // exact 3 + clean sheet 1
    { userId: 1, matchId: 11, homeScore: 4, awayScore: 3 }, // exact 3 + cojones 2
  ];

  it("adds clean-sheet and cojones to the total", () => {
    const [row] = computeStandings(users, matches, preds);
    // base 3+3 = 6, +1 clean sheet, +2 cojones = 9
    expect(row.points).toBe(9);
  });

  it("doubles base + per-match bonuses on the secret double match", () => {
    const [row] = computeStandings(users, matches, preds, {
      picks: [], championTeam: null, goldenBootWinner: null, doubleMatchId: 11,
    });
    // match 10: 3+1=4 ; match 11 doubled: (3+2)*2=10 ; total 14
    expect(row.points).toBe(14);
  });

  it("adds champion, golden boot and cumulative dark-horse picks", () => {
    const [row] = computeStandings(users, matches, preds, {
      picks: [{ userId: 1, championTeam: "Brazil", goldenBootPlayer: "Salah", darkHorseTeam: "Morocco" }],
      championTeam: "Brazil", goldenBootWinner: "Salah", doubleMatchId: null,
    });
    // base 9 + champion 5 + golden boot 3 + dark horse (reached SEMI_FINALS via match 12: LAST_32?+...)
    // Morocco appears only in SEMI_FINALS here → reachedStages={SEMI_FINALS} → 3
    expect(row.bonus.champion).toBe(5);
    expect(row.bonus.goldenBoot).toBe(3);
    expect(row.bonus.darkHorse).toBe(3);
    expect(row.points).toBe(9 + 5 + 3 + 3);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- standings` → FAIL (ctx param / bonus field missing).

- [ ] **Step 3: Implement** — rewrite `src/lib/standings.ts`:

```ts
import { isScoreable, type MatchLike } from "./rules";
import { cleanSheetBonus, cojonesBonus, goalsOff, predictionPoints } from "./scoring";
import { championPoints, darkHorsePoints, goldenBootPoints, DARK_HORSE_STAGE_POINTS } from "./bonus";

type UserLite = { id: number; name: string; username: string };
type PredLite = { userId: number; matchId: number; homeScore: number; awayScore: number };
type MatchRow = MatchLike & { id: number; stage: string };

export type BonusPickRow = {
  userId: number;
  championTeam: string | null;
  goldenBootPlayer: string | null;
  darkHorseTeam: string | null;
};
export type BonusContext = {
  picks: BonusPickRow[];
  championTeam: string | null;
  goldenBootWinner: string | null;
  doubleMatchId: number | null;
};

export type StandingRow = {
  userId: number;
  name: string;
  username: string;
  points: number;
  exact: number;
  outcomes: number;
  goalsOff: number;
  bonus: { perMatch: number; champion: number; goldenBoot: number; darkHorse: number; total: number };
  rank: number;
};

/** Stages a team appears in (home or away), for Dark Horse resolution. */
function stagesReachedByTeam(matches: MatchRow[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (team: string | null, stage: string) => {
    if (!team) return;
    const s = m.get(team) ?? new Set<string>();
    s.add(stage);
    m.set(team, s);
  };
  for (const match of matches) {
    add(match.homeTeam, match.stage);
    add(match.awayTeam, match.stage);
  }
  return m;
}

export function computeStandings(
  users: UserLite[],
  matches: MatchRow[],
  preds: PredLite[],
  ctx?: BonusContext,
): StandingRow[] {
  const finished = matches.filter(isScoreable);
  const byUserMatch = new Map(preds.map((p) => [`${p.userId}:${p.matchId}`, p]));
  const picksByUser = new Map((ctx?.picks ?? []).map((p) => [p.userId, p]));
  const reached = stagesReachedByTeam(matches);
  const championTeam = ctx?.championTeam ?? null;
  const goldenBootWinner = ctx?.goldenBootWinner ?? null;
  const doubleMatchId = ctx?.doubleMatchId ?? null;

  const rows = users.map((u) => {
    let points = 0, exact = 0, outcomes = 0, off = 0, perMatchBonus = 0;
    for (const m of finished) {
      const p = byUserMatch.get(`${u.id}:${m.id}`);
      const pred = p ? { home: p.homeScore, away: p.awayScore } : null;
      const result = { home: m.homeScore!, away: m.awayScore! };
      const base = predictionPoints(pred, result);
      const cs = cleanSheetBonus(pred, result);
      const cj = cojonesBonus(pred, result);
      const matchTotal = (base + cs + cj) * (m.id === doubleMatchId ? 2 : 1);
      points += matchTotal;
      perMatchBonus += matchTotal - base; // bonus portion incl. the doubling
      if (base === 3) exact++;
      if (base === 1) outcomes++;
      off += goalsOff(pred, result) ?? 0;
    }

    const pick = picksByUser.get(u.id);
    const champion = championPoints(pick?.championTeam ?? null, championTeam);
    const goldenBoot = goldenBootPoints(pick?.goldenBootPlayer ?? null, goldenBootWinner);
    const dhTeam = pick?.darkHorseTeam ?? null;
    const dhStages = dhTeam ? (reached.get(dhTeam) ?? new Set<string>()) : new Set<string>();
    const wonFinal = !!(dhTeam && championTeam && dhTeam === championTeam);
    const darkHorse = darkHorsePoints(dhTeam, dhStages, wonFinal);

    points += champion + goldenBoot + darkHorse;
    const bonusTotal = perMatchBonus + champion + goldenBoot + darkHorse;

    return {
      userId: u.id, name: u.name, username: u.username,
      points, exact, outcomes, goalsOff: off,
      bonus: { perMatch: perMatchBonus, champion, goldenBoot, darkHorse, total: bonusTotal },
      rank: 0,
    };
  });

  rows.sort((a, b) => b.points - a.points || b.exact - a.exact || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.points === r.points && prev.exact === r.exact ? prev.rank : i + 1;
  });
  return rows;
}
```

> Note: `DARK_HORSE_STAGE_POINTS` is imported only if you reference it for a UI legend; if unused here, drop it from the import to keep lint clean.

- [ ] **Step 4: Run to verify pass** — `npm test -- standings` → PASS.

- [ ] **Step 5: Update call sites** — in `src/app/leaderboard/page.tsx` and `src/app/player/[username]/page.tsx` (and any other importer found by grep), load bonus data and pass `ctx`. For the leaderboard, change the data load and call to:

```ts
import { matches as matchesTable, bonusPicks, meta } from "@/db/schema";
import { inArray } from "drizzle-orm";
// ...
const [allUsers, allMatches, allPreds, picks, metaRows] = await Promise.all([
  db.query.users.findMany(),
  db.query.matches.findMany(),
  db.query.predictions.findMany(),
  db.query.bonusPicks.findMany(),
  db.query.meta.findMany({ where: inArray(meta.key, ["champion_team", "golden_boot_winner", "double_match_id"]) }),
]);
const metaMap = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
const rows = computeStandings(allUsers, allMatches, allPreds, {
  picks,
  championTeam: metaMap["champion_team"] ?? null,
  goldenBootWinner: metaMap["golden_boot_winner"] ?? null,
  doubleMatchId: metaMap["double_match_id"] ? Number(metaMap["double_match_id"]) : null,
});
```

Apply the equivalent change wherever `computeStandings` is called so totals include bonuses everywhere. (Register `bonusPicks` in the Drizzle schema import used by `db.query` — it is picked up automatically via `src/db/index.ts`'s `* as schema`.)

- [ ] **Step 6: Verify** — `npm test` (full) → PASS. `npm run lint` → clean.

---

### Task 6: Server actions — save picks + admin set results

**Files:**
- Modify: `src/app/actions.ts`

**Interfaces:**
- Consumes: `UNDERDOG_TEAMS`, `GOLDEN_BOOT_CANDIDATES` (bonus.ts); `bonusPicks`, `meta`, `matches` (schema).
- Produces: `saveBonusPicks(_prev, formData): Promise<FormState>` and `adminSetBonusResults(_prev, formData): Promise<FormState>`.

- [ ] **Step 1: Implement** — append to `src/app/actions.ts` (add imports for `asc`, `bonusPicks`, `meta`, `UNDERDOG_TEAMS`, `GOLDEN_BOOT_CANDIDATES`, `sql`):

```ts
export async function saveBonusPicks(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const first = await db.query.matches.findFirst({ orderBy: [asc(matches.kickoffUtc)] });
  if (first && Date.now() >= first.kickoffUtc.getTime()) {
    return { error: "Bonus picks are locked — the tournament has started." };
  }

  const champion = (String(formData.get("champion") ?? "").trim() || null);
  const goldenBoot = (String(formData.get("goldenBoot") ?? "").trim() || null);
  const darkHorse = (String(formData.get("darkHorse") ?? "").trim() || null);

  const teamNames = new Set(
    (await db.query.matches.findMany()).flatMap((m) => [m.homeTeam, m.awayTeam].filter(Boolean) as string[]),
  );
  if (champion && !teamNames.has(champion)) return { error: "Unknown champion pick" };
  if (darkHorse && !UNDERDOG_TEAMS.includes(darkHorse)) return { error: "Dark horse must be from the underdog pool" };
  if (goldenBoot && !GOLDEN_BOOT_CANDIDATES.includes(goldenBoot)) return { error: "Unknown golden boot pick" };

  await db.insert(bonusPicks)
    .values({ userId: user.id, championTeam: champion, goldenBootPlayer: goldenBoot, darkHorseTeam: darkHorse, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: bonusPicks.userId,
      set: { championTeam: champion, goldenBootPlayer: goldenBoot, darkHorseTeam: darkHorse, updatedAt: new Date() },
    });
  revalidatePath("/bonus");
  return undefined;
}

export async function adminSetBonusResults(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.isAdmin) return { error: "Not allowed" };
  const champion = String(formData.get("championTeam") ?? "").trim();
  const goldenBoot = String(formData.get("goldenBootWinner") ?? "").trim();
  const upsert = async (key: string, value: string) => {
    if (!value) return;
    await db.insert(meta).values({ key, value })
      .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } });
  };
  await upsert("champion_team", champion);
  await upsert("golden_boot_winner", goldenBoot);
  revalidatePath("/", "layout");
  return undefined;
}
```

- [ ] **Step 2: Verify** — `npm run lint` → clean. `npm test` → PASS (no behavior change to existing tests).

---

### Task 7: BONUS tab (page + form + nav link)

**Files:**
- Create: `src/app/bonus/page.tsx`
- Create: `src/components/BonusForm.tsx`
- Modify: `src/components/Nav.tsx`

**Interfaces:**
- Consumes: `saveBonusPicks` (actions), `UNDERDOG_TEAMS`, `GOLDEN_BOOT_CANDIDATES`, `computeStandings` + `BonusContext`.

- [ ] **Step 1: Add the nav link** — in `src/components/Nav.tsx`, after the Compare link:

```tsx
<NavLink href="/bonus" className="text-zinc-300 hover:text-white">Bonus</NavLink>
```

- [ ] **Step 2: Create the client form** — `src/components/BonusForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { saveBonusPicks } from "@/app/actions";
import type { FormState } from "@/app/actions";

type Props = {
  teams: string[];
  underdogs: readonly string[];
  goldenBootCandidates: string[];
  current: { champion: string | null; goldenBoot: string | null; darkHorse: string | null };
  locked: boolean;
};

function Select({ name, label, options, value, locked }: {
  name: string; label: string; options: readonly string[]; value: string | null; locked: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {locked ? (
        <span className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-300">{value ?? "—"}</span>
      ) : (
        <select name={name} defaultValue={value ?? ""} className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2">
          <option value="">— none —</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </label>
  );
}

export default function BonusForm({ teams, underdogs, goldenBootCandidates, current, locked }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveBonusPicks, undefined);
  return (
    <form action={action} className="space-y-4">
      <Select name="champion" label="🏆 Campeón (+5)" options={teams} value={current.champion} locked={locked} />
      <Select name="goldenBoot" label="👟 Botín de Oro (+3)" options={goldenBootCandidates} value={current.goldenBoot} locked={locked} />
      <Select name="darkHorse" label="🐴 Tapado (hasta +25)" options={underdogs} value={current.darkHorse} locked={locked} />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {!locked && (
        <button disabled={pending} className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50">
          {pending ? "Guardando…" : "Guardar"}
        </button>
      )}
      {locked && <p className="text-xs text-zinc-500">Las elecciones están bloqueadas — arrancó el torneo.</p>}
    </form>
  );
}
```

- [ ] **Step 3: Create the page** — `src/app/bonus/page.tsx`:

```tsx
import { asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { matches, meta } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { computeStandings } from "@/lib/standings";
import { UNDERDOG_TEAMS, GOLDEN_BOOT_CANDIDATES } from "@/lib/bonus";
import Nav from "@/components/Nav";
import BonusForm from "@/components/BonusForm";

export const dynamic = "force-dynamic";

export default async function BonusPage() {
  const user = await requireUser();
  const [allUsers, allMatches, allPreds, picks, metaRows, first] = await Promise.all([
    db.query.users.findMany(),
    db.query.matches.findMany(),
    db.query.predictions.findMany(),
    db.query.bonusPicks.findMany(),
    db.query.meta.findMany({ where: inArray(meta.key, ["champion_team", "golden_boot_winner", "double_match_id"]) }),
    db.query.matches.findFirst({ orderBy: [asc(matches.kickoffUtc)] }),
  ]);

  const metaMap = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  const locked = !!(first && Date.now() >= first.kickoffUtc.getTime());
  const teams = [...new Set(allMatches.flatMap((m) => [m.homeTeam, m.awayTeam].filter(Boolean) as string[]))].sort();
  const mine = picks.find((p) => p.userId === user.id) ?? null;

  const rows = computeStandings(allUsers, allMatches, allPreds, {
    picks,
    championTeam: metaMap["champion_team"] ?? null,
    goldenBootWinner: metaMap["golden_boot_winner"] ?? null,
    doubleMatchId: metaMap["double_match_id"] ? Number(metaMap["double_match_id"]) : null,
  });
  const myRow = rows.find((r) => r.userId === user.id);

  return (
    <>
      <Nav name={user.name} isAdmin={user.isAdmin} />
      <main className="mx-auto max-w-2xl space-y-6 p-4">
        <h1 className="text-xl font-bold">Bonus</h1>

        <BonusForm
          teams={teams}
          underdogs={UNDERDOG_TEAMS}
          goldenBootCandidates={GOLDEN_BOOT_CANDIDATES}
          current={{ champion: mine?.championTeam ?? null, goldenBoot: mine?.goldenBootPlayer ?? null, darkHorse: mine?.darkHorseTeam ?? null }}
          locked={locked}
        />

        {myRow && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
            <h2 className="mb-2 font-bold">Tus puntos bonus</h2>
            <ul className="space-y-1 text-zinc-300">
              <li>Valla invicta + Cojones (por partido): <b>{myRow.bonus.perMatch}</b></li>
              <li>Campeón: <b>{myRow.bonus.champion}</b></li>
              <li>Botín de Oro: <b>{myRow.bonus.goldenBoot}</b></li>
              <li>Tapado: <b>{myRow.bonus.darkHorse}</b></li>
              <li className="border-t border-zinc-800 pt-1">Total bonus: <b>{myRow.bonus.total}</b></li>
            </ul>
          </section>
        )}

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
          <h2 className="mb-2 font-bold">Cómo se puntúa</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>🧤 Valla invicta:</b> +1 por cada arco en cero acertado (0-0 acertado = +2).</li>
            <li><b>😤 Cojones:</b> solo si clavás el resultado exacto — 0-3 goles +0, 4-6 +1, 7+ +2.</li>
            <li><b>🏆 Campeón:</b> +5 si acertás el campeón del Mundial.</li>
            <li><b>👟 Botín de Oro:</b> +3 si acertás el goleador del torneo.</li>
            <li><b>🐴 Tapado:</b> suma por ronda alcanzada — grupos +2, 16avos +2, 8vos +3, 4tos +3, semis +5, gana la final +10 (máx 25).</li>
            <li><b>⭐ Partido doble secreto:</b> un partido al azar de la última fecha de grupos vale el doble. Se revela al terminar.</li>
          </ul>
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 4: Verify** — `npm run lint` → clean. Start `npm run dev`, log in, open `/bonus`: three dropdowns render, saving persists, the rules panel and breakdown show.

---

### Task 8: Reveal the double match on the fixture

**Files:**
- Modify: `src/components/MatchRow.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `isDoubleRevealed` (double.ts), `double_match_id` from `meta`.

- [ ] **Step 1: Accept a `double` prop in `MatchRow`** — add `double?: boolean;` to its `Props`, destructure it, and render a badge inside `matchInfo` after the team names:

```tsx
{double && (
  <span className="ml-2 rounded bg-fuchsia-700 px-1.5 py-0.5 text-xs font-bold">⭐ DOBLE</span>
)}
```

- [ ] **Step 2: Wire it from the fixture page** — in `src/app/page.tsx`, load the double id and pass the flag:

```ts
import { eq } from "drizzle-orm";
import { meta } from "@/db/schema";
import { isDoubleRevealed } from "@/lib/double";
// inside the Promise.all, add:
//   db.query.meta.findFirst({ where: eq(meta.key, "double_match_id") })
// then:
const doubleMatchId = doubleRow?.value ? Number(doubleRow.value) : null;
```

In `renderMatch`, add to the `<MatchRow … />` props:

```tsx
double={isDoubleRevealed(m.id, doubleMatchId, m.status)}
```

- [ ] **Step 3: Verify** — `npm run lint` → clean. With no `double_match_id` set, no badge appears anywhere (the secret holds).

---

### Task 9: Admin results inputs

**Files:**
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `adminSetBonusResults` (actions), existing `meta` values.

- [ ] **Step 1: Load current values and render a form** — in `src/app/admin/page.tsx`, extend the meta load and add a results card. Add `adminSetBonusResults` to the import from `@/app/actions`, load `champion_team` / `golden_boot_winner` via `inArray`, and render (above the match list):

```tsx
<form action={adminSetBonusResults} className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
  <label className="flex flex-col gap-1 text-sm">
    <span className="font-semibold">Champion (team)</span>
    <input name="championTeam" defaultValue={metaMap["champion_team"] ?? ""} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
  </label>
  <label className="flex flex-col gap-1 text-sm">
    <span className="font-semibold">Golden Boot (player)</span>
    <input name="goldenBootWinner" defaultValue={metaMap["golden_boot_winner"] ?? ""} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1" />
  </label>
  <button className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-600">Save results</button>
</form>
```

Note: this form binds the action directly (no `useActionState` needed since the page is a server component and we don't surface field errors here). Do **not** add any input for `double_match_id` — it stays secret.

- [ ] **Step 2: Verify** — `npm run lint` → clean. On `/admin`, the two inputs render and saving updates the leaderboard totals (test by setting a champion and checking a matching pick scores +5).

---

### Task 10: Seal the secret double-points match

**Files:**
- Create: `scripts/pick-double.ts`
- Modify: `package.json` (add script entry)

**Interfaces:**
- Consumes: `lastRoundCandidates`, `pickDoubleMatch` (double.ts); football-data.org API; `meta` table.

- [ ] **Step 1: Add the npm script** — in `package.json` `scripts`:

```json
"pick-double": "tsx --env-file=.env.local scripts/pick-double.ts"
```

- [ ] **Step 2: Create the script** — `scripts/pick-double.ts`:

```ts
/* Seals ONE secret double-points match from the final group round. Idempotent.
   Run once before 2026-06-24. Logs nothing identifying. */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { meta } from "../src/db/schema";
import { lastRoundCandidates, pickDoubleMatch, type DoubleCandidate } from "../src/lib/double";

async function main() {
  const existing = await db.query.meta.findFirst({ where: eq(meta.key, "double_match_id") });
  if (existing) {
    console.log("Double game already sealed. Nothing to do.");
    return;
  }

  const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
    headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN! },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`football-data.org responded ${res.status}`);
  const data = (await res.json()) as { matches: { id: number; stage: string; matchday: number; utcDate: string }[] };

  const candidates: DoubleCandidate[] = data.matches.map((m) => ({ id: m.id, stage: m.stage, matchday: m.matchday }));
  const lastRound = lastRoundCandidates(candidates);

  // Fairness: refuse to pick if any last-round game has already kicked off.
  const now = Date.now();
  const started = data.matches.some(
    (m) => lastRound.find((c) => c.id === m.id) && new Date(m.utcDate).getTime() <= now,
  );
  if (started) throw new Error("A last-round game has already started — cannot seal fairly.");

  const chosen = pickDoubleMatch(lastRound, Math.random);
  if (!chosen) throw new Error("No last-round candidates found.");

  await db.insert(meta).values({ key: "double_match_id", value: String(chosen.id) });
  console.log(`Double game sealed (1 of ${lastRound.length} candidates). Shhh. 🤫`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run it once** — `npm run pick-double`. Expected: prints "Double game sealed (1 of 24 candidates)…" and writes `double_match_id` to `meta`. **Do not** echo or look up which match was chosen. Re-running prints "already sealed".

- [ ] **Step 4: Final verification** — `npm test` (full suite) → PASS; `npm run lint` → clean; `npm run dev` and confirm the leaderboard totals look right and no double badge is visible (secret intact).

---

## Self-Review Notes

- **Spec coverage:** Clean Sheet + Cojones → Task 1; Champion/Golden Boot/Dark Horse resolvers + lists → Task 2; double helpers → Task 3; `bonus_picks` → Task 4; aggregation incl. doubling → Task 5; save/admin actions → Tasks 6 & 9; BONUS tab → Task 7; double reveal badge → Task 8; secret picker → Task 10. All spec sections mapped.
- **Secrecy:** `double_match_id` never rendered (Task 8 only via `isDoubleRevealed`), excluded from admin (Task 9), unlogged by the picker (Task 10).
- **No-commit constraint:** every task ends in `npm test` / `npm run lint` verification rather than a commit.
