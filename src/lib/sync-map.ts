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

export function mapApiScore(score: FDScore) {
  return {
    // homeScore/awayScore keep the API's fullTime for group-stage scoring (unchanged).
    homeScore: score.fullTime.home,
    awayScore: score.fullTime.away,
    duration: score.duration,
    winner: resolveWinner(score),
    // For REGULAR matches the API omits regularTime, so fall back to fullTime.
    regularTimeHome: score.regularTime?.home ?? score.fullTime.home,
    regularTimeAway: score.regularTime?.away ?? score.fullTime.away,
    extraTimeHome: score.extraTime?.home ?? null,
    extraTimeAway: score.extraTime?.away ?? null,
    penaltiesHome: score.penalties?.home ?? null,
    penaltiesAway: score.penalties?.away ?? null,
  };
}
