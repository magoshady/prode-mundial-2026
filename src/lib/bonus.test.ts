import { describe, expect, it } from "vitest";
import {
  championPoints, goldenBootPoints, darkHorsePoints, picksDeadlinePassed, isFieldLocked, allPicksSubmitted,
  UNDERDOG_TEAMS, GOLDEN_BOOT_CANDIDATES,
} from "./bonus";

describe("curated lists", () => {
  it("has the 16-team underdog pool and a non-empty golden boot shortlist", () => {
    expect(UNDERDOG_TEAMS).toHaveLength(16);
    expect(UNDERDOG_TEAMS).toContain("Morocco");
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
