import { describe, expect, it } from "vitest";
import {
  knockoutPoints,
  knockoutScoreLabel,
  knockoutPredictionDetail,
  knockoutOutcomeHint,
  argentinaRoast,
  toKnockoutResult,
  toKnockoutPrediction,
  normalizeKnockoutPrediction,
  bombitaMatchPoints,
  knockoutMatchScore,
  type KnockoutPrediction,
  type KnockoutResult,
  type KnockoutScoreFields,
  type KnockoutBreakdown,
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

describe("knockoutPredictionDetail", () => {
  const detail = (
    homeScore: number, awayScore: number,
    etHomeScore: number | null = null, etAwayScore: number | null = null,
    penAdvance: "HOME" | "AWAY" | null = null,
  ) => knockoutPredictionDetail({ homeScore, awayScore, etHomeScore, etAwayScore, penAdvance }, "Netherlands", "Morocco");

  it("decisive 90' prediction has no ET detail", () => {
    expect(detail(2, 0)).toBeNull();
  });

  it("draw + decisive ET → just the a.e.t. aggregate", () => {
    expect(detail(1, 1, 2, 1)).toBe("2-1 a.e.t.");
  });

  it("draw + level ET, away on pens → names the away side", () => {
    expect(detail(1, 1, 1, 1, "AWAY")).toBe("1-1 a.e.t., Morocco on pens");
  });

  it("draw + level ET, home on pens → names the home side", () => {
    expect(detail(0, 0, 2, 2, "HOME")).toBe("2-2 a.e.t., Netherlands on pens");
  });
});

describe("knockoutOutcomeHint", () => {
  const base = { homeTeam: "Argentina", awayTeam: "Brazil" };
  const hint = (
    home: number | null,
    away: number | null,
    etHome: number | null = null,
    etAway: number | null = null,
    penAdvance: "HOME" | "AWAY" | null = null,
  ) => knockoutOutcomeHint({ ...base, home, away, etHome, etAway, penAdvance });

  it("no hint while the 90' score is incomplete", () => {
    expect(hint(null, null)).toBeNull();
    expect(hint(1, null)).toBeNull();
  });

  it("no hint when 90' is decisive (decided in regulation)", () => {
    expect(hint(2, 1)).toBeNull();
  });

  it("prompts for the ET score when 90' is a draw and ET is empty", () => {
    expect(hint(1, 1)).toEqual({
      text: "Tied at 90' — enter the score after extra time",
      tone: "muted",
    });
  });

  it("decisive ET: reports goals scored in ET and who advances", () => {
    expect(hint(1, 1, 2, 1)).toEqual({
      text: "1 goal in extra time — Argentina wins 2-1 and advances",
      tone: "muted",
    });
  });

  it("decisive ET with several goals: pluralizes and names the away winner", () => {
    expect(hint(1, 1, 2, 3)).toEqual({
      text: "3 goals in extra time — Brazil wins 2-3 and advances",
      tone: "muted",
    });
  });

  it("level ET with no further goals → straight to penalties", () => {
    expect(hint(1, 1, 1, 1)).toEqual({
      text: "No goals in extra time — straight to penalties",
      tone: "muted",
    });
  });

  it("level ET with goals → penalties, noting the goals", () => {
    expect(hint(1, 1, 2, 2)).toEqual({
      text: "2 goals in extra time, still level — straight to penalties",
      tone: "muted",
    });
  });

  it("appends the penalty winner once picked", () => {
    expect(hint(1, 1, 1, 1, "AWAY")).toEqual({
      text: "No goals in extra time — straight to penalties, Brazil advances",
      tone: "muted",
    });
  });

  it("warns when the ET aggregate is below the 90' score", () => {
    expect(hint(1, 1, 0, 1)).toEqual({
      text: "Extra-time score can't be below the 90' score",
      tone: "warn",
    });
  });
});

describe("argentinaRoast", () => {
  const roast = (
    home: number | null,
    away: number | null,
    opts: {
      etHome?: number | null;
      etAway?: number | null;
      penAdvance?: "HOME" | "AWAY" | null;
      homeTeam?: string;
      awayTeam?: string;
      stage?: string;
    } = {},
  ) =>
    argentinaRoast({
      home,
      away,
      etHome: opts.etHome ?? null,
      etAway: opts.etAway ?? null,
      penAdvance: opts.penAdvance ?? null,
      homeTeam: opts.homeTeam ?? "Argentina",
      awayTeam: opts.awayTeam ?? "Brazil",
      stage: opts.stage ?? "LAST_32",
    });

  it("no roast when Argentina is not in the match", () => {
    expect(roast(0, 2, { homeTeam: "Brazil", awayTeam: "France" })).toBeNull();
  });

  it("no roast while the pick is undecided", () => {
    expect(roast(null, null)).toBeNull(); // blank
    expect(roast(1, 1)).toBeNull(); // draw at 90', ET blank
    expect(roast(1, 1, { etHome: 2, etAway: 2 })).toBeNull(); // level ET, no pen pick
  });

  it("no roast when Argentina is predicted to advance", () => {
    expect(roast(2, 1)).toBeNull(); // Argentina (home) wins in 90'
    expect(roast(1, 1, { etHome: 2, etAway: 1 })).toBeNull(); // wins in ET
    expect(roast(1, 1, { etHome: 2, etAway: 2, penAdvance: "HOME" })).toBeNull(); // wins on pens
  });

  it("roasts a 90' loss (Argentina at home)", () => {
    expect(roast(0, 1)).toBe("Que estas poniendo pelotudo?");
  });

  it("roasts a 90' loss with Argentina as the away side", () => {
    expect(roast(1, 0, { homeTeam: "Brazil", awayTeam: "Argentina" })).toBe(
      "Que estas poniendo pelotudo?",
    );
  });

  it("roasts a loss in extra time", () => {
    expect(roast(1, 1, { etHome: 1, etAway: 2 })).toBe("Que estas poniendo pelotudo?");
  });

  it("roasts a loss on penalties", () => {
    expect(roast(1, 1, { etHome: 2, etAway: 2, penAdvance: "AWAY" })).toBe(
      "Que estas poniendo pelotudo?",
    );
  });

  it("uses the stage-specific message", () => {
    expect(roast(0, 1, { stage: "LAST_16" })).toBe("Que te pasa la concha de tu hermana?");
    expect(roast(0, 1, { stage: "QUARTER_FINALS" })).toBe("Nah bueno, vos sos un sorete");
    expect(roast(0, 1, { stage: "SEMI_FINALS" })).toBe(
      "Esta puteada preguntasela a Rodrigo, pero cuando termine el partido",
    );
    expect(roast(0, 1, { stage: "FINAL" })).toBe(
      "AH VOS SOS EL MAS PECHO FRIO. QUE ESTAS PONIENDO ACA HIJO DE PUTA?",
    );
  });

  it("no roast for stages without a message", () => {
    expect(roast(0, 1, { stage: "GROUP_STAGE" })).toBeNull();
    expect(roast(0, 1, { stage: "THIRD_PLACE" })).toBeNull();
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

describe("knockoutMatchScore", () => {
  // France 2-0 Morocco (QF, x1.5). Predicting 1-0 = right outcome (1) + right advancer (3)
  // + France clean sheet (1) = 5, then x1.5.
  const oneNil = pred([1, 0]);
  const franceWin = res([2, 0], null, "REGULAR", "HOME");
  const base = { result: franceWin, stageMult: 1.5, bonusEligible: true, isBombita: false, isForfeit: false };

  it("folds the clean-sheet bonus and stage multiplier into the normal total", () => {
    const s = knockoutMatchScore({ ...base, pred: oneNil });
    expect(s.cleanSheet).toBe(1);
    expect(s.normal).toBe(7.5); // (4 base + 1 clean sheet) * 1.5
    expect(s.points).toBe(7.5);
    expect(s.bombita).toBe("none");
  });

  it("a bombita that missed the exact 90' pays only the advancer floor", () => {
    const s = knockoutMatchScore({ ...base, pred: oneNil, isBombita: true });
    expect(s.normal).toBe(7.5);
    expect(s.points).toBe(4.5); // 3 * 1.5, double-or-nothing floor
    expect(s.bombita).toBe("bet");
  });

  it("a bombita on the exact 90' score doubles the whole haul", () => {
    const s = knockoutMatchScore({ ...base, pred: pred([2, 0]), isBombita: true });
    expect(s.normal).toBe(10.5); // (6 base + 1 clean sheet) * 1.5
    expect(s.points).toBe(21); // doubled
    expect(s.bombita).toBe("bet");
  });

  it("a never-bet forfeit on the last QF banks zero", () => {
    const s = knockoutMatchScore({ ...base, pred: pred([2, 0]), isForfeit: true });
    expect(s.normal).toBe(10.5);
    expect(s.points).toBe(0);
    expect(s.bombita).toBe("forfeit");
  });

  it("drops per-match bonuses when the match is not yet bonus-eligible", () => {
    const s = knockoutMatchScore({ ...base, pred: oneNil, bonusEligible: false });
    expect(s.cleanSheet).toBe(0);
    expect(s.normal).toBe(6); // 4 base * 1.5, no clean sheet
    expect(s.points).toBe(6);
  });
});
