import { describe, expect, it } from "vitest";
import { computeStandings, lastQuarterFinalId } from "./standings";

const users = [
  { id: 1, name: "A", username: "a" },
  { id: 2, name: "B", username: "b" },
  { id: 3, name: "C", username: "c" },
];
const m = (id: number, h: number, a: number) => ({
  id, stage: "GROUP_STAGE", status: "FINISHED", homeScore: h, awayScore: a,
  kickoffUtc: new Date("2026-06-11T19:00:00Z"), homeTeam: "X", awayTeam: "Y",
});
const p = (userId: number, matchId: number, h: number, a: number) => ({ userId, matchId, homeScore: h, awayScore: a });

describe("computeStandings", () => {
  it("totals points and exact hits, sorts by points then exacts", () => {
    const rows = computeStandings(users, [m(10, 2, 0), m(11, 1, 1)], [
      p(1, 10, 2, 0), p(1, 11, 0, 0), // A: 3 + 1 = 4, 1 exact
      p(2, 10, 1, 0), p(2, 11, 1, 1), // B: 1 + 3 = 4, 1 exact
      p(3, 10, 0, 1),                 // C: 0, no prediction for 11 = 0
    ]);
    expect(rows.map((r) => r.points)).toEqual([4, 4, 0]);
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(1); // tied on points AND exacts -> shared rank
    expect(rows[2].rank).toBe(3);
  });
  it("breaks point ties by exact count", () => {
    const rows = computeStandings(users.slice(0, 2), [m(10, 2, 0), m(11, 3, 0), m(12, 1, 0)], [
      p(1, 10, 2, 0),                 // A: 3 (1 exact)
      p(2, 10, 1, 0), p(2, 11, 2, 0), p(2, 12, 2, 0), // B: 1+1+1 = 3 (0 exact)
    ]);
    expect(rows[0].username).toBe("a");
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
  });
  it("sums goals off, skips missing picks, and leaves rank unaffected", () => {
    const rows = computeStandings(users, [m(10, 2, 0), m(11, 1, 1)], [
      p(1, 10, 2, 0), p(1, 11, 0, 0), // A: off 0 + (|0-1|+|0-1|)=2 -> 2
      p(2, 10, 1, 0), p(2, 11, 1, 1), // B: off (|1-2|+0)=1 + 0 -> 1
      p(3, 10, 0, 1),                 // C: off (|0-2|+|1-0|)=3; match 11 missing -> skipped -> 3
    ]);
    const byUser = Object.fromEntries(rows.map((r) => [r.username, r.goalsOff]));
    expect(byUser).toEqual({ a: 2, b: 1, c: 3 });
    // Ranking still by points: A and B tie at 4 pts/1 exact, C last. goalsOff must not reorder.
    expect(rows.map((r) => r.points)).toEqual([4, 4, 0]);
    expect(rows[2].username).toBe("c");
  });
  it("ignores unfinished matches", () => {
    const live = { ...m(10, 1, 0), status: "IN_PLAY" };
    const rows = computeStandings(users.slice(0, 1), [live], [p(1, 10, 1, 0)]);
    expect(rows[0].points).toBe(0);
  });
  it("applies no bonuses without a bonus context (frozen legacy behavior)", () => {
    // 2-0 exact would earn a clean sheet bonus, but without ctx the total stays 3.
    const rows = computeStandings(users.slice(0, 1), [m(10, 2, 0)], [p(1, 10, 2, 0)]);
    expect(rows[0].points).toBe(3);
  });
});

describe("computeStandings bonuses", () => {
  const bonusUsers = [{ id: 1, name: "A", username: "a" }];
  const FROM = new Date("2026-06-20T00:30:00Z");
  const after = (id: number, stage: string, h: number, a: number, home: string, away: string) => ({
    id, stage, kickoffUtc: new Date("2026-06-25T12:00:00Z"),
    homeTeam: home, awayTeam: away, status: "FINISHED", homeScore: h, awayScore: a,
  });
  const matches = [
    after(10, "GROUP_STAGE", 2, 0, "X", "Y"),       // exact 2-0 -> 3 + clean sheet 1
    after(11, "GROUP_STAGE", 4, 3, "P", "Q"),       // exact 4-3 -> 3 + cojones 2
    after(12, "SEMI_FINALS", 1, 0, "Morocco", "Z"),
    after(13, "FINAL", 1, 0, "Brazil", "W"),
  ];
  const bp = [
    { userId: 1, matchId: 10, homeScore: 2, awayScore: 0 },
    { userId: 1, matchId: 11, homeScore: 4, awayScore: 3 },
  ];

  it("adds clean-sheet and cojones from the cutoff onwards", () => {
    const [row] = computeStandings(bonusUsers, matches, bp, {
      picks: [], championTeam: null, goldenBootWinner: null, doubleMatchId: null, perMatchBonusFrom: FROM,
    });
    expect(row.points).toBe(9); // (3+1) + (3+2)
  });

  it("doubles base + per-match bonuses on the secret double match", () => {
    const [row] = computeStandings(bonusUsers, matches, bp, {
      picks: [], championTeam: null, goldenBootWinner: null, doubleMatchId: 11, perMatchBonusFrom: FROM,
    });
    expect(row.points).toBe(14); // match10: 4 ; match11 doubled: (3+2)*2 = 10
  });

  it("adds champion, golden boot and cumulative dark-horse picks", () => {
    const [row] = computeStandings(bonusUsers, matches, bp, {
      picks: [{ userId: 1, championTeam: "Brazil", goldenBootPlayer: "Salah", darkHorseTeam: "Morocco" }],
      championTeam: "Brazil", goldenBootWinner: "Salah", doubleMatchId: null, perMatchBonusFrom: FROM,
    });
    expect(row.bonus.champion).toBe(5);
    expect(row.bonus.goldenBoot).toBe(3);
    expect(row.bonus.darkHorse).toBe(3); // Morocco reached SEMI_FINALS only -> +3
    expect(row.points).toBe(9 + 5 + 3 + 3);
  });

  it("does NOT apply per-match bonuses to games before the cutoff", () => {
    const early = [{
      id: 20, stage: "GROUP_STAGE", kickoffUtc: new Date("2026-06-11T19:00:00Z"),
      homeTeam: "X", awayTeam: "Y", status: "FINISHED", homeScore: 2, awayScore: 0,
    }];
    const [row] = computeStandings(bonusUsers, early, [{ userId: 1, matchId: 20, homeScore: 2, awayScore: 0 }], {
      picks: [], championTeam: null, goldenBootWinner: null, doubleMatchId: null, perMatchBonusFrom: FROM,
    });
    expect(row.points).toBe(3); // exact only, clean sheet NOT counted retroactively
  });
});

describe("computeStandings knockout", () => {
  const u = [{ id: 1, name: "A", username: "a" }];
  const koMatch = (over: Record<string, unknown>) => ({
    id: 50, stage: "LAST_16", status: "FINISHED",
    kickoffUtc: new Date("2026-06-29T05:00:00Z"), homeTeam: "X", awayTeam: "Y",
    homeScore: null, awayScore: null,
    regularTimeHome: null, regularTimeAway: null, etHome: null, etAway: null,
    extraTimeHome: null, extraTimeAway: null, duration: null, winner: null,
    ...over,
  });

  it("awards full-distance knockout points and counts the 90' exact", () => {
    // Predicted 1-1 / 2-1 ET / home through; actual exactly that.
    const m = koMatch({
      homeScore: 2, awayScore: 1, regularTimeHome: 1, regularTimeAway: 1,
      extraTimeHome: 1, extraTimeAway: 0, duration: "EXTRA_TIME", winner: "HOME_TEAM",
    });
    const rows = computeStandings(u, [m as never], [
      { userId: 1, matchId: 50, homeScore: 1, awayScore: 1, etHomeScore: 2, etAwayScore: 1, penAdvance: null },
    ]);
    expect(rows[0].points).toBe(9); // 3 + 1 + 2 + 3
    expect(rows[0].exact).toBe(1);
  });

  it("scales knockout points by the stage multiplier, keeping half-points", () => {
    // Exact 2-1 home win decided in 90' -> knockout base = reg 3 + advance 3 = 6.
    const exactWin = (id: number, stage: string) =>
      koMatch({ id, stage, homeScore: 2, awayScore: 1, regularTimeHome: 2, regularTimeAway: 1, duration: "REGULAR", winner: "HOME_TEAM" });
    const exactPred = (matchId: number) =>
      ({ userId: 1, matchId, homeScore: 2, awayScore: 1, etHomeScore: null, etAwayScore: null, penAdvance: null });

    const noBombita = { picks: [{ userId: 1, championTeam: null, goldenBootPlayer: null, darkHorseTeam: null, bombitaMatchId: -1 }], championTeam: null, goldenBootWinner: null, doubleMatchId: null, perMatchBonusFrom: null };
    expect(computeStandings(u, [exactWin(60, "QUARTER_FINALS") as never], [exactPred(60)], noBombita)[0].points).toBe(9); // 6 * 1.5
    expect(computeStandings(u, [exactWin(61, "SEMI_FINALS") as never], [exactPred(61)])[0].points).toBe(12); // 6 * 2
    expect(computeStandings(u, [exactWin(62, "THIRD_PLACE") as never], [exactPred(62)])[0].points).toBe(15); // 6 * 2.5
    expect(computeStandings(u, [exactWin(63, "FINAL") as never], [exactPred(63)])[0].points).toBe(18); // 6 * 3
    expect(computeStandings(u, [exactWin(64, "LAST_16") as never], [exactPred(64)])[0].points).toBe(6); // x1, unchanged
  });

  it("keeps genuine half-points (x1.5 of an odd base) without rounding", () => {
    // Predict 1-1 / ET 2-1 home; actual 2-0 home win in 90'. Knockout base = advance only = 3; QF x1.5 = 4.5.
    const m = koMatch({ id: 65, stage: "QUARTER_FINALS", homeScore: 2, awayScore: 0, regularTimeHome: 2, regularTimeAway: 0, duration: "REGULAR", winner: "HOME_TEAM" });
    const rows = computeStandings(u, [m as never], [
      { userId: 1, matchId: 65, homeScore: 1, awayScore: 1, etHomeScore: 2, etAwayScore: 1, penAdvance: null },
    ], { picks: [{ userId: 1, championTeam: null, goldenBootPlayer: null, darkHorseTeam: null, bombitaMatchId: -1 }], championTeam: null, goldenBootWinner: null, doubleMatchId: null, perMatchBonusFrom: null });
    expect(rows[0].points).toBe(4.5);
  });

  it("applies clean-sheet/cojones to knockout matches, but never the group double", () => {
    // Exact 0-0 in 90' that goes to pens: knockout base 10, + clean-sheet 2 (both sides kept it). LAST_16 x1.
    const m = koMatch({
      homeScore: 4, awayScore: 3, regularTimeHome: 0, regularTimeAway: 0,
      extraTimeHome: 0, extraTimeAway: 0, duration: "PENALTY_SHOOTOUT", winner: "HOME_TEAM",
    });
    const rows = computeStandings(u, [m as never], [
      { userId: 1, matchId: 50, homeScore: 0, awayScore: 0, etHomeScore: 0, etAwayScore: 0, penAdvance: "HOME" },
    ], { picks: [], championTeam: null, goldenBootWinner: null, doubleMatchId: 50, perMatchBonusFrom: new Date("2026-01-01") });
    expect(rows[0].points).toBe(12); // (10 base + 2 clean-sheet) x1; the double (id 50) is ignored on knockouts
    expect(rows[0].bonus.perMatch).toBe(2);
  });

  it("adds knockout bonuses BEFORE the multiplier: (base + bonus) x mult", () => {
    // Exact 3-2 home win in 90' in a QF: base = reg 3 + advance 3 = 6, cojones +1 (5 goals).
    // (6 + 1) x 1.5 = 10.5 — the bonus is inside the multiply, and the half survives.
    const m = koMatch({ id: 66, stage: "QUARTER_FINALS", homeScore: 3, awayScore: 2, regularTimeHome: 3, regularTimeAway: 2, duration: "REGULAR", winner: "HOME_TEAM" });
    const rows = computeStandings(u, [m as never], [
      { userId: 1, matchId: 66, homeScore: 3, awayScore: 2, etHomeScore: null, etAwayScore: null, penAdvance: null },
    ], { picks: [{ userId: 1, championTeam: null, goldenBootPlayer: null, darkHorseTeam: null, bombitaMatchId: -1 }], championTeam: null, goldenBootWinner: null, doubleMatchId: null, perMatchBonusFrom: new Date("2026-01-01") });
    expect(rows[0].points).toBe(10.5);
    expect(rows[0].bonus.perMatch).toBe(1.5); // cojones 1 x 1.5
  });
});

describe("lastQuarterFinalId", () => {
  const mk = (id: number, iso: string) => ({ id, stage: "QUARTER_FINALS", kickoffUtc: new Date(iso) });
  it("picks the latest-kickoff QF", () => {
    expect(lastQuarterFinalId([mk(70, "2026-07-10T18:00:00Z"), mk(71, "2026-07-11T18:00:00Z")])).toBe(71);
  });
  it("breaks kickoff ties by lowest id", () => {
    expect(lastQuarterFinalId([mk(73, "2026-07-11T18:00:00Z"), mk(71, "2026-07-11T18:00:00Z")])).toBe(71);
  });
  it("is null when there are no QF matches", () => {
    expect(lastQuarterFinalId([{ id: 1, stage: "GROUP_STAGE", kickoffUtc: new Date("2026-06-11T18:00:00Z") }])).toBeNull();
  });
});

describe("computeStandings bombita", () => {
  const u = [{ id: 1, name: "A", username: "a" }];
  const FROM = new Date("2026-01-01");
  const qf = (id: number, iso: string, over: Record<string, unknown>) => ({
    id, stage: "QUARTER_FINALS", status: "FINISHED",
    kickoffUtc: new Date(iso), homeTeam: "X", awayTeam: "Y",
    homeScore: null, awayScore: null,
    regularTimeHome: null, regularTimeAway: null, etHome: null, etAway: null,
    extraTimeHome: null, extraTimeAway: null, duration: null, winner: null,
    ...over,
  });
  // Exact 2-1 home win in 90': knockout base = reg 3 + advance 3 = 6; no clean sheet, no cojones.
  const exactWin = (id: number, iso: string) =>
    qf(id, iso, { homeScore: 2, awayScore: 1, regularTimeHome: 2, regularTimeAway: 1, duration: "REGULAR", winner: "HOME_TEAM" });
  const pred = (matchId: number, h: number, a: number) =>
    ({ userId: 1, matchId, homeScore: h, awayScore: a, etHomeScore: null, etAwayScore: null, penAdvance: null });
  const ctx = (bombitaMatchId: number | null) => ({
    picks: [{ userId: 1, championTeam: null, goldenBootPlayer: null, darkHorseTeam: null, bombitaMatchId }],
    championTeam: null, goldenBootWinner: null, doubleMatchId: null, perMatchBonusFrom: FROM,
  });

  it("doubles the bombita match on an exact 90' (jackpot) and reports the delta", () => {
    const rows = computeStandings(u, [exactWin(70, "2026-07-10T18:00:00Z"), exactWin(71, "2026-07-11T18:00:00Z")],
      [pred(70, 2, 1)], ctx(70)); // bombita on QF #70 (not the last QF), no pred on #71
    expect(rows[0].points).toBe(18);        // normal 6 x1.5 = 9, doubled = 18
    expect(rows[0].bonus.bombita).toBe(9);  // delta over the normal 9
  });

  it("pays the 3 x mult floor when the bombita 90' is wrong but the advancer is right", () => {
    // Predict 3-0 home; actual 2-1 home in 90': reg=1 (not exact), advance=3.
    const m = qf(70, "2026-07-10T18:00:00Z", { homeScore: 2, awayScore: 1, regularTimeHome: 2, regularTimeAway: 1, duration: "REGULAR", winner: "HOME_TEAM" });
    const rows = computeStandings(u, [m as never, exactWin(71, "2026-07-11T18:00:00Z")], [pred(70, 3, 0)], ctx(70));
    expect(rows[0].points).toBe(4.5); // floor 3 x 1.5
  });

  it("is zero when the bombita misses both the score and the advancer", () => {
    // Predict 0-2 away; actual 2-1 home: reg=0, advance=0.
    const m = qf(70, "2026-07-10T18:00:00Z", { homeScore: 2, awayScore: 1, regularTimeHome: 2, regularTimeAway: 1, duration: "REGULAR", winner: "HOME_TEAM" });
    const rows = computeStandings(u, [m as never, exactWin(71, "2026-07-11T18:00:00Z")], [pred(70, 0, 2)], ctx(70));
    expect(rows[0].points).toBe(0);
  });

  it("forces a 0 on the last QF for a player who never set a bombita", () => {
    // No bombita; predicts both QFs exactly. #71 is the last QF -> forced 0. #70 scores normally (9).
    const rows = computeStandings(u, [exactWin(70, "2026-07-10T18:00:00Z"), exactWin(71, "2026-07-11T18:00:00Z")],
      [pred(70, 2, 1), pred(71, 2, 1)], ctx(null));
    expect(rows[0].points).toBe(9);          // 9 (QF#70) + 0 (QF#71 penalty)
    expect(rows[0].bonus.bombita).toBe(-9);  // the penalty delta on #71
  });

  it("does NOT penalise a player who bombita'd an earlier QF", () => {
    // Bombita on #70 (jackpot 18); #71 is the last QF but they have a bombita, so it scores normally (9).
    const rows = computeStandings(u, [exactWin(70, "2026-07-10T18:00:00Z"), exactWin(71, "2026-07-11T18:00:00Z")],
      [pred(70, 2, 1), pred(71, 2, 1)], ctx(70));
    expect(rows[0].points).toBe(27); // 18 + 9
  });
});
