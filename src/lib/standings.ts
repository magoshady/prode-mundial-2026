import { isScoreable, type MatchLike } from "./rules";
import { goalsOff, predictionPoints } from "./scoring";

type UserLite = { id: number; name: string; username: string };
type PredLite = { userId: number; matchId: number; homeScore: number; awayScore: number };
type MatchRow = MatchLike & { id: number };

export type StandingRow = {
  userId: number;
  name: string;
  username: string;
  points: number;
  exact: number;
  outcomes: number; // 1-point hits
  goalsOff: number; // total |Δgoals|, informational only — does not affect rank
  rank: number;
};

export function computeStandings(users: UserLite[], matches: MatchRow[], preds: PredLite[]): StandingRow[] {
  const finished = matches.filter(isScoreable);
  const byUserMatch = new Map(preds.map((p) => [`${p.userId}:${p.matchId}`, p]));

  const rows = users.map((u) => {
    let points = 0, exact = 0, outcomes = 0, off = 0;
    for (const m of finished) {
      const p = byUserMatch.get(`${u.id}:${m.id}`);
      const pred = p ? { home: p.homeScore, away: p.awayScore } : null;
      const result = { home: m.homeScore!, away: m.awayScore! };
      const pts = predictionPoints(pred, result);
      points += pts;
      if (pts === 3) exact++;
      if (pts === 1) outcomes++;
      off += goalsOff(pred, result) ?? 0;
    }
    return { userId: u.id, name: u.name, username: u.username, points, exact, outcomes, goalsOff: off, rank: 0 };
  });

  rows.sort((a, b) => b.points - a.points || b.exact - a.exact || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.points === r.points && prev.exact === r.exact ? prev.rank : i + 1;
  });
  return rows;
}
