import { describe, expect, it } from "vitest";
import { cleanSheetBonus, cojonesBonus, goalsOff, predictionPoints } from "./scoring";

describe("predictionPoints", () => {
  it("gives 3 for exact score", () => {
    expect(predictionPoints({ home: 2, away: 0 }, { home: 2, away: 0 })).toBe(3);
  });
  it("gives 1 for correct winner, wrong score", () => {
    expect(predictionPoints({ home: 1, away: 0 }, { home: 2, away: 0 })).toBe(1);
    expect(predictionPoints({ home: 0, away: 3 }, { home: 1, away: 2 })).toBe(1);
  });
  it("gives 1 for correct draw, wrong score", () => {
    expect(predictionPoints({ home: 1, away: 1 }, { home: 2, away: 2 })).toBe(1);
  });
  it("gives 3 for exact draw", () => {
    expect(predictionPoints({ home: 0, away: 0 }, { home: 0, away: 0 })).toBe(3);
  });
  it("gives 0 for wrong outcome", () => {
    expect(predictionPoints({ home: 1, away: 1 }, { home: 2, away: 1 })).toBe(0);
    expect(predictionPoints({ home: 2, away: 0 }, { home: 0, away: 1 })).toBe(0);
  });
  it("gives 0 for missing prediction", () => {
    expect(predictionPoints(null, { home: 1, away: 0 })).toBe(0);
    expect(predictionPoints(undefined, { home: 1, away: 0 })).toBe(0);
  });
});

describe("goalsOff", () => {
  it("sums absolute goal differences for both teams", () => {
    expect(goalsOff({ home: 1, away: 0 }, { home: 2, away: 1 })).toBe(2); // Martin example 1
    expect(goalsOff({ home: 1, away: 1 }, { home: 0, away: 0 })).toBe(2); // Martin example 2
  });
  it("is 0 for an exact prediction", () => {
    expect(goalsOff({ home: 3, away: 1 }, { home: 3, away: 1 })).toBe(0);
  });
  it("returns null for a missing prediction (skipped, not zero)", () => {
    expect(goalsOff(null, { home: 1, away: 0 })).toBeNull();
    expect(goalsOff(undefined, { home: 1, away: 0 })).toBeNull();
  });
});

describe("cleanSheetBonus", () => {
  it("gives +1 when one predicted-clean side keeps the sheet", () => {
    expect(cleanSheetBonus({ home: 2, away: 0 }, { home: 2, away: 0 })).toBe(1);
    expect(cleanSheetBonus({ home: 0, away: 1 }, { home: 0, away: 3 })).toBe(1);
  });
  it("gives +2 for a correctly predicted 0-0 (two clean sheets)", () => {
    expect(cleanSheetBonus({ home: 0, away: 0 }, { home: 0, away: 0 })).toBe(2);
  });
  it("gives 0 when the predicted-clean side actually conceded", () => {
    expect(cleanSheetBonus({ home: 2, away: 0 }, { home: 2, away: 1 })).toBe(0);
  });
  it("gives 0 for a missing prediction", () => {
    expect(cleanSheetBonus(null, { home: 0, away: 0 })).toBe(0);
  });
});

describe("cojonesBonus", () => {
  it("only triggers on an exact-score hit", () => {
    expect(cojonesBonus({ home: 1, away: 0 }, { home: 2, away: 0 })).toBe(0); // outcome, not exact
  });
  it("gives 0 for an exact hit of 0-3 total goals", () => {
    expect(cojonesBonus({ home: 1, away: 0 }, { home: 1, away: 0 })).toBe(0);
    expect(cojonesBonus({ home: 2, away: 1 }, { home: 2, away: 1 })).toBe(0); // total 3
  });
  it("gives +1 for an exact hit of 4-6 total goals", () => {
    expect(cojonesBonus({ home: 3, away: 1 }, { home: 3, away: 1 })).toBe(1); // total 4
    expect(cojonesBonus({ home: 3, away: 3 }, { home: 3, away: 3 })).toBe(1); // total 6
  });
  it("gives +2 for an exact hit of 7+ total goals", () => {
    expect(cojonesBonus({ home: 4, away: 3 }, { home: 4, away: 3 })).toBe(2); // total 7
  });
  it("gives 0 for a missing prediction", () => {
    expect(cojonesBonus(null, { home: 4, away: 3 })).toBe(0);
  });
});
