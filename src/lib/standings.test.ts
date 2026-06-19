import { describe, expect, it } from "vitest";
import { computeStandings } from "./standings";

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
