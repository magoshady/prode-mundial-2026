import { describe, expect, it } from "vitest";
import { isOpenForPrediction, isScoreable, othersVisible } from "./rules";

const base = {
  kickoffUtc: new Date("2026-06-20T18:00:00Z"),
  homeTeam: "Argentina",
  awayTeam: "Brazil",
  status: "TIMED",
  homeScore: null as number | null,
  awayScore: null as number | null,
};
const before = new Date("2026-06-20T17:59:00Z");
const after = new Date("2026-06-20T18:00:00Z");

describe("isOpenForPrediction", () => {
  it("open before kickoff with both teams known", () => {
    expect(isOpenForPrediction(base, before)).toBe(true);
  });
  it("locked at/after kickoff", () => {
    expect(isOpenForPrediction(base, after)).toBe(false);
  });
  it("locked while teams TBD (knockouts)", () => {
    expect(isOpenForPrediction({ ...base, homeTeam: null }, before)).toBe(false);
    expect(isOpenForPrediction({ ...base, awayTeam: null }, before)).toBe(false);
  });
});

describe("othersVisible", () => {
  it("hidden before kickoff", () => expect(othersVisible(base, before)).toBe(false));
  it("visible from kickoff", () => expect(othersVisible(base, after)).toBe(true));
});

describe("isScoreable", () => {
  it("only FINISHED matches with scores count", () => {
    expect(isScoreable({ ...base, status: "FINISHED", homeScore: 2, awayScore: 0 })).toBe(true);
    expect(isScoreable({ ...base, status: "IN_PLAY", homeScore: 1, awayScore: 0 })).toBe(false);
    expect(isScoreable({ ...base, status: "FINISHED" })).toBe(false);
  });
});
