import { describe, expect, it } from "vitest";
import { predictionPoints } from "./scoring";

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
