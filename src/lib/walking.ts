export type GeoSample = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};
export type WalkTrack = {
  anchor: GeoSample | null;
  candidate: GeoSample | null;
  lastSample: GeoSample | null;
  distanceMeters: number;
  movingSeconds: number;
  points: number;
  lastSpeedMps: number | null;
};
export const emptyWalkTrack = (): WalkTrack => ({
  anchor: null,
  candidate: null,
  lastSample: null,
  distanceMeters: 0,
  movingSeconds: 0,
  points: 0,
  lastSpeedMps: null,
});
export function haversineMeters(
  a: Pick<GeoSample, "latitude" | "longitude">,
  b: Pick<GeoSample, "latitude" | "longitude">,
) {
  const rad = (v: number) => (v * Math.PI) / 180,
    dLat = rad(b.latitude - a.latitude),
    dLon = rad(b.longitude - a.longitude),
    lat1 = rad(a.latitude),
    lat2 = rad(b.latitude),
    raw =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2,
    x = Math.max(0, Math.min(1, raw));
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function slowBonus(speedMps: number) {
  if (speedMps < 0.25 || speedMps > 2.2) return 0;
  return Math.max(1, Math.min(2, 2 - (speedMps - 0.25) / 1.55));
}
export function addWalkSample(track: WalkTrack, sample: GeoSample): WalkTrack {
  if (
    !Number.isFinite(sample.latitude) ||
    Math.abs(sample.latitude) > 90 ||
    !Number.isFinite(sample.longitude) ||
    Math.abs(sample.longitude) > 180 ||
    !Number.isFinite(sample.accuracy) ||
    sample.accuracy <= 0 ||
    sample.accuracy > 20 ||
    !Number.isFinite(sample.timestamp)
  )
    return track;
  if (!track.anchor)
    return { ...track, anchor: sample, candidate: null, lastSample: sample, lastSpeedMps: null };
  if (track.lastSample && sample.timestamp - track.lastSample.timestamp > 10_000)
    return { ...track, anchor: sample, candidate: null, lastSample: sample, lastSpeedMps: null };
  const seconds = (sample.timestamp - track.anchor.timestamp) / 1000;
  if (seconds <= 0) return track;
  const withLatest = { ...track, lastSample: sample };
  const distance = haversineMeters(track.anchor, sample),
    speed = distance / seconds;
  if (speed > 3)
    return { ...withLatest, anchor: sample, candidate: null, lastSpeedMps: null };
  const uncertainty = Math.hypot(track.anchor.accuracy, sample.accuracy);
  if (distance <= uncertainty || speed < 0.25) return withLatest;
  if (speed > 2.2)
    return { ...withLatest, anchor: sample, candidate: null, lastSpeedMps: speed };
  if (!track.candidate) return { ...withLatest, candidate: sample };
  const leg = haversineMeters(track.candidate, sample),
    legFloor = Math.max(
      3,
      Math.max(track.candidate.accuracy, sample.accuracy) * 0.3,
    ),
    ax = track.candidate.longitude - track.anchor.longitude,
    ay = track.candidate.latitude - track.anchor.latitude,
    bx = sample.longitude - track.candidate.longitude,
    by = sample.latitude - track.candidate.latitude;
  if (leg < legFloor) return withLatest;
  if (ax * bx + ay * by <= 0) return { ...withLatest, candidate: sample };
  const confirmedDistance = distance - uncertainty,
    bonus = slowBonus(speed);
  return {
    anchor: sample,
    candidate: null,
    lastSample: sample,
    distanceMeters: track.distanceMeters + confirmedDistance,
    movingSeconds: track.movingSeconds + seconds,
    points: track.points + (seconds / 6) * bonus,
    lastSpeedMps: speed,
  };
}
export function intervalCueDue(
  previousElapsed: number,
  elapsed: number,
  intervalSeconds: number | null,
  plannedSeconds: number,
) {
  return Boolean(
    intervalSeconds &&
      intervalSeconds > 0 &&
      intervalSeconds < plannedSeconds &&
      elapsed < plannedSeconds &&
      Math.floor(elapsed / intervalSeconds) >
        Math.floor(previousElapsed / intervalSeconds),
  );
}
