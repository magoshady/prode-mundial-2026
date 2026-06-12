export type MatchLike = {
  kickoffUtc: Date;
  homeTeam: string | null;
  awayTeam: string | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
};

/** Predictable: both teams known and kickoff not reached. Enforced server-side. */
export function isOpenForPrediction(m: Pick<MatchLike, "kickoffUtc" | "homeTeam" | "awayTeam">, now: Date): boolean {
  return Boolean(m.homeTeam && m.awayTeam) && now.getTime() < m.kickoffUtc.getTime();
}

/** Other players' predictions are revealed once the match kicks off. */
export function othersVisible(m: Pick<MatchLike, "kickoffUtc">, now: Date): boolean {
  return now.getTime() >= m.kickoffUtc.getTime();
}

/** A match awards points only when finished with a recorded score. */
export function isScoreable(m: Pick<MatchLike, "status" | "homeScore" | "awayScore">): boolean {
  return m.status === "FINISHED" && m.homeScore !== null && m.awayScore !== null;
}
