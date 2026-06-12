import { describe, expect, it } from "vitest";
import { computeStandings } from "./standings";

const users = [
  { id: 1, name: "A", username: "a" },
  { id: 2, name: "B", username: "b" },
  { id: 3, name: "C", username: "c" },
];
const m = (id: number, h: number, a: number) => ({
  id, status: "FINISHED", homeScore: h, awayScore: a,
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
  it("ignores unfinished matches", () => {
    const live = { ...m(10, 1, 0), status: "IN_PLAY" };
    const rows = computeStandings(users.slice(0, 1), [live], [p(1, 10, 1, 0)]);
    expect(rows[0].points).toBe(0);
  });
});
