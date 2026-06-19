export type DoubleCandidate = { id: number; stage: string; matchday: number };

/** The final round of group matches = the highest matchday among GROUP_STAGE games. */
export function lastRoundCandidates(apiMatches: DoubleCandidate[]): DoubleCandidate[] {
  const group = apiMatches.filter((m) => m.stage === "GROUP_STAGE");
  if (group.length === 0) return [];
  const last = Math.max(...group.map((m) => m.matchday));
  return group.filter((m) => m.matchday === last);
}

/** Pick one candidate using an injected RNG (testable; pass Math.random in production). */
export function pickDoubleMatch(candidates: DoubleCandidate[], rng: () => number): DoubleCandidate | null {
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

/** The double match is revealed only after it has finished. */
export function isDoubleRevealed(matchId: number, doubleMatchId: number | null, status: string): boolean {
  return doubleMatchId !== null && matchId === doubleMatchId && status === "FINISHED";
}
