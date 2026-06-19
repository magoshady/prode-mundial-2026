export type ScorePair = { home: number; away: number };

/** 3 = exact score, 1 = correct outcome (win/draw/loss), 0 = miss or no prediction. */
export function predictionPoints(pred: ScorePair | null | undefined, result: ScorePair): 0 | 1 | 3 {
  if (!pred) return 0;
  if (pred.home === result.home && pred.away === result.away) return 3;
  if (Math.sign(pred.home - pred.away) === Math.sign(result.home - result.away)) return 1;
  return 0;
}

/** Total goals away from reality: |Δhome| + |Δaway|. null when no prediction (skipped). */
export function goalsOff(pred: ScorePair | null | undefined, result: ScorePair): number | null {
  if (!pred) return null;
  return Math.abs(pred.home - result.home) + Math.abs(pred.away - result.away);
}

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
