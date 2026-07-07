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

export type KnockoutScoreFields = {
  regHome: number | null; regAway: number | null;
  etHome: number | null; etAway: number | null;
  penHome: number | null; penAway: number | null;
  duration: string | null;
};

/** Played-out knockout score, e.g. "0-0 (0-0 a.e.t., 4-3 pen.)", or null if no 90' score yet. */
export function knockoutScoreLabel(m: KnockoutScoreFields): string | null {
  if (m.regHome === null || m.regAway === null) return null;
  let s = `${m.regHome}-${m.regAway}`;
  if (m.duration !== "REGULAR" && m.etHome !== null) {
    const aggHome = m.regHome + m.etHome;
    const aggAway = (m.regAway ?? 0) + (m.etAway ?? 0);
    s += ` (${aggHome}-${aggAway} a.e.t.`;
    if (m.duration === "PENALTY_SHOOTOUT" && m.penHome !== null) {
      s += `, ${m.penHome}-${m.penAway} pen.`;
    }
    s += ")";
  }
  return s;
}

export type OutcomeHintInput = {
  home: number | null;
  away: number | null;
  etHome: number | null;
  etAway: number | null;
  penAdvance: AdvanceSide | null;
  homeTeam: string;
  awayTeam: string;
};

export type OutcomeHint = { text: string; tone: "muted" | "warn" };

const goalsLabel = (n: number) => (n === 1 ? "1 goal" : `${n} goals`);

/**
 * Plain-language reading of the current knockout inputs (aggregate ET semantics),
 * or null when there is nothing useful to say. Pure; safe to call on every render.
 */
export function knockoutOutcomeHint(input: OutcomeHintInput): OutcomeHint | null {
  const { home, away, etHome, etAway, penAdvance, homeTeam, awayTeam } = input;

  if (home === null || away === null) return null;
  if (home !== away) return null; // decided in 90'

  if (etHome === null || etAway === null) {
    return { text: "Tied at 90' — enter the score after extra time", tone: "muted" };
  }
  if (etHome < home || etAway < away) {
    return { text: "Extra-time score can't be below the 90' score", tone: "warn" };
  }

  const goals = etHome - home + (etAway - away);

  if (etHome !== etAway) {
    const winner = etHome > etAway ? homeTeam : awayTeam;
    return {
      text: `${goalsLabel(goals)} in extra time — ${winner} wins ${etHome}-${etAway} and advances`,
      tone: "muted",
    };
  }

  const stem =
    goals === 0
      ? "No goals in extra time — straight to penalties"
      : `${goalsLabel(goals)} in extra time, still level — straight to penalties`;
  if (penAdvance) {
    const winner = penAdvance === "HOME" ? homeTeam : awayTeam;
    return { text: `${stem}, ${winner} advances`, tone: "muted" };
  }
  return { text: stem, tone: "muted" };
}

/**
 * Secondary-line detail for a knockout prediction's extra-time / penalty plan,
 * or null when a decisive 90' was predicted (nothing extra to show).
 */
export function knockoutPredictionDetail(
  p: KnockoutPredFields,
  homeTeam: string,
  awayTeam: string,
): string | null {
  if (p.etHomeScore === null || p.etAwayScore === null) return null;
  let s = `${p.etHomeScore}-${p.etAwayScore} a.e.t.`;
  if (p.penAdvance === "HOME" || p.penAdvance === "AWAY") {
    s += `, ${p.penAdvance === "HOME" ? homeTeam : awayTeam} on pens`;
  }
  return s;
}

export type ArgentinaRoastInput = {
  home: number | null;
  away: number | null;
  etHome: number | null;
  etAway: number | null;
  penAdvance: AdvanceSide | null;
  homeTeam: string;
  awayTeam: string;
  stage: string;
};

const ARGENTINA_ROAST: Record<string, string> = {
  LAST_32: "Que estas poniendo pelotudo?",
  LAST_16: "Que te pasa la concha de tu hermana?",
  QUARTER_FINALS: "Nah bueno, vos sos un sorete",
  SEMI_FINALS: "Esta puteada preguntasela a Rodrigo, pero cuando termine el partido",
  FINAL: "AH VOS SOS EL MAS PECHO FRIO. QUE ESTAS PONIENDO ACA HIJO DE PUTA?",
};

/** The side the current inputs commit to advancing, or null while still undecided. */
function impliedAdvance(input: ArgentinaRoastInput): AdvanceSide | null {
  const { home, away, etHome, etAway, penAdvance } = input;
  if (home === null || away === null) return null;
  if (home !== away) return home > away ? "HOME" : "AWAY";
  if (etHome === null || etAway === null) return null;
  if (etHome !== etAway) return etHome > etAway ? "HOME" : "AWAY";
  return penAdvance;
}

/**
 * Easter egg for our all-Argentinean league: a stage-specific roast when the
 * current inputs commit to Argentina being knocked out. Null when Argentina is
 * not playing, is predicted to advance, the pick is undecided, or the stage has
 * no message. Pure; safe to call on every render.
 */
export function argentinaRoast(input: ArgentinaRoastInput): string | null {
  const argSide: AdvanceSide | null =
    input.homeTeam === "Argentina" ? "HOME" : input.awayTeam === "Argentina" ? "AWAY" : null;
  if (argSide === null) return null;

  const winner = impliedAdvance(input);
  if (winner === null || winner === argSide) return null;

  return ARGENTINA_ROAST[input.stage] ?? null;
}

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
