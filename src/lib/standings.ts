import { isScoreable, type MatchLike } from "./rules";
import { cleanSheetBonus, cojonesBonus, goalsOff, predictionPoints } from "./scoring";
import { championPoints, darkHorsePoints, goldenBootPoints, stageMultiplier } from "./bonus";
import { knockoutPoints, toKnockoutPrediction, toKnockoutResult } from "./knockout";

type UserLite = { id: number; name: string; username: string };
type PredLite = {
  userId: number; matchId: number; homeScore: number; awayScore: number;
  etHomeScore?: number | null; etAwayScore?: number | null; penAdvance?: string | null;
};
type MatchRow = MatchLike & {
  id: number; stage: string;
  regularTimeHome?: number | null; regularTimeAway?: number | null;
  extraTimeHome?: number | null; extraTimeAway?: number | null;
  duration?: string | null; winner?: string | null;
};

export type BonusPickRow = {
  userId: number;
  championTeam: string | null;
  goldenBootPlayer: string | null;
  darkHorseTeam: string | null;
};
export type BonusContext = {
  picks: BonusPickRow[];
  championTeam: string | null;
  goldenBootWinner: string | null;
  doubleMatchId: number | null;
  /** Per-match bonuses (clean sheet, cojones, double) only apply to matches kicking
   *  off at or after this instant. Earlier games keep their original 3/1/0 scoring. */
  perMatchBonusFrom: Date | null;
};

export type StandingRow = {
  userId: number;
  name: string;
  username: string;
  points: number;
  exact: number;
  outcomes: number; // 1-point hits
  goalsOff: number; // total |Δgoals|, informational only — does not affect rank
  bonus: { perMatch: number; champion: number; goldenBoot: number; darkHorse: number; total: number };
  rank: number;
};

/** Stages a team appears in (home or away), for Dark Horse resolution. */
function stagesReachedByTeam(matches: MatchRow[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (team: string | null, stage: string) => {
    if (!team) return;
    const s = m.get(team) ?? new Set<string>();
    s.add(stage);
    m.set(team, s);
  };
  for (const match of matches) {
    add(match.homeTeam, match.stage);
    add(match.awayTeam, match.stage);
  }
  return m;
}

export function computeStandings(
  users: UserLite[],
  matches: MatchRow[],
  preds: PredLite[],
  ctx?: BonusContext,
): StandingRow[] {
  const finished = matches.filter(isScoreable);
  const byUserMatch = new Map(preds.map((p) => [`${p.userId}:${p.matchId}`, p]));
  const picksByUser = new Map((ctx?.picks ?? []).map((p) => [p.userId, p]));
  const reached = stagesReachedByTeam(matches);
  const championTeam = ctx?.championTeam ?? null;
  const goldenBootWinner = ctx?.goldenBootWinner ?? null;
  const doubleMatchId = ctx?.doubleMatchId ?? null;
  const perMatchFrom = ctx?.perMatchBonusFrom ?? null;

  const rows = users.map((u) => {
    let points = 0, exact = 0, outcomes = 0, off = 0, perMatchBonus = 0;
    for (const m of finished) {
      const p = byUserMatch.get(`${u.id}:${m.id}`);

      if (m.stage !== "GROUP_STAGE") {
        const koResult = toKnockoutResult({
          regHome: m.regularTimeHome ?? null, regAway: m.regularTimeAway ?? null,
          etHome: m.extraTimeHome ?? null, etAway: m.extraTimeAway ?? null,
          duration: m.duration ?? null, winner: m.winner ?? null,
        });
        if (!koResult) continue; // not yet scoreable as a knockout (missing phase data)
        const koPred = p
          ? toKnockoutPrediction({ homeScore: p.homeScore, awayScore: p.awayScore, etHomeScore: p.etHomeScore ?? null, etAwayScore: p.etAwayScore ?? null, penAdvance: p.penAdvance ?? null })
          : null;
        const bd = knockoutPoints(koPred, koResult);
        // Clean-sheet / cojones apply on the 90' score, same as the group stage, from the cutoff
        // onwards. Then the whole match total is scaled by the stage: (base + bonus) * multiplier.
        // The group "double" never applies to knockouts. Half-points (x1.5, x2.5) are kept as-is.
        const koEligible = perMatchFrom !== null && m.kickoffUtc.getTime() >= perMatchFrom.getTime();
        const koCs = koEligible ? cleanSheetBonus(koPred?.reg ?? null, koResult.reg) : 0;
        const koCj = koEligible ? cojonesBonus(koPred?.reg ?? null, koResult.reg) : 0;
        const koMult = stageMultiplier(m.stage);
        points += (bd.total + koCs + koCj) * koMult;
        perMatchBonus += (koCs + koCj) * koMult; // bonus portion, scaled by the stage
        if (bd.reg === 3) exact++;
        else if (bd.reg === 1) outcomes++;
        off += goalsOff(koPred?.reg ?? null, koResult.reg) ?? 0;
        continue;
      }

      const pred = p ? { home: p.homeScore, away: p.awayScore } : null;
      const result = { home: m.homeScore!, away: m.awayScore! };
      const base = predictionPoints(pred, result);
      // Per-match bonuses only apply from the cutoff onwards; earlier games keep base scoring.
      const eligible = perMatchFrom !== null && m.kickoffUtc.getTime() >= perMatchFrom.getTime();
      const cs = eligible ? cleanSheetBonus(pred, result) : 0;
      const cj = eligible ? cojonesBonus(pred, result) : 0;
      const isDouble = eligible && m.id === doubleMatchId;
      const matchTotal = (base + cs + cj) * (isDouble ? 2 : 1);
      points += matchTotal;
      perMatchBonus += matchTotal - base; // bonus portion incl. the doubling
      if (base === 3) exact++;
      if (base === 1) outcomes++;
      off += goalsOff(pred, result) ?? 0;
    }

    const pick = picksByUser.get(u.id);
    const champion = championPoints(pick?.championTeam ?? null, championTeam);
    const goldenBoot = goldenBootPoints(pick?.goldenBootPlayer ?? null, goldenBootWinner);
    const dhTeam = pick?.darkHorseTeam ?? null;
    const dhStages = dhTeam ? (reached.get(dhTeam) ?? new Set<string>()) : new Set<string>();
    const wonFinal = !!(dhTeam && championTeam && dhTeam === championTeam);
    const darkHorse = darkHorsePoints(dhTeam, dhStages, wonFinal);

    points += champion + goldenBoot + darkHorse;
    const bonusTotal = perMatchBonus + champion + goldenBoot + darkHorse;

    return {
      userId: u.id, name: u.name, username: u.username,
      points, exact, outcomes, goalsOff: off,
      bonus: { perMatch: perMatchBonus, champion, goldenBoot, darkHorse, total: bonusTotal },
      rank: 0,
    };
  });

  rows.sort((a, b) => b.points - a.points || b.exact - a.exact || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.points === r.points && prev.exact === r.exact ? prev.rank : i + 1;
  });
  return rows;
}
