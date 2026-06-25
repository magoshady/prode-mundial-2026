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
