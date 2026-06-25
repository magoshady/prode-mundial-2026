import { describe, expect, it } from "vitest";
import {
  knockoutPoints,
  knockoutScoreLabel,
  toKnockoutResult,
  toKnockoutPrediction,
  normalizeKnockoutPrediction,
  type KnockoutPrediction,
  type KnockoutResult,
  type KnockoutScoreFields,
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

describe("knockoutScoreLabel", () => {
  const base: KnockoutScoreFields = {
    regHome: null, regAway: null,
    etHome: null, etAway: null,
    penHome: null, penAway: null,
    duration: null,
  };

  it("returns null when regHome is null", () => {
    expect(knockoutScoreLabel({ ...base })).toBeNull();
  });

  it("REGULAR decided in 90' → plain score", () => {
    expect(knockoutScoreLabel({ ...base, regHome: 1, regAway: 0, duration: "REGULAR" })).toBe("1-0");
  });

  it("EXTRA_TIME → includes a.e.t. aggregate", () => {
    expect(knockoutScoreLabel({ ...base, regHome: 1, regAway: 1, etHome: 1, etAway: 0, duration: "EXTRA_TIME" }))
      .toBe("1-1 (2-1 a.e.t.)");
  });

  it("PENALTY_SHOOTOUT → includes a.e.t. and penalties", () => {
    expect(knockoutScoreLabel({ ...base, regHome: 0, regAway: 0, etHome: 0, etAway: 0, penHome: 4, penAway: 3, duration: "PENALTY_SHOOTOUT" }))
      .toBe("0-0 (0-0 a.e.t., 4-3 pen.)");
  });
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
