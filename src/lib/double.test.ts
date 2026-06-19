import { describe, expect, it } from "vitest";
import { lastRoundCandidates, pickDoubleMatch, isDoubleRevealed, type DoubleCandidate } from "./double";

const ms: DoubleCandidate[] = [
  { id: 1, stage: "GROUP_STAGE", matchday: 1 },
  { id: 2, stage: "GROUP_STAGE", matchday: 3 },
  { id: 3, stage: "GROUP_STAGE", matchday: 3 },
  { id: 4, stage: "LAST_32", matchday: 4 },
];

describe("lastRoundCandidates", () => {
  it("keeps only the highest group-stage matchday", () => {
    expect(lastRoundCandidates(ms).map((m) => m.id)).toEqual([2, 3]);
  });
  it("returns [] when there are no group games", () => {
    expect(lastRoundCandidates([{ id: 9, stage: "FINAL", matchday: 7 }])).toEqual([]);
  });
});

describe("pickDoubleMatch", () => {
  it("is deterministic for a given rng and always returns a candidate", () => {
    const cands = lastRoundCandidates(ms);
    expect(pickDoubleMatch(cands, () => 0)!.id).toBe(2);
    expect(pickDoubleMatch(cands, () => 0.99)!.id).toBe(3);
  });
  it("returns null with no candidates", () => {
    expect(pickDoubleMatch([], () => 0)).toBeNull();
  });
});

describe("isDoubleRevealed", () => {
  it("is true only for the chosen match once finished", () => {
    expect(isDoubleRevealed(2, 2, "FINISHED")).toBe(true);
    expect(isDoubleRevealed(2, 2, "IN_PLAY")).toBe(false);
    expect(isDoubleRevealed(3, 2, "FINISHED")).toBe(false);
    expect(isDoubleRevealed(2, null, "FINISHED")).toBe(false);
  });
});
