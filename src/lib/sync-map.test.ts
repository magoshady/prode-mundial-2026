import { describe, expect, it } from "vitest";
import { mapApiScore } from "./sync-map";

describe("mapApiScore", () => {
  it("REGULAR match: regularTime falls back to fullTime, no ET/pens", () => {
    const out = mapApiScore({ winner: "HOME_TEAM", duration: "REGULAR", fullTime: { home: 2, away: 0 } });
    expect(out).toMatchObject({
      homeScore: 2, awayScore: 0, duration: "REGULAR", winner: "HOME_TEAM",
      regularTimeHome: 2, regularTimeAway: 0,
      extraTimeHome: null, extraTimeAway: null, penaltiesHome: null, penaltiesAway: null,
    });
  });

  it("EXTRA_TIME match: keeps regular and extra time separately", () => {
    const out = mapApiScore({
      winner: "HOME_TEAM", duration: "EXTRA_TIME",
      fullTime: { home: 2, away: 1 }, regularTime: { home: 1, away: 1 }, extraTime: { home: 1, away: 0 },
    });
    expect(out).toMatchObject({
      regularTimeHome: 1, regularTimeAway: 1, extraTimeHome: 1, extraTimeAway: 0, duration: "EXTRA_TIME",
    });
  });

  it("PENALTY_SHOOTOUT: regularTime is the run-of-play, NOT the fullTime shootout result", () => {
    const out = mapApiScore({
      winner: "HOME_TEAM", duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 3, away: 0 }, regularTime: { home: 0, away: 0 }, extraTime: { home: 0, away: 0 }, penalties: { home: 3, away: 0 },
    });
    expect(out).toMatchObject({
      regularTimeHome: 0, regularTimeAway: 0, penaltiesHome: 3, penaltiesAway: 0, duration: "PENALTY_SHOOTOUT",
    });
  });
});
