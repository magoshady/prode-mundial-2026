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
