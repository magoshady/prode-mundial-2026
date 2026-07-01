export type FDScore = {
  winner: string | null;
  duration: string;
  fullTime: { home: number | null; away: number | null };
  regularTime?: { home: number | null; away: number | null } | null;
  extraTime?: { home: number | null; away: number | null } | null;
  penalties?: { home: number | null; away: number | null } | null;
};

/**
 * The API occasionally leaves `winner` null on a finished knockout (notably some
 * penalty shootouts) even though `fullTime` already encodes the decisive result.
 * Fall back to fullTime so the match can still be scored. Returns null when the
 * winner genuinely can't be inferred (level or missing fullTime).
 */
function resolveWinner(score: FDScore): string | null {
  if (score.winner) return score.winner;
  const { home, away } = score.fullTime;
  if (home === null || away === null || home === away) return null;
  return home > away ? "HOME_TEAM" : "AWAY_TEAM";
}

/**
 * The 90' score for one side. `regularTime` holds it when present, but the API
 * sometimes returns it as null on extra-time/penalty matches. `fullTime` is the
 * aggregate — it already folds in ET goals (and, for shootouts, penalty goals) —
 * so when `regularTime` is missing we back the 90' score out of it. Note a genuine
 * 0 at 90' must be kept: only null/undefined counts as "missing".
 */
function regulationScore(score: FDScore, side: "home" | "away"): number | null {
  const rt = score.regularTime?.[side];
  if (rt !== null && rt !== undefined) return rt;
  const ft = score.fullTime[side];
  if (ft === null) return null;
  return ft - (score.extraTime?.[side] ?? 0) - (score.penalties?.[side] ?? 0);
}

const hasValue = (p?: { home: number | null; away: number | null } | null) =>
  !!p && (p.home !== null || p.away !== null);

/**
 * The API's `duration` is unreliable on some finished matches — observed live
 * flapping between REGULAR and EXTRA_TIME on the same game across consecutive
 * requests, which would drop the "reached extra time" points whenever the cron
 * happened to snapshot a REGULAR moment. The score *shape* is stable, so derive
 * duration from it: penalties present → shootout, ET goals present → extra time,
 * otherwise fall back to the reported duration.
 */
function resolveDuration(score: FDScore): string {
  if (hasValue(score.penalties)) return "PENALTY_SHOOTOUT";
  if (hasValue(score.extraTime)) return "EXTRA_TIME";
  return score.duration ?? "REGULAR";
}

export function mapApiScore(score: FDScore) {
  return {
    // homeScore/awayScore keep the API's fullTime for group-stage scoring (unchanged).
    homeScore: score.fullTime.home,
    awayScore: score.fullTime.away,
    duration: resolveDuration(score),
    winner: resolveWinner(score),
    regularTimeHome: regulationScore(score, "home"),
    regularTimeAway: regulationScore(score, "away"),
    extraTimeHome: score.extraTime?.home ?? null,
    extraTimeAway: score.extraTime?.away ?? null,
    penaltiesHome: score.penalties?.home ?? null,
    penaltiesAway: score.penalties?.away ?? null,
  };
}
