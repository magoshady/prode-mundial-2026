# Knockout Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a layered knockout-stage scoring system (90' result + extra-time + who-advances/penalties) with a progressive prediction form, before the Round of 32 on 2026-06-29.

**Architecture:** A new pure module `src/lib/knockout.ts` holds all knockout logic (scoring, result/prediction adapters, prediction validation) and is unit-tested in isolation. The DB gains additive nullable columns to persist the clean per-phase scores the API already returns. `syncMatches`, `computeStandings`, `savePrediction`, and the fixture/player pages branch on `stage` to call the new logic for knockout matches while leaving group-stage behavior byte-for-byte unchanged.

**Tech Stack:** Next.js (App Router, server actions), Drizzle ORM (Postgres/Neon, `drizzle-kit push` — no migration files), Vitest, Tailwind. React client components for forms.

## Global Constraints

- Group-stage scoring, clean-sheet bonus, cojones bonus, secret double, champion / golden boot / dark horse bonuses are UNCHANGED. Knockout matches get NONE of the per-match bonuses or the double.
- Knockout = any match with `stage !== "GROUP_STAGE"` (values: `LAST_32`, `LAST_16`, `QUARTER_FINALS`, `SEMI_FINALS`, `THIRD_PLACE`, `FINAL`).
- ET score is the AGGREGATE after extra time (e.g. 1-1 at 90', one goal each in ET → 2-2), not goals-in-ET-only.
- Layer points (caps: 6 decided in 90', 10 full distance):
  - 90' exact = 3, 90' outcome = 1
  - reaches ET = +1, ET exact aggregate = +2
  - advances = 3, penalties called = +1
- The football-data.org API overwrites `score.fullTime` with the shootout result for `PENALTY_SHOOTOUT` matches. End-of-ET aggregate must be computed as `regularTime + extraTime`, NEVER from `fullTime`.
- Existing `predictions.homeScore` / `homeScore`/`awayScore` columns hold the 90' prediction/score for knockouts. No new "regular time" prediction columns.
- Test runner: `npm run test` (vitest, `vitest run`). Lint: `npm run lint`. Build: `npm run build`. Schema push: `npm run db:push`.
- TypeScript strict; no `any`. Match existing code style (2-space indent, double quotes).

---

### Task 1: Knockout scoring core (`src/lib/knockout.ts`)

The heart of the feature: pure functions with no DB or network dependency. Reuses `predictionPoints` from `scoring.ts` for Layer 1.

**Files:**
- Create: `src/lib/knockout.ts`
- Test: `src/lib/knockout.test.ts`

**Interfaces:**
- Consumes: `ScorePair`, `predictionPoints` from `src/lib/scoring.ts`.
- Produces:
  - `type AdvanceSide = "HOME" | "AWAY"`
  - `type Duration = "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT"`
  - `type KnockoutPrediction = { reg: ScorePair; et: ScorePair | null; penAdvance: AdvanceSide | null }`
  - `type KnockoutResult = { reg: ScorePair; etAgg: ScorePair | null; duration: Duration; winner: AdvanceSide }`
  - `type KnockoutBreakdown = { reg: 0 | 1 | 3; etReached: 0 | 1; etExact: 0 | 2; advance: 0 | 3; pens: 0 | 1; total: number }`
  - `function knockoutPoints(pred: KnockoutPrediction | null, result: KnockoutResult): KnockoutBreakdown`
  - `type KnockoutMatchFields = { regHome: number | null; regAway: number | null; etHome: number | null; etAway: number | null; duration: string | null; winner: string | null }`
  - `function toKnockoutResult(m: KnockoutMatchFields): KnockoutResult | null`
  - `type KnockoutPredFields = { homeScore: number; awayScore: number; etHomeScore: number | null; etAwayScore: number | null; penAdvance: string | null }`
  - `function toKnockoutPrediction(p: KnockoutPredFields): KnockoutPrediction`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/knockout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  knockoutPoints,
  toKnockoutResult,
  toKnockoutPrediction,
  type KnockoutPrediction,
  type KnockoutResult,
} from "./knockout";

const pred = (
  reg: [number, number],
  et: [number, number] | null = null,
  penAdvance: "HOME" | "AWAY" | null = null,
): KnockoutPrediction => ({
  reg: { home: reg[0], away: reg[1] },
  et: et ? { home: et[0], away: et[1] } : null,
  penAdvance,
});

const res = (
  reg: [number, number],
  etAgg: [number, number] | null,
  duration: KnockoutResult["duration"],
  winner: "HOME" | "AWAY",
): KnockoutResult => ({
  reg: { home: reg[0], away: reg[1] },
  etAgg: etAgg ? { home: etAgg[0], away: etAgg[1] } : null,
  duration,
  winner,
});

describe("knockoutPoints", () => {
  it("decided in 90', exact + advance = 6 (the cap)", () => {
    const bd = knockoutPoints(pred([2, 1]), res([2, 1], null, "REGULAR", "HOME"));
    expect(bd).toEqual({ reg: 3, etReached: 0, etExact: 0, advance: 3, pens: 0, total: 6 });
  });

  it("decided in 90', right outcome wrong score, right advance = 1 + 3", () => {
    const bd = knockoutPoints(pred([3, 1]), res([2, 0], null, "REGULAR", "HOME"));
    expect(bd.reg).toBe(1);
    expect(bd.advance).toBe(3);
    expect(bd.total).toBe(4);
  });

  it("safety net: wrong 90' and wrong path, but correctly called who advances", () => {
    // Predicted a decisive home win 2-0 in 90'. Actual: 1-1 at 90', home win 2-1 in ET.
    // 90' wrong (0), no ET predicted, but home advances as called -> just the 3.
    const bd = knockoutPoints(pred([2, 0]), res([1, 1], [2, 1], "EXTRA_TIME", "HOME"));
    expect(bd).toEqual({ reg: 0, etReached: 0, etExact: 0, advance: 3, pens: 0, total: 3 });
  });

  it("full distance to ET (no pens), exact everything = 9", () => {
    // Predicted 1-1 at 90', 2-1 aggregate after ET, home through. Cap of 10 needs penalties.
    const bd = knockoutPoints(pred([1, 1], [2, 1]), res([1, 1], [2, 1], "EXTRA_TIME", "HOME"));
    expect(bd).toEqual({ reg: 3, etReached: 1, etExact: 2, advance: 3, pens: 0, total: 9 });
  });

  it("full distance to penalties, exact everything = 10 (the cap)", () => {
    const bd = knockoutPoints(pred([0, 0], [1, 1], "HOME"), res([0, 0], [1, 1], "PENALTY_SHOOTOUT", "HOME"));
    expect(bd).toEqual({ reg: 3, etReached: 1, etExact: 2, advance: 3, pens: 1, total: 10 });
  });

  it("reaches-ET point requires predicting a 90' draw", () => {
    // Predicted decisive 90' (no ET), match went to ET -> no etReached point.
    const bd = knockoutPoints(pred([2, 1]), res([1, 1], [2, 1], "EXTRA_TIME", "HOME"));
    expect(bd.etReached).toBe(0);
    expect(bd.etExact).toBe(0);
  });

  it("ET points are zero when the match was decided in 90' (REGULAR)", () => {
    // Player predicted ET (1-1 then 2-1), but the match was settled 2-0 in regulation.
    const bd = knockoutPoints(pred([1, 1], [2, 1]), res([2, 0], null, "REGULAR", "HOME"));
    expect(bd.etReached).toBe(0);
    expect(bd.etExact).toBe(0);
  });

  it("penalties point requires predicting an ET draw AND actual shootout", () => {
    // Predicted ET decisive (2-1), actual went to pens -> no pens point.
    const bd = knockoutPoints(pred([1, 1], [2, 1]), res([1, 1], [1, 1], "PENALTY_SHOOTOUT", "AWAY"));
    expect(bd.pens).toBe(0);
  });

  it("no prediction scores zero on every layer", () => {
    const bd = knockoutPoints(null, res([1, 1], [2, 1], "EXTRA_TIME", "HOME"));
    expect(bd).toEqual({ reg: 0, etReached: 0, etExact: 0, advance: 0, pens: 0, total: 0 });
  });
});

describe("toKnockoutResult", () => {
  it("builds a REGULAR result (etAgg null)", () => {
    expect(
      toKnockoutResult({ regHome: 2, regAway: 0, etHome: null, etAway: null, duration: "REGULAR", winner: "HOME_TEAM" }),
    ).toEqual({ reg: { home: 2, away: 0 }, etAgg: null, duration: "REGULAR", winner: "HOME" });
  });

  it("computes ET aggregate as regularTime + extraTime", () => {
    expect(
      toKnockoutResult({ regHome: 1, regAway: 1, etHome: 1, etAway: 0, duration: "EXTRA_TIME", winner: "HOME_TEAM" }),
    ).toEqual({ reg: { home: 1, away: 1 }, etAgg: { home: 2, away: 1 }, duration: "EXTRA_TIME", winner: "HOME" });
  });

  it("for a shootout uses regularTime+extraTime, NOT fullTime", () => {
    // Portugal 0-0 Slovenia after ET, 3-0 on pens. regHome/regAway are the 90' (0-0).
    const r = toKnockoutResult({ regHome: 0, regAway: 0, etHome: 0, etAway: 0, duration: "PENALTY_SHOOTOUT", winner: "HOME_TEAM" });
    expect(r).toEqual({ reg: { home: 0, away: 0 }, etAgg: { home: 0, away: 0 }, duration: "PENALTY_SHOOTOUT", winner: "HOME" });
  });

  it("returns null when winner or regular-time score is missing", () => {
    expect(toKnockoutResult({ regHome: null, regAway: null, etHome: null, etAway: null, duration: "REGULAR", winner: "HOME_TEAM" })).toBeNull();
    expect(toKnockoutResult({ regHome: 1, regAway: 1, etHome: null, etAway: null, duration: "REGULAR", winner: "DRAW" })).toBeNull();
  });
});

describe("toKnockoutPrediction", () => {
  it("maps a decisive 90' prediction", () => {
    expect(
      toKnockoutPrediction({ homeScore: 2, awayScore: 1, etHomeScore: null, etAwayScore: null, penAdvance: null }),
    ).toEqual({ reg: { home: 2, away: 1 }, et: null, penAdvance: null });
  });

  it("maps an ET + penalties prediction", () => {
    expect(
      toKnockoutPrediction({ homeScore: 1, awayScore: 1, etHomeScore: 2, etAwayScore: 2, penAdvance: "AWAY" }),
    ).toEqual({ reg: { home: 1, away: 1 }, et: { home: 2, away: 2 }, penAdvance: "AWAY" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- knockout`
Expected: FAIL — `Cannot find module './knockout'` / functions not defined.

- [ ] **Step 3: Implement `src/lib/knockout.ts`**

```ts
import { predictionPoints, type ScorePair } from "./scoring";

export type AdvanceSide = "HOME" | "AWAY";
export type Duration = "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT";

export type KnockoutPrediction = {
  reg: ScorePair;
  /** Predicted aggregate after extra time; null when a decisive 90' was predicted. */
  et: ScorePair | null;
  /** Who advances on penalties; set only when ET was predicted as a draw. */
  penAdvance: AdvanceSide | null;
};

export type KnockoutResult = {
  reg: ScorePair;
  /** Actual aggregate at the end of extra time; null for matches decided in 90'. */
  etAgg: ScorePair | null;
  duration: Duration;
  winner: AdvanceSide;
};

export type KnockoutBreakdown = {
  reg: 0 | 1 | 3;
  etReached: 0 | 1;
  etExact: 0 | 2;
  advance: 0 | 3;
  pens: 0 | 1;
  total: number;
};

const isDraw = (s: ScorePair) => s.home === s.away;
const sideOf = (s: ScorePair): AdvanceSide => (s.home > s.away ? "HOME" : "AWAY");

/** The advancing team a prediction implies, or null if it implies none (a draw with no pen pick). */
function predictedAdvance(pred: KnockoutPrediction): AdvanceSide | null {
  if (pred.et === null) return isDraw(pred.reg) ? null : sideOf(pred.reg);
  if (!isDraw(pred.et)) return sideOf(pred.et);
  return pred.penAdvance;
}

export function knockoutPoints(pred: KnockoutPrediction | null, result: KnockoutResult): KnockoutBreakdown {
  const zero: KnockoutBreakdown = { reg: 0, etReached: 0, etExact: 0, advance: 0, pens: 0, total: 0 };
  if (!pred) return zero;

  const reg = predictionPoints(pred.reg, result.reg);

  const predictedReachesET = isDraw(pred.reg);
  const actuallyReachedET = result.duration !== "REGULAR";
  const etReached: 0 | 1 = predictedReachesET && actuallyReachedET ? 1 : 0;

  const etExact: 0 | 2 =
    pred.et !== null &&
    result.etAgg !== null &&
    pred.et.home === result.etAgg.home &&
    pred.et.away === result.etAgg.away
      ? 2
      : 0;

  const adv = predictedAdvance(pred);
  const advance: 0 | 3 = adv !== null && adv === result.winner ? 3 : 0;

  const predictedPens = pred.et !== null && isDraw(pred.et);
  const pens: 0 | 1 = predictedPens && result.duration === "PENALTY_SHOOTOUT" ? 1 : 0;

  return { reg, etReached, etExact, advance, pens, total: reg + etReached + etExact + advance + pens };
}

export type KnockoutMatchFields = {
  regHome: number | null;
  regAway: number | null;
  etHome: number | null;
  etAway: number | null;
  duration: string | null;
  winner: string | null;
};

/** Build a KnockoutResult from stored match columns, or null if it cannot be scored yet. */
export function toKnockoutResult(m: KnockoutMatchFields): KnockoutResult | null {
  if (m.regHome === null || m.regAway === null) return null;
  if (m.winner !== "HOME_TEAM" && m.winner !== "AWAY_TEAM") return null;
  const duration = (m.duration ?? "REGULAR") as Duration;
  const winner: AdvanceSide = m.winner === "HOME_TEAM" ? "HOME" : "AWAY";
  const etAgg =
    duration === "REGULAR"
      ? null
      : { home: m.regHome + (m.etHome ?? 0), away: m.regAway + (m.etAway ?? 0) };
  return { reg: { home: m.regHome, away: m.regAway }, etAgg, duration, winner };
}

export type KnockoutPredFields = {
  homeScore: number;
  awayScore: number;
  etHomeScore: number | null;
  etAwayScore: number | null;
  penAdvance: string | null;
};

/** Build a KnockoutPrediction from stored prediction columns. */
export function toKnockoutPrediction(p: KnockoutPredFields): KnockoutPrediction {
  const et = p.etHomeScore !== null && p.etAwayScore !== null ? { home: p.etHomeScore, away: p.etAwayScore } : null;
  const penAdvance = p.penAdvance === "HOME" || p.penAdvance === "AWAY" ? p.penAdvance : null;
  return { reg: { home: p.homeScore, away: p.awayScore }, et, penAdvance };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- knockout`
Expected: PASS (all `knockout.test.ts` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/knockout.ts src/lib/knockout.test.ts
git commit -m "feat: knockout scoring core (layers, result/prediction adapters)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Prediction validation/normalization (`normalizeKnockoutPrediction`)

Pure helper used by the `savePrediction` server action and mirrored by the client form. Keeps the conditional rules in one tested place.

**Files:**
- Modify: `src/lib/knockout.ts` (append)
- Test: `src/lib/knockout.test.ts` (append)

**Interfaces:**
- Produces:
  - `type RawPredictionInput = { isKnockout: boolean; home: number; away: number; etHome: number | null; etAway: number | null; penAdvance: AdvanceSide | null }`
  - `type NormalizedPrediction = { homeScore: number; awayScore: number; etHomeScore: number | null; etAwayScore: number | null; penAdvance: AdvanceSide | null }`
  - `function normalizeKnockoutPrediction(input: RawPredictionInput): { ok: true; value: NormalizedPrediction } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/knockout.test.ts`:

```ts
import { normalizeKnockoutPrediction } from "./knockout";

describe("normalizeKnockoutPrediction", () => {
  const base = { isKnockout: true, etHome: null, etAway: null, penAdvance: null } as const;

  it("rejects out-of-range 90' scores", () => {
    expect(normalizeKnockoutPrediction({ ...base, home: -1, away: 0 }).ok).toBe(false);
    expect(normalizeKnockoutPrediction({ ...base, home: 0, away: 100 }).ok).toBe(false);
  });

  it("group-stage input ignores ET/pen fields", () => {
    const out = normalizeKnockoutPrediction({ isKnockout: false, home: 1, away: 1, etHome: 2, etAway: 2, penAdvance: "HOME" });
    expect(out).toEqual({ ok: true, value: { homeScore: 1, awayScore: 1, etHomeScore: null, etAwayScore: null, penAdvance: null } });
  });

  it("knockout decisive 90' drops any ET/pen fields", () => {
    const out = normalizeKnockoutPrediction({ isKnockout: true, home: 2, away: 1, etHome: 3, etAway: 3, penAdvance: "HOME" });
    expect(out).toEqual({ ok: true, value: { homeScore: 2, awayScore: 1, etHomeScore: null, etAwayScore: null, penAdvance: null } });
  });

  it("knockout 90' draw requires an ET aggregate", () => {
    expect(normalizeKnockoutPrediction({ ...base, home: 1, away: 1 }).ok).toBe(false);
  });

  it("ET aggregate cannot be lower than the 90' score per side", () => {
    expect(normalizeKnockoutPrediction({ ...base, home: 1, away: 1, etHome: 0, etAway: 1 }).ok).toBe(false);
  });

  it("knockout 90' draw + decisive ET stores ET, no pen pick", () => {
    const out = normalizeKnockoutPrediction({ ...base, home: 1, away: 1, etHome: 2, etAway: 1 });
    expect(out).toEqual({ ok: true, value: { homeScore: 1, awayScore: 1, etHomeScore: 2, etAwayScore: 1, penAdvance: null } });
  });

  it("knockout ET draw requires a penalty pick", () => {
    expect(normalizeKnockoutPrediction({ ...base, home: 1, away: 1, etHome: 2, etAway: 2 }).ok).toBe(false);
  });

  it("knockout ET draw + pen pick is accepted", () => {
    const out = normalizeKnockoutPrediction({ ...base, home: 0, away: 0, etHome: 1, etAway: 1, penAdvance: "AWAY" });
    expect(out).toEqual({ ok: true, value: { homeScore: 0, awayScore: 0, etHomeScore: 1, etAwayScore: 1, penAdvance: "AWAY" } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- knockout`
Expected: FAIL — `normalizeKnockoutPrediction` not exported.

- [ ] **Step 3: Implement (append to `src/lib/knockout.ts`)**

```ts
export type RawPredictionInput = {
  isKnockout: boolean;
  home: number;
  away: number;
  etHome: number | null;
  etAway: number | null;
  penAdvance: AdvanceSide | null;
};

export type NormalizedPrediction = {
  homeScore: number;
  awayScore: number;
  etHomeScore: number | null;
  etAwayScore: number | null;
  penAdvance: AdvanceSide | null;
};

const inRange = (v: number) => Number.isInteger(v) && v >= 0 && v <= 99;

export function normalizeKnockoutPrediction(
  input: RawPredictionInput,
): { ok: true; value: NormalizedPrediction } | { ok: false; error: string } {
  const { home, away } = input;
  if (!inRange(home) || !inRange(away)) {
    return { ok: false, error: "Scores must be whole numbers between 0 and 99" };
  }

  const groupValue: NormalizedPrediction = {
    homeScore: home, awayScore: away, etHomeScore: null, etAwayScore: null, penAdvance: null,
  };
  if (!input.isKnockout || home !== away) return { ok: true, value: groupValue };

  // Knockout, predicted a 90' draw -> extra time is required.
  const { etHome, etAway } = input;
  if (etHome === null || etAway === null || !inRange(etHome) || !inRange(etAway)) {
    return { ok: false, error: "Predict the score after extra time" };
  }
  if (etHome < home || etAway < away) {
    return { ok: false, error: "Extra-time score can't be lower than the 90' score" };
  }

  if (etHome !== etAway) {
    return { ok: true, value: { homeScore: home, awayScore: away, etHomeScore: etHome, etAwayScore: etAway, penAdvance: null } };
  }

  // ET also a draw -> penalties decide it; a pick is required.
  if (input.penAdvance !== "HOME" && input.penAdvance !== "AWAY") {
    return { ok: false, error: "Pick who advances on penalties" };
  }
  return {
    ok: true,
    value: { homeScore: home, awayScore: away, etHomeScore: etHome, etAwayScore: etAway, penAdvance: input.penAdvance },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- knockout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/knockout.ts src/lib/knockout.test.ts
git commit -m "feat: knockout prediction validation/normalization

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Schema columns + push

Additive, nullable columns only — safe to push to the live Neon DB without data loss.

**Files:**
- Modify: `src/db/schema.ts:11-21` (matches), `src/db/schema.ts:23-34` (predictions)

**Interfaces:**
- Produces (Drizzle columns, used by Tasks 4-8):
  - `matches`: `duration` text, `winner` text, `regularTimeHome` int, `regularTimeAway` int, `extraTimeHome` int, `extraTimeAway` int, `penaltiesHome` int, `penaltiesAway` int — all nullable.
  - `predictions`: `etHomeScore` int, `etAwayScore` int, `penAdvance` text — all nullable.

- [ ] **Step 1: Edit `matches` table** — add after the `awayScore` line (`src/db/schema.ts:20`):

```ts
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  duration: text("duration"), // REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT
  winner: text("winner"), // HOME_TEAM | AWAY_TEAM | DRAW
  regularTimeHome: integer("regular_time_home"), // the 90' score (knockouts)
  regularTimeAway: integer("regular_time_away"),
  extraTimeHome: integer("extra_time_home"), // goals scored during ET
  extraTimeAway: integer("extra_time_away"),
  penaltiesHome: integer("penalties_home"),
  penaltiesAway: integer("penalties_away"),
```

- [ ] **Step 2: Edit `predictions` table** — add after the `awayScore` line (`src/db/schema.ts:30`):

```ts
    homeScore: integer("home_score").notNull(),
    awayScore: integer("away_score").notNull(),
    etHomeScore: integer("et_home_score"), // predicted aggregate after ET
    etAwayScore: integer("et_away_score"),
    penAdvance: text("pen_advance"), // HOME | AWAY (only when ET predicted as a draw)
```

- [ ] **Step 3: Push schema to the database**

Run: `npm run db:push`
Expected: drizzle-kit reports adding the new nullable columns and completes without prompting for data loss. (If it lists only additive `ADD COLUMN` changes, accept.)

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: PASS (no type errors from the schema change).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: schema columns for knockout phases (matches + predictions)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Sync the new API fields (`mapApiScore`)

Extract a pure mapper so the gotcha (shootout `fullTime`) is unit-tested, then wire it into `syncMatches`.

**Files:**
- Modify: `src/lib/sync.ts`
- Create: `src/lib/sync-map.ts`
- Test: `src/lib/sync-map.test.ts`

**Interfaces:**
- Produces:
  - `type FDScore = { winner: string | null; duration: string; fullTime: { home: number | null; away: number | null }; regularTime?: { home: number | null; away: number | null } | null; extraTime?: { home: number | null; away: number | null } | null; penalties?: { home: number | null; away: number | null } | null }`
  - `function mapApiScore(score: FDScore): { homeScore: number | null; awayScore: number | null; duration: string; winner: string | null; regularTimeHome: number | null; regularTimeAway: number | null; extraTimeHome: number | null; extraTimeAway: number | null; penaltiesHome: number | null; penaltiesAway: number | null }`

- [ ] **Step 1: Write the failing tests** — create `src/lib/sync-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapApiScore } from "./sync-map";

describe("mapApiScore", () => {
  it("REGULAR match: regularTime falls back to fullTime, no ET/pens", () => {
    const out = mapApiScore({ winner: "HOME_TEAM", duration: "REGULAR", fullTime: { home: 2, away: 0 } });
    expect(out).toMatchObject({
      homeScore: 2, awayScore: 0, duration: "REGULAR", winner: "HOME_TEAM",
      regularTimeHome: 2, regularTimeAway: 0,
      extraTimeHome: null, extraTimeAway: null, penaltiesHome: null, penaltiesAway: null,
    });
  });

  it("EXTRA_TIME match: keeps regular and extra time separately", () => {
    const out = mapApiScore({
      winner: "HOME_TEAM", duration: "EXTRA_TIME",
      fullTime: { home: 2, away: 1 }, regularTime: { home: 1, away: 1 }, extraTime: { home: 1, away: 0 },
    });
    expect(out).toMatchObject({
      regularTimeHome: 1, regularTimeAway: 1, extraTimeHome: 1, extraTimeAway: 0, duration: "EXTRA_TIME",
    });
  });

  it("PENALTY_SHOOTOUT: regularTime is the run-of-play, NOT the fullTime shootout result", () => {
    const out = mapApiScore({
      winner: "HOME_TEAM", duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 3, away: 0 }, regularTime: { home: 0, away: 0 }, extraTime: { home: 0, away: 0 }, penalties: { home: 3, away: 0 },
    });
    expect(out).toMatchObject({
      regularTimeHome: 0, regularTimeAway: 0, penaltiesHome: 3, penaltiesAway: 0, duration: "PENALTY_SHOOTOUT",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- sync-map`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/sync-map.ts`**

```ts
export type FDScore = {
  winner: string | null;
  duration: string;
  fullTime: { home: number | null; away: number | null };
  regularTime?: { home: number | null; away: number | null } | null;
  extraTime?: { home: number | null; away: number | null } | null;
  penalties?: { home: number | null; away: number | null } | null;
};

export function mapApiScore(score: FDScore) {
  return {
    // homeScore/awayScore keep the API's fullTime for group-stage scoring (unchanged).
    homeScore: score.fullTime.home,
    awayScore: score.fullTime.away,
    duration: score.duration,
    winner: score.winner,
    // For REGULAR matches the API omits regularTime, so fall back to fullTime.
    regularTimeHome: score.regularTime?.home ?? score.fullTime.home,
    regularTimeAway: score.regularTime?.away ?? score.fullTime.away,
    extraTimeHome: score.extraTime?.home ?? null,
    extraTimeAway: score.extraTime?.away ?? null,
    penaltiesHome: score.penalties?.home ?? null,
    penaltiesAway: score.penalties?.away ?? null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- sync-map`
Expected: PASS.

- [ ] **Step 5: Wire into `src/lib/sync.ts`** — replace the `FDMatch` `score` type and the `rows` mapping + the upsert `set` block:

Change the `FDMatch` type's `score` field:

```ts
  score: import("./sync-map").FDScore;
```

Replace the `rows` mapping (`src/lib/sync.ts:26-36`):

```ts
  const rows = data.matches.map((m) => ({
    id: m.id,
    stage: m.stage,
    groupName: m.group,
    kickoffUtc: new Date(m.utcDate),
    status: m.status,
    homeTeam: m.homeTeam.name,
    awayTeam: m.awayTeam.name,
    ...mapApiScore(m.score),
  }));
```

Add the import at the top of `src/lib/sync.ts`:

```ts
import { mapApiScore } from "./sync-map";
```

Extend the upsert `set` block (`src/lib/sync.ts:40-49`) to include the new columns:

```ts
    set: {
      stage: sql`excluded.stage`,
      groupName: sql`excluded.group_name`,
      kickoffUtc: sql`excluded.kickoff_utc`,
      status: sql`excluded.status`,
      homeTeam: sql`excluded.home_team`,
      awayTeam: sql`excluded.away_team`,
      homeScore: sql`excluded.home_score`,
      awayScore: sql`excluded.away_score`,
      duration: sql`excluded.duration`,
      winner: sql`excluded.winner`,
      regularTimeHome: sql`excluded.regular_time_home`,
      regularTimeAway: sql`excluded.regular_time_away`,
      extraTimeHome: sql`excluded.extra_time_home`,
      extraTimeAway: sql`excluded.extra_time_away`,
      penaltiesHome: sql`excluded.penalties_home`,
      penaltiesAway: sql`excluded.penalties_away`,
    },
```

- [ ] **Step 6: Type-check and run the full suite**

Run: `npm run lint && npm run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sync.ts src/lib/sync-map.ts src/lib/sync-map.test.ts
git commit -m "feat: sync extra-time, penalties and winner from football-data.org

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Score knockout matches in standings

Branch `computeStandings` so knockout matches use `knockoutPoints` (no per-match bonus, no double) while group matches are untouched.

**Files:**
- Modify: `src/lib/standings.ts`
- Test: `src/lib/standings.test.ts` (append)

**Interfaces:**
- Consumes: `knockoutPoints`, `toKnockoutResult`, `toKnockoutPrediction` from `src/lib/knockout.ts`.
- Produces: `computeStandings` signature unchanged; `PredLite` and the internal match type widen to carry knockout columns (all optional/nullable).

- [ ] **Step 1: Write the failing tests** — append to `src/lib/standings.test.ts`:

```ts
describe("computeStandings knockout", () => {
  const u = [{ id: 1, name: "A", username: "a" }];
  const koMatch = (over: Record<string, unknown>) => ({
    id: 50, stage: "LAST_16", status: "FINISHED",
    kickoffUtc: new Date("2026-06-29T05:00:00Z"), homeTeam: "X", awayTeam: "Y",
    homeScore: null, awayScore: null,
    regularTimeHome: null, regularTimeAway: null, etHome: null, etAway: null,
    extraTimeHome: null, extraTimeAway: null, duration: null, winner: null,
    ...over,
  });

  it("awards full-distance knockout points and counts the 90' exact", () => {
    // Predicted 1-1 / 2-1 ET / home through; actual exactly that.
    const m = koMatch({
      homeScore: 2, awayScore: 1, regularTimeHome: 1, regularTimeAway: 1,
      extraTimeHome: 1, extraTimeAway: 0, duration: "EXTRA_TIME", winner: "HOME_TEAM",
    });
    const rows = computeStandings(u, [m as never], [
      { userId: 1, matchId: 50, homeScore: 1, awayScore: 1, etHomeScore: 2, etAwayScore: 1, penAdvance: null },
    ]);
    expect(rows[0].points).toBe(9); // 3 + 1 + 2 + 3
    expect(rows[0].exact).toBe(1);
  });

  it("does NOT apply clean-sheet/cojones/double to knockout matches", () => {
    // Exact 0-0 in 90' that goes to pens; a 0-0 would earn clean-sheet in groups, but not here.
    const m = koMatch({
      homeScore: 4, awayScore: 3, regularTimeHome: 0, regularTimeAway: 0,
      extraTimeHome: 0, extraTimeAway: 0, duration: "PENALTY_SHOOTOUT", winner: "HOME_TEAM",
    });
    const rows = computeStandings(u, [m as never], [
      { userId: 1, matchId: 50, homeScore: 0, awayScore: 0, etHomeScore: 0, etAwayScore: 0, penAdvance: "HOME" },
    ], { picks: [], championTeam: null, goldenBootWinner: null, doubleMatchId: 50, perMatchBonusFrom: new Date("2026-01-01") });
    expect(rows[0].points).toBe(10); // 3 + 1 + 2 + 3 + 1, NOT doubled, no clean-sheet
    expect(rows[0].bonus.perMatch).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- standings`
Expected: FAIL — knockout points not computed (points come out wrong / NaN).

- [ ] **Step 3: Edit `src/lib/standings.ts`**

Add to the imports at the top:

```ts
import { knockoutPoints, toKnockoutPrediction, toKnockoutResult } from "./knockout";
```

Widen the local types (`src/lib/standings.ts:6-7`):

```ts
type PredLite = {
  userId: number; matchId: number; homeScore: number; awayScore: number;
  etHomeScore?: number | null; etAwayScore?: number | null; penAdvance?: string | null;
};
type MatchRow = MatchLike & {
  id: number; stage: string;
  regularTimeHome?: number | null; regularTimeAway?: number | null;
  extraTimeHome?: number | null; extraTimeAway?: number | null;
  duration?: string | null; winner?: string | null;
};
```

In the per-match loop (`src/lib/standings.ts:70-86`), branch at the top of the `for (const m of finished)` body, before the existing group logic:

```ts
    for (const m of finished) {
      const p = byUserMatch.get(`${u.id}:${m.id}`);

      if (m.stage !== "GROUP_STAGE") {
        const koResult = toKnockoutResult({
          regHome: m.regularTimeHome ?? null, regAway: m.regularTimeAway ?? null,
          etHome: m.extraTimeHome ?? null, etAway: m.extraTimeAway ?? null,
          duration: m.duration ?? null, winner: m.winner ?? null,
        });
        if (!koResult) continue; // not yet scoreable as a knockout (missing phase data)
        const koPred = p
          ? toKnockoutPrediction({ homeScore: p.homeScore, awayScore: p.awayScore, etHomeScore: p.etHomeScore ?? null, etAwayScore: p.etAwayScore ?? null, penAdvance: p.penAdvance ?? null })
          : null;
        const bd = knockoutPoints(koPred, koResult);
        points += bd.total;
        if (bd.reg === 3) exact++;
        else if (bd.reg === 1) outcomes++;
        off += goalsOff(koPred?.reg ?? null, koResult.reg) ?? 0;
        continue; // no per-match bonus, no double on knockouts
      }

      const pred = p ? { home: p.homeScore, away: p.awayScore } : null;
      const result = { home: m.homeScore!, away: m.awayScore! };
      const base = predictionPoints(pred, result);
      // ...existing group-stage bonus logic unchanged...
```

(Leave the rest of the existing group-stage body exactly as it is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- standings`
Expected: PASS (new knockout tests + all existing standings tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "feat: score knockout matches in standings (layers, no per-match bonus)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Server action accepts ET/penalty predictions

Wire `normalizeKnockoutPrediction` into `savePrediction` and persist the new columns.

**Files:**
- Modify: `src/app/actions.ts:32-51`

**Interfaces:**
- Consumes: `normalizeKnockoutPrediction`, `AdvanceSide` from `src/lib/knockout.ts`.

- [ ] **Step 1: Edit `savePrediction`** — replace the body (`src/app/actions.ts:32-51`):

```ts
export async function savePrediction(matchId: number, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match || !isOpenForPrediction(match, new Date())) {
    return { error: "Predictions are closed for this match" };
  }

  const num = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const penRaw = String(formData.get("penAdvance") ?? "").trim();

  const result = normalizeKnockoutPrediction({
    isKnockout: match.stage !== "GROUP_STAGE",
    home: Number(formData.get("home")),
    away: Number(formData.get("away")),
    etHome: num("etHome"),
    etAway: num("etAway"),
    penAdvance: penRaw === "HOME" || penRaw === "AWAY" ? (penRaw as AdvanceSide) : null,
  });
  if (!result.ok) return { error: result.error };
  const v = result.value;

  await db.insert(predictions)
    .values({ userId: user.id, matchId, homeScore: v.homeScore, awayScore: v.awayScore, etHomeScore: v.etHomeScore, etAwayScore: v.etAwayScore, penAdvance: v.penAdvance, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [predictions.userId, predictions.matchId],
      set: { homeScore: v.homeScore, awayScore: v.awayScore, etHomeScore: v.etHomeScore, etAwayScore: v.etAwayScore, penAdvance: v.penAdvance, updatedAt: new Date() },
    });
  revalidatePath("/");
  return undefined;
}
```

Update the import line (`src/app/actions.ts:10-11`) to add the knockout import:

```ts
import { isOpenForPrediction } from "@/lib/rules";
import { normalizeKnockoutPrediction, type AdvanceSide } from "@/lib/knockout";
```

- [ ] **Step 2: Type-check + full test run**

Run: `npm run lint && npm run test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions.ts
git commit -m "feat: savePrediction accepts knockout ET/penalty fields

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Progressive knockout prediction form + fixture display

New client form that reveals ET / penalty inputs conditionally, plus fixture-page wiring to score and display knockout matches.

**Files:**
- Create: `src/components/KnockoutPredictionForm.tsx`
- Modify: `src/components/MatchRow.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `savePrediction` (`src/app/actions.ts`), `FormState`.
- Produces: `KnockoutPredictionForm` props `{ matchId: number; homeTeam: string; awayTeam: string; home: number | null; away: number | null; etHome: number | null; etAway: number | null; penAdvance: "HOME" | "AWAY" | null }`.

- [ ] **Step 1: Create `src/components/KnockoutPredictionForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useActionState } from "react";
import { savePrediction } from "@/app/actions";
import type { FormState } from "@/app/actions";

type Props = {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  home: number | null;
  away: number | null;
  etHome: number | null;
  etAway: number | null;
  penAdvance: "HOME" | "AWAY" | null;
};

export default function KnockoutPredictionForm(p: Props) {
  const action = savePrediction.bind(null, p.matchId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);

  const [h, setH] = useState(p.home?.toString() ?? "");
  const [a, setA] = useState(p.away?.toString() ?? "");
  const [eh, setEh] = useState(p.etHome?.toString() ?? "");
  const [ea, setEa] = useState(p.etAway?.toString() ?? "");
  const [pen, setPen] = useState<"HOME" | "AWAY" | "">(p.penAdvance ?? "");

  const drawAt90 = h !== "" && a !== "" && h === a;
  const drawAtET = drawAt90 && eh !== "" && ea !== "" && eh === ea;

  const numInput = "w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-center";

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input name="home" type="number" min={0} max={99} required value={h} onChange={(e) => setH(e.target.value)} className={numInput} />
        <span className="text-zinc-500">-</span>
        <input name="away" type="number" min={0} max={99} required value={a} onChange={(e) => setA(e.target.value)} className={numInput} />
        <span className="text-xs text-zinc-500">90&apos;</span>
        <button disabled={pending} className="ml-1 rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold transition hover:bg-emerald-600 active:scale-95 disabled:opacity-50">
          {pending ? "..." : p.home !== null ? "Update" : "Save"}
        </button>
      </div>

      {drawAt90 && (
        <div className="flex items-center gap-1.5">
          <input name="etHome" type="number" min={0} max={99} required value={eh} onChange={(e) => setEh(e.target.value)} className={numInput} />
          <span className="text-zinc-500">-</span>
          <input name="etAway" type="number" min={0} max={99} required value={ea} onChange={(e) => setEa(e.target.value)} className={numInput} />
          <span className="text-xs text-zinc-500">after extra time</span>
        </div>
      )}

      {drawAtET && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Penalties — who advances?</span>
          <label className="flex items-center gap-1">
            <input type="radio" name="penAdvance" value="HOME" required checked={pen === "HOME"} onChange={() => setPen("HOME")} />
            {p.homeTeam}
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="penAdvance" value="AWAY" required checked={pen === "AWAY"} onChange={() => setPen("AWAY")} />
            {p.awayTeam}
          </label>
        </div>
      )}

      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  );
}
```

- [ ] **Step 2: Extend `MatchRow` to support knockouts**

In `src/components/MatchRow.tsx`, add to `Props` (after `double?`):

```ts
  /** True for knockout-stage matches: use the progressive form and the multi-layer badge. */
  knockout?: boolean;
  homeTeam: string;
  awayTeam: string;
  /** Knockout prefill for the form. */
  mineEtHome?: number | null;
  mineEtAway?: number | null;
  minePenAdvance?: "HOME" | "AWAY" | null;
  /** Pre-formatted final score for knockouts, e.g. "1-1 (2-2 a.e.t., 4-3 pen.)". */
  finalScoreLabel?: string | null;
```

Generalize `Badge` so it handles knockout totals (replace `src/components/MatchRow.tsx:33-39`):

```tsx
function Badge({ v }: { v: number }) {
  const tone = v === 0 ? "bg-zinc-700" : v <= 2 ? "bg-amber-700" : "bg-emerald-700";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${tone}`}>{v} pts</span>;
}
```

Import the knockout form at the top of `MatchRow.tsx`:

```tsx
import KnockoutPredictionForm from "@/components/KnockoutPredictionForm";
```

In the `open` branch (`src/components/MatchRow.tsx:71-75`), choose the form by `knockout`:

```tsx
      {open ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
          {matchInfo}
          {knockout ? (
            <KnockoutPredictionForm
              matchId={matchId} homeTeam={homeTeam} awayTeam={awayTeam}
              home={mine?.home ?? null} away={mine?.away ?? null}
              etHome={mineEtHome ?? null} etAway={mineEtAway ?? null} penAdvance={minePenAdvance ?? null}
            />
          ) : (
            <PredictionForm matchId={matchId} home={mine?.home ?? null} away={mine?.away ?? null} />
          )}
        </div>
      ) : (
```

In `matchInfo`, use `finalScoreLabel` for finished knockouts (replace the FINISHED branch at `src/components/MatchRow.tsx:62-64`):

```tsx
        ) : status === "FINISHED" ? (
          <span className="ml-2 font-bold">{finalScoreLabel ?? `${homeScore}-${awayScore}`}</span>
        ) : null}
```

Add `homeTeam, awayTeam, knockout, mineEtHome, mineEtAway, minePenAdvance, finalScoreLabel` to the destructured props in the component signature (`src/components/MatchRow.tsx:41-44`). Note `homeTeam`/`awayTeam` already exist in `Props` — keep them.

- [ ] **Step 3: Wire `src/app/page.tsx`**

Add the imports:

```ts
import { knockoutPoints, toKnockoutPrediction, toKnockoutResult } from "@/lib/knockout";
```

Inside `renderMatch`, after computing `scoreable`, branch for knockouts:

```ts
    const knockout = m.stage !== "GROUP_STAGE";
    const koResult = knockout
      ? toKnockoutResult({ regHome: m.regularTimeHome, regAway: m.regularTimeAway, etHome: m.extraTimeHome, etAway: m.extraTimeAway, duration: m.duration, winner: m.winner })
      : null;

    const koPts = (row: { homeScore: number; awayScore: number; etHomeScore: number | null; etAwayScore: number | null; penAdvance: string | null } | null) =>
      koResult ? knockoutPoints(row ? toKnockoutPrediction(row) : null, koResult).total : null;

    const finalScoreLabel = (() => {
      if (!knockout || m.status !== "FINISHED" || m.regularTimeHome === null) return null;
      let s = `${m.regularTimeHome}-${m.regularTimeAway}`;
      if (m.duration !== "REGULAR" && m.extraTimeHome !== null) {
        s = `${m.regularTimeHome + m.extraTimeHome}-${m.regularTimeAway + (m.extraTimeAway ?? 0)} a.e.t.`;
      }
      if (m.duration === "PENALTY_SHOOTOUT" && m.penaltiesHome !== null) s += ` (${m.penaltiesHome}-${m.penaltiesAway} pen.)`;
      return s;
    })();
```

Replace `myPts` so knockouts use the layered total:

```ts
    const myPts = knockout
      ? koPts(pred)
      : result
        ? predictionPoints(pred ? { home: pred.homeScore, away: pred.awayScore } : null, result)
        : null;
```

In the `others` mapping, compute knockout points when applicable:

```ts
        return {
          name: u.name,
          isMe: u.id === user.id,
          home: p?.homeScore ?? null,
          away: p?.awayScore ?? null,
          pts: knockout
            ? koPts(p ?? null)
            : result ? predictionPoints(p ? { home: p.homeScore, away: p.awayScore } : null, result) : null,
        };
```

Pass the new props to `<MatchRow>`:

```tsx
        knockout={knockout}
        finalScoreLabel={finalScoreLabel}
        mineEtHome={pred?.etHomeScore ?? null}
        mineEtAway={pred?.etAwayScore ?? null}
        minePenAdvance={(pred?.penAdvance as "HOME" | "AWAY" | null) ?? null}
```

(`homeTeam`/`awayTeam` are already passed.)

- [ ] **Step 4: Type-check, lint, build**

Run: `npm run lint && npm run build`
Expected: PASS (compiles, no type errors).

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, log in, find a Round-of-32 match (open for prediction).
Verify:
- Entering a decisive 90' score (e.g. 2-1) shows only the Save button — no ET row.
- Entering a draw (1-1) reveals the "after extra time" row.
- Entering an ET draw (2-2) reveals the "Penalties — who advances?" radio.
- Saving a 1-1 / 2-2 / pick persists; reloading shows the prefilled values.
- Saving a 1-1 with no ET score shows the inline error "Predict the score after extra time".

- [ ] **Step 6: Commit**

```bash
git add src/components/KnockoutPredictionForm.tsx src/components/MatchRow.tsx src/app/page.tsx
git commit -m "feat: progressive knockout prediction form + fixture scoring/display

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Player detail page knockout breakdown + Spanish announcement + final verification

Show knockout points correctly on the player page, draft the launch message, and run full verification.

**Files:**
- Modify: `src/app/player/[username]/page.tsx`
- Create: `docs/announcements/2026-06-26-knockout-es.md`

**Interfaces:**
- Consumes: `knockoutPoints`, `toKnockoutPrediction`, `toKnockoutResult` from `src/lib/knockout.ts`.

- [ ] **Step 1: Edit the player page match rows** (`src/app/player/[username]/page.tsx:52-60`)

Add the import:

```ts
import { knockoutPoints, toKnockoutPrediction, toKnockoutResult } from "@/lib/knockout";
```

Replace the `matchRows` map so knockout matches score and display via the layered system:

```ts
  const matchRows = visible.map((m) => {
    const pred = predByMatch.get(m.id) ?? null;
    const scoreable = isScoreable(m);

    if (m.stage !== "GROUP_STAGE") {
      const koResult = toKnockoutResult({ regHome: m.regularTimeHome, regAway: m.regularTimeAway, etHome: m.extraTimeHome, etAway: m.extraTimeAway, duration: m.duration, winner: m.winner });
      const koPred = pred ? toKnockoutPrediction({ homeScore: pred.homeScore, awayScore: pred.awayScore, etHomeScore: pred.etHomeScore, etAwayScore: pred.etAwayScore, penAdvance: pred.penAdvance }) : null;
      const pts = koResult ? knockoutPoints(koPred, koResult).total : null;
      const predLabel = pred
        ? `${pred.homeScore}-${pred.awayScore}${pred.etHomeScore !== null ? ` (${pred.etHomeScore}-${pred.etAwayScore} aet${pred.penAdvance ? `, pen ${pred.penAdvance === "HOME" ? m.homeTeam : m.awayTeam}` : ""})` : ""}`
        : null;
      const resultLabel = koResult
        ? `${koResult.reg.home}-${koResult.reg.away}${koResult.etAgg ? ` (${koResult.etAgg.home}-${koResult.etAgg.away} aet)` : ""}`
        : (m.regularTimeHome !== null ? `${m.regularTimeHome}-${m.regularTimeAway}` : "—");
      return { m, predLabel, resultLabel, pts, off: null as number | null };
    }

    const predPair = pred ? { home: pred.homeScore, away: pred.awayScore } : null;
    const result = { home: m.homeScore!, away: m.awayScore! };
    const pts = scoreable ? predictionPoints(predPair, result) : null;
    const off = scoreable ? goalsOff(predPair, result) : null;
    const predLabel = pred ? `${pred.homeScore}-${pred.awayScore}` : null;
    const resultLabel = m.homeScore !== null ? `${m.homeScore}-${m.awayScore}` : "—";
    return { m, predLabel, resultLabel, pts, off };
  });
```

Update the table body to use `predLabel`/`resultLabel` (replace `src/app/player/[username]/page.tsx:82-100`):

```tsx
            {matchRows.map(({ m, predLabel, resultLabel, pts, off }) => (
              <tr key={m.id} className="border-b border-zinc-800">
                <td className="px-2 py-3 text-xs text-zinc-500">{fmt.format(m.kickoffUtc)}</td>
                <td className="px-2 py-3">{m.homeTeam} vs {m.awayTeam}</td>
                <td className="px-2 py-3 text-center">
                  {resultLabel}
                  {(m.status === "IN_PLAY" || m.status === "PAUSED") && <span className="ml-1 text-xs text-amber-400">LIVE</span>}
                </td>
                <td className="px-2 py-3 text-center">{predLabel ?? "—"}</td>
                <td className="px-2 py-3 text-right">
                  {pts !== null && (
                    <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${pts === 0 ? "bg-zinc-700" : pts <= 2 ? "bg-amber-700" : "bg-emerald-700"}`}>
                      {pts}
                    </span>
                  )}
                </td>
                <td className="px-2 py-3 text-right text-zinc-400">{off !== null ? off : "—"}</td>
              </tr>
            ))}
```

- [ ] **Step 2: Draft the Spanish announcement** — create `docs/announcements/2026-06-26-knockout-es.md`:

```markdown
# Anuncio — Puntos de eliminatorias 🏆

¡Arrancan los mata-mata! Desde los 16avos el puntaje cambia para premiar
todo lo que pasa en un partido a eliminación directa:

**90 minutos**
- Resultado exacto a los 90': 3 pts
- Acertás solo quién gana/empata (resultado, no marcador): 1 pt

**Tiempo extra** (si tu pronóstico de los 90' es empate)
- Acertás que se va a alargue: +1 pt
- Marcador exacto al final del alargue: +2 pts

**Quién pasa**
- Acertás el equipo que avanza: 3 pts
- Acertás que se define por penales: +1 pt

Máximos: 6 pts si se define en los 90', 10 pts si vas hasta los penales.
El formulario te pide el alargue solo si pusiste empate, y a quién pasa por
penales solo si pusiste empate también en el alargue. ¡Mucha suerte!
```

- [ ] **Step 3: Final verification — full suite, lint, build**

Run: `npm run test && npm run lint && npm run build`
Expected: ALL PASS. Confirm the test output shows the `knockout`, `sync-map`, and `standings` suites green.

- [ ] **Step 4: Manual reconciliation check**

Run: `npm run dev`, open `/leaderboard` and a `/player/<username>` page.
Verify a player's knockout match shows the layered points and that the player-page headline total equals the leaderboard total (they share `computeStandings`).

- [ ] **Step 5: Commit**

```bash
git add src/app/player/[username]/page.tsx docs/announcements/2026-06-26-knockout-es.md
git commit -m "feat: player-page knockout breakdown + Spanish launch announcement

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Deploy/sync after merge:** the new match columns stay null until the next `syncMatches` run. Before the first knockout kickoff, trigger a sync (admin "Sync" button or the `/api/sync` route) so `regularTime`/`winner`/etc. populate. Knockout matches won't score until they do.
- **`db:push` is additive** (nullable columns) — existing rows and group-stage predictions are unaffected.
- **Admin manual result entry** (`adminUpdateResult`) only sets `homeScore`/`awayScore`/`status`; it does NOT set the knockout phase columns. Knockout results should come from the API sync. If a manual knockout override is ever needed, that's a follow-up — out of scope here.
