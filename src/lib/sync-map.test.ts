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

  it("derives EXTRA_TIME from ET goals even when the API flaps duration to REGULAR", () => {
    // Observed live: football-data served duration REGULAR on a finished ET match
    // while extraTime stayed {1,0}. Trust the stable score shape, not the string.
    const out = mapApiScore({
      winner: "HOME_TEAM", duration: "REGULAR",
      fullTime: { home: 3, away: 2 }, regularTime: { home: null, away: null }, extraTime: { home: 1, away: 0 },
    });
    expect(out).toMatchObject({ duration: "EXTRA_TIME", regularTimeHome: 2, regularTimeAway: 2, extraTimeHome: 1 });
  });

  it("derives PENALTY_SHOOTOUT from penalties even if duration disagrees", () => {
    const out = mapApiScore({
      winner: "AWAY_TEAM", duration: "EXTRA_TIME",
      fullTime: { home: 4, away: 5 }, regularTime: { home: 1, away: 1 }, extraTime: { home: 0, away: 0 }, penalties: { home: 3, away: 4 },
    });
    expect(out.duration).toBe("PENALTY_SHOOTOUT");
  });

  it("keeps REGULAR when there is no ET or penalty data", () => {
    const out = mapApiScore({ winner: "HOME_TEAM", duration: "REGULAR", fullTime: { home: 2, away: 0 } });
    expect(out.duration).toBe("REGULAR");
  });

  it("EXTRA_TIME with regularTime null: derives the 90' score as fullTime minus ET goals", () => {
    // Real case: Belgium 3-2 Senegal a.e.t. — 2-2 at 90', 1-0 in ET. API returns regularTime {null,null}.
    const out = mapApiScore({
      winner: "HOME_TEAM", duration: "EXTRA_TIME",
      fullTime: { home: 3, away: 2 }, regularTime: { home: null, away: null }, extraTime: { home: 1, away: 0 },
    });
    expect(out).toMatchObject({
      regularTimeHome: 2, regularTimeAway: 2, extraTimeHome: 1, extraTimeAway: 0, duration: "EXTRA_TIME",
    });
  });

  it("PENALTY with regularTime null: backs out both ET and penalty goals from fullTime", () => {
    const out = mapApiScore({
      winner: "AWAY_TEAM", duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 4, away: 5 }, regularTime: { home: null, away: null }, extraTime: { home: 0, away: 0 }, penalties: { home: 3, away: 4 },
    });
    expect(out).toMatchObject({ regularTimeHome: 1, regularTimeAway: 1, penaltiesHome: 3, penaltiesAway: 4 });
  });

  it("keeps a legitimate 0-0 at 90' (regularTime present as zeros, not treated as missing)", () => {
    const out = mapApiScore({
      winner: "HOME_TEAM", duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 3, away: 2 }, regularTime: { home: 0, away: 0 }, extraTime: { home: 0, away: 0 }, penalties: { home: 3, away: 2 },
    });
    expect(out).toMatchObject({ regularTimeHome: 0, regularTimeAway: 0 });
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

  it("derives a null winner from fullTime (API quirk: finished shootout, winner unset)", () => {
    // Real case: Germany 1-1 Paraguay, 4-4 pens shown, fullTime 4-5 → Paraguay (away) advanced.
    const out = mapApiScore({
      winner: null, duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 4, away: 5 }, regularTime: { home: 1, away: 1 }, extraTime: { home: 0, away: 0 }, penalties: { home: 4, away: 4 },
    });
    expect(out.winner).toBe("AWAY_TEAM");
  });

  it("derives a null winner to HOME_TEAM when fullTime favours home", () => {
    const out = mapApiScore({
      winner: null, duration: "PENALTY_SHOOTOUT",
      fullTime: { home: 5, away: 4 }, regularTime: { home: 1, away: 1 }, extraTime: { home: 0, away: 0 }, penalties: { home: 4, away: 4 },
    });
    expect(out.winner).toBe("HOME_TEAM");
  });

  it("leaves winner null when it cannot be derived (fullTime level or unknown)", () => {
    expect(mapApiScore({ winner: null, duration: "REGULAR", fullTime: { home: 1, away: 1 } }).winner).toBeNull();
    expect(mapApiScore({ winner: null, duration: "REGULAR", fullTime: { home: null, away: null } }).winner).toBeNull();
  });

  it("never overrides a winner the API already provided", () => {
    const out = mapApiScore({ winner: "AWAY_TEAM", duration: "REGULAR", fullTime: { home: 3, away: 0 } });
    expect(out.winner).toBe("AWAY_TEAM");
  });
});
