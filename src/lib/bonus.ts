/** Dark Horse selectable pool — true long-shots, using exact API name strings. */
export const UNDERDOG_TEAMS: readonly string[] = [
  "Czechia", "South Africa", "Bosnia-Herzegovina", "Scotland", "Paraguay", "Sweden",
  "New Zealand", "Iran", "Saudi Arabia", "Iraq", "Austria", "Jordan", "Algeria",
  "Congo DR", "Uzbekistan", "Ghana", "Panama",
];

/** Golden Boot shortlist. Functional default — edit names freely; must match the
 *  `golden_boot_winner` value an admin enters at tournament end. */
export const GOLDEN_BOOT_CANDIDATES: string[] = [
  "Kylian Mbappé", "Erling Haaland", "Harry Kane", "Lionel Messi", "Julián Álvarez",
  "Lautaro Martínez", "Vinícius Júnior", "Rodrygo", "Cristiano Ronaldo", "Gonçalo Ramos",
  "Lamine Yamal", "Álvaro Morata", "Mohamed Salah", "Romelu Lukaku", "Memphis Depay",
  "Cody Gakpo", "Jamal Musiala", "Kai Havertz", "Antoine Griezmann", "Jude Bellingham",
  "Bukayo Saka", "Phil Foden", "Christian Pulisic", "Darwin Núñez", "Federico Valverde",
  "Alexander Isak", "Viktor Gyökeres", "Takefusa Kubo", "Youssef En-Nesyri", "Kenan Yıldız",
];

/** Per-match bonuses (clean sheet, cojones, double) count only from this kickoff onward —
 *  the Brazil vs Haiti match (id 537341). Earlier games keep their original 3/1/0 scoring. */
export const PER_MATCH_BONUS_FROM = new Date("2026-06-20T00:30:00Z");

export const CHAMPION_POINTS = 5;
export const GOLDEN_BOOT_POINTS = 3;

/** The later the round, the more each match is worth. Applies to a knockout match's
 *  points (group stage and the round of 32/16 stay at ×1). Half-points are kept as-is
 *  — ×1.5 and ×2.5 can yield a .5, which we do NOT round. */
export const STAGE_MULTIPLIERS: Record<string, number> = {
  QUARTER_FINALS: 1.5,
  SEMI_FINALS: 2,
  THIRD_PLACE: 2.5,
  FINAL: 3,
};

export function stageMultiplier(stage: string): number {
  return STAGE_MULTIPLIERS[stage] ?? 1;
}

/** Cumulative points awarded the first time the Dark Horse pick reaches each stage. */
export const DARK_HORSE_STAGE_POINTS: Record<string, number> = {
  LAST_32: 2,        // passed group stage
  LAST_16: 2,        // passed round of 32 (16avos)
  QUARTER_FINALS: 3, // passed round of 16 (8vos)
  SEMI_FINALS: 3,    // passed quarter-finals (4tos)
  FINAL: 5,          // passed semis
};
export const DARK_HORSE_FINAL_WIN_POINTS = 10;

/** One-time picks: everyone has a 24h window to submit; after the deadline nobody can set
 *  a pick. Independently, each pick is final the moment it is set — it cannot be changed. */
export function picksDeadlinePassed(deadline: Date | null, now: Date): boolean {
  return !!(deadline && now.getTime() >= deadline.getTime());
}

/** A pick is locked if it already has a value (final once submitted) or the window closed. */
export function isFieldLocked(currentValue: string | null, deadline: Date | null, now: Date): boolean {
  return currentValue != null || picksDeadlinePassed(deadline, now);
}

type PickRow = { userId: number; championTeam: string | null; goldenBootPlayer: string | null; darkHorseTeam: string | null };

/** True only when every user has all three picks set — gate for revealing the summary. */
export function allPicksSubmitted(userIds: number[], picks: PickRow[]): boolean {
  if (userIds.length === 0) return false;
  const byUser = new Map(picks.map((p) => [p.userId, p]));
  return userIds.every((id) => {
    const p = byUser.get(id);
    return !!(p && p.championTeam && p.goldenBootPlayer && p.darkHorseTeam);
  });
}

export function championPoints(pick: string | null, championTeam: string | null): number {
  return pick && championTeam && pick === championTeam ? CHAMPION_POINTS : 0;
}

export function goldenBootPoints(pick: string | null, winner: string | null): number {
  return pick && winner && pick === winner ? GOLDEN_BOOT_POINTS : 0;
}

/** You may set/move a bombita only onto a QF match that has not yet kicked off. */
export function bombitaWindowOpen(match: { stage: string; kickoffUtc: Date }, now: Date): boolean {
  return match.stage === "QUARTER_FINALS" && now.getTime() < match.kickoffUtc.getTime();
}

export function darkHorsePoints(pick: string | null, reachedStages: Set<string>, wonFinal: boolean): number {
  if (!pick) return 0;
  let pts = 0;
  for (const [stage, p] of Object.entries(DARK_HORSE_STAGE_POINTS)) {
    if (reachedStages.has(stage)) pts += p;
  }
  if (wonFinal) pts += DARK_HORSE_FINAL_WIN_POINTS;
  return pts;
}
