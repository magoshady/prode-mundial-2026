import { describe, expect, it } from "vitest";
import {
  championPoints, goldenBootPoints, darkHorsePoints, picksDeadlinePassed, isFieldLocked, allPicksSubmitted,
  stageMultiplier, UNDERDOG_TEAMS, GOLDEN_BOOT_CANDIDATES, bombitaWindowOpen, nextBombita,
} from "./bonus";

describe("curated lists", () => {
  it("has the long-shot underdog pool and a non-empty golden boot shortlist", () => {
    expect(UNDERDOG_TEAMS).toHaveLength(17);
    expect(UNDERDOG_TEAMS).toContain("Czechia");
    expect(UNDERDOG_TEAMS).not.toContain("Morocco");
    expect(GOLDEN_BOOT_CANDIDATES.length).toBeGreaterThan(0);
  });
});

describe("championPoints", () => {
  it("gives +5 on a correct champion, 0 otherwise", () => {
    expect(championPoints("Brazil", "Brazil")).toBe(5);
    expect(championPoints("Brazil", "France")).toBe(0);
    expect(championPoints(null, "Brazil")).toBe(0);
    expect(championPoints("Brazil", null)).toBe(0);
  });
});

describe("goldenBootPoints", () => {
  it("gives +3 on a correct top scorer, 0 otherwise", () => {
    expect(goldenBootPoints("Kylian Mbappé", "Kylian Mbappé")).toBe(3);
    expect(goldenBootPoints("Harry Kane", "Kylian Mbappé")).toBe(0);
    expect(goldenBootPoints(null, "Kylian Mbappé")).toBe(0);
  });
});

describe("darkHorsePoints", () => {
  const all = new Set(["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "FINAL"]);
  it("is 0 with no pick or no progress", () => {
    expect(darkHorsePoints(null, all, true)).toBe(0);
    expect(darkHorsePoints("Morocco", new Set(), false)).toBe(0);
  });
  it("stacks cumulatively per stage reached", () => {
    expect(darkHorsePoints("Morocco", new Set(["LAST_32"]), false)).toBe(2);
    expect(darkHorsePoints("Morocco", new Set(["LAST_32", "LAST_16"]), false)).toBe(4);
    expect(darkHorsePoints("Morocco", new Set(["LAST_32", "LAST_16", "QUARTER_FINALS"]), false)).toBe(7);
    expect(darkHorsePoints("Morocco", new Set(["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS"]), false)).toBe(10);
    expect(darkHorsePoints("Morocco", all, false)).toBe(15); // reached final, did not win
  });
  it("gives the full 25 for winning the final", () => {
    expect(darkHorsePoints("Morocco", all, true)).toBe(25);
  });
});

describe("stageMultiplier", () => {
  it("keeps the group stage and early knockout rounds at x1", () => {
    expect(stageMultiplier("GROUP_STAGE")).toBe(1);
    expect(stageMultiplier("LAST_32")).toBe(1);
    expect(stageMultiplier("LAST_16")).toBe(1);
  });
  it("escalates through the late rounds", () => {
    expect(stageMultiplier("QUARTER_FINALS")).toBe(1.5);
    expect(stageMultiplier("SEMI_FINALS")).toBe(2);
    expect(stageMultiplier("THIRD_PLACE")).toBe(2.5);
    expect(stageMultiplier("FINAL")).toBe(3);
  });
  it("defaults an unknown stage to x1", () => {
    expect(stageMultiplier("SOMETHING_ELSE")).toBe(1);
  });
});

describe("picks deadline + per-field lock", () => {
  const deadline = new Date("2026-06-21T12:00:00Z");
  const before = new Date("2026-06-21T11:00:00Z");
  const after = new Date("2026-06-21T13:00:00Z");

  it("deadline passes only at or after the deadline", () => {
    expect(picksDeadlinePassed(deadline, before)).toBe(false);
    expect(picksDeadlinePassed(deadline, after)).toBe(true);
    expect(picksDeadlinePassed(null, after)).toBe(false);
  });
  it("an unset field is editable before the deadline", () => {
    expect(isFieldLocked(null, deadline, before)).toBe(false);
  });
  it("a set field is final immediately, even before the deadline", () => {
    expect(isFieldLocked("Brazil", deadline, before)).toBe(true);
  });
  it("any field is locked once the deadline passes", () => {
    expect(isFieldLocked(null, deadline, after)).toBe(true);
  });
});

describe("bombitaWindowOpen", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  it("is open for a QF match that has not kicked off", () => {
    expect(bombitaWindowOpen({ stage: "QUARTER_FINALS", kickoffUtc: new Date("2026-07-10T18:00:00Z") }, now)).toBe(true);
  });
  it("is closed once the QF match has kicked off", () => {
    expect(bombitaWindowOpen({ stage: "QUARTER_FINALS", kickoffUtc: new Date("2026-07-10T10:00:00Z") }, now)).toBe(false);
  });
  it("is closed for non-QF stages", () => {
    expect(bombitaWindowOpen({ stage: "SEMI_FINALS", kickoffUtc: new Date("2026-07-14T18:00:00Z") }, now)).toBe(false);
  });
});

describe("nextBombita", () => {
  it("sets the bombita on a match when there was none", () => {
    expect(nextBombita(null, 50, true)).toBe(50);
  });
  it("MOVES the bombita off the existing match onto the newly-selected one", () => {
    expect(nextBombita(50, 51, true)).toBe(51);
  });
  it("clears the bombita when unticking the current match", () => {
    expect(nextBombita(50, 50, false)).toBeNull();
  });
  it("leaves the bombita untouched when unticking a different match", () => {
    expect(nextBombita(50, 51, false)).toBe(50);
  });
});

describe("allPicksSubmitted", () => {
  const full = (userId: number) => ({ userId, championTeam: "Brazil", goldenBootPlayer: "Salah", darkHorseTeam: "Morocco" });
  it("is true only when every user has all three picks", () => {
    expect(allPicksSubmitted([1, 2], [full(1), full(2)])).toBe(true);
  });
  it("is false if a user is missing a row", () => {
    expect(allPicksSubmitted([1, 2], [full(1)])).toBe(false);
  });
  it("is false if a user has an incomplete row", () => {
    expect(allPicksSubmitted([1, 2], [full(1), { userId: 2, championTeam: "France", goldenBootPlayer: null, darkHorseTeam: "Japan" }])).toBe(false);
  });
  it("is false with no users", () => {
    expect(allPicksSubmitted([], [])).toBe(false);
  });
});
