import {
  addWalkSample,
  emptyWalkTrack,
  haversineMeters,
  intervalCueDue,
  slowBonus,
  walkingPlantProgress,
  walkGrowthSeconds,
} from "./walking";
import { describe, expect, it } from "vitest";
const fix = (northMeters: number, timestamp: number, accuracy = 5) => ({
  latitude: northMeters / 111195,
  longitude: 0,
  accuracy,
  timestamp,
});
describe("walking movement", () => {
  it("always grows from elapsed time, caps slow-walk growth, and freezes with unchanged time", () => {
    expect(walkingPlantProgress(600, 540, 0)).toBe(0.1);
    expect(walkingPlantProgress(600, 540, 999)).toBe(0.12);
    expect(walkingPlantProgress(600, 0, 999)).toBe(1);
  });

  it("gives reliably confirmed slow movement more plant growth than fast movement and none for stationary jitter", () => {
    const base = Date.now(), at = (meters: number, seconds: number, accuracy = 1) => fix(meters, base + seconds * 1000, accuracy);
    let slow = emptyWalkTrack();
    for (const sample of [at(0, 0), at(4, 10), at(8, 20)]) slow = addWalkSample(slow, sample);
    let fast = emptyWalkTrack();
    for (const sample of [at(0, 0), at(15, 10), at(30, 20)]) fast = addWalkSample(fast, sample);
    let still = emptyWalkTrack();
    for (const sample of [at(0, 0, 8), at(2, 10, 8), at(-2, 20, 8)]) still = addWalkSample(still, sample);
    expect(slow.movingSeconds).toBeGreaterThan(0);
    expect(fast.movingSeconds).toBeGreaterThan(0);
    expect(walkGrowthSeconds(slow)).toBeGreaterThan(walkGrowthSeconds(fast));
    expect(walkGrowthSeconds(still)).toBe(0);
  });
  it("calculates distance and clamps safe haversine inputs", () => {
    expect(haversineMeters(fix(0, 0), fix(100, 1))).toBeCloseTo(100, 0);
    expect(
      haversineMeters(
        { latitude: 90, longitude: 0 },
        { latitude: -90, longitude: 180 },
      ),
    ).toBeCloseTo(Math.PI * 6371000, 0);
  });
  it("rewards a realistic slow sustained walk after clearing uncertainty", () => {
    let t = addWalkSample(emptyWalkTrack(), fix(0, 0, 10));
    for (let second = 1; second <= 60; second += 1)
      t = addWalkSample(t, fix(second * (1.1 / 3.6), second * 1000, 10));
    expect(t.points).toBeGreaterThan(18);
    expect(t.movingSeconds).toBeGreaterThanOrEqual(57);
    expect(t.distanceMeters).toBeGreaterThan(3);
  });
  it("does not reward stationary GPS oscillation", () => {
    let t = addWalkSample(emptyWalkTrack(), fix(0, 0, 5));
    for (const [m, s] of [
      [4, 10],
      [7, 20],
      [3, 30],
      [-5, 40],
      [6, 50],
    ] as const)
      t = addWalkSample(t, fix(m, s * 1000, 5));
    expect(t.points).toBe(0);
    expect(t.movingSeconds).toBe(0);
  });
  it("rejects bad fixes, cars, stale gaps, and invalid order", () => {
    const base = addWalkSample(emptyWalkTrack(), fix(0, 1000));
    expect(addWalkSample(base, { ...fix(20, 2000), accuracy: 30 })).toEqual(
      base,
    );
    expect(addWalkSample(base, fix(20, 1000))).toEqual(base);
    expect(addWalkSample(base, fix(200, 2000)).anchor?.timestamp).toBe(2000);
    const precise = addWalkSample(emptyWalkTrack(), fix(0, 0, 1));
    expect(addWalkSample(precise, fix(10, 4000, 1)).lastSpeedMps).toBeGreaterThan(2.2);
    expect(addWalkSample(base, fix(20, 70_000)).points).toBe(0);
    expect(addWalkSample(base, { ...fix(20, 2000), latitude: 91 })).toEqual(
      base,
    );
  });
  it("requires continued movement in the same direction", () => {
    let t = addWalkSample(emptyWalkTrack(), fix(0, 0, 1));
    t = addWalkSample(t, fix(8, 10_000, 1));
    t = addWalkSample(t, fix(4, 15_000, 1));
    expect(t.points).toBe(0);
    expect(t.candidate?.latitude).toBeCloseTo(fix(4, 0, 1).latitude);
  });
  it("makes the slow bonus capped and monotonic", () => {
    expect(slowBonus(0.25)).toBe(2);
    expect(slowBonus(1)).toBeGreaterThan(slowBonus(2));
    expect(slowBonus(2.2)).toBe(1);
    expect(slowBonus(0.1)).toBe(0);
  });
});
describe("interval cues", () => {
  it("rings once across a crossed interval without duplicating completion", () => {
    expect(intervalCueDue(299, 301, 300, 600)).toBe(true);
    expect(intervalCueDue(301, 302, 300, 600)).toBe(false);
    expect(intervalCueDue(599, 600, 300, 600)).toBe(false);
    expect(intervalCueDue(0, 500, 300, 600)).toBe(true);
    expect(intervalCueDue(0, 1, null, 600)).toBe(false);
  });
});
