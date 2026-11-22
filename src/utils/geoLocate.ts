import type { Difficulty, ResortData } from '../types';

const EARTH_R = 6371000;

export function haversineMeters(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDegrees(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Fast local tangent-plane distance in meters from point (px, py) to segment (x1,y1)-(x2,y2)
 */
function pointToSegmentMeters(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const cosLat = Math.cos((py * Math.PI) / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;

  const ax = (x1 - px) * mPerDegLng;
  const ay = (y1 - py) * mPerDegLat;
  const bx = (x2 - px) * mPerDegLng;
  const by = (y2 - py) * mPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(ax, ay);

  // Closest t along A -> B to origin (0,0) is -(A . (B - A)) / |B - A|^2
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(cx, cy);
}

function minDistanceToLineMeters(lng: number, lat: number, coords: [number, number][]): number {
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const d = pointToSegmentMeters(
      lng,
      lat,
      coords[i - 1][0],
      coords[i - 1][1],
      coords[i][0],
      coords[i][1]
    );
    if (d < best) best = d;
  }
  return best;
}

export interface SnappedLocationInfo {
  onResort: boolean;
  distanceToResortKm: number;
  nearestTrail: {
    name: string;
    difficulty: Difficulty;
    status: 'open' | 'closed';
    groomed: boolean;
    distanceM: number;
  } | null;
  nearestOpenLift: {
    name: string;
    distanceM: number;
  } | null;
}

export function snapPositionToMountain(
  lng: number,
  lat: number,
  resort: ResortData,
  enrichedGeojson: any | null
): SnappedLocationInfo {
  const distCenterM = haversineMeters(lng, lat, resort.coordinates[0], resort.coordinates[1]);
  const distanceToResortKm = Math.round((distCenterM / 100) ) / 10;
  const onResort = distCenterM <= 12000; // within 12 km of resort center

  if (!enrichedGeojson || !onResort) {
    return {
      onResort,
      distanceToResortKm,
      nearestTrail: null,
      nearestOpenLift: null,
    };
  }

  let bestTrail: SnappedLocationInfo['nearestTrail'] = null;
  let bestLift: SnappedLocationInfo['nearestOpenLift'] = null;

  for (const f of enrichedGeojson.features || []) {
    if (f.geometry?.type !== 'LineString') continue;
    const p = f.properties || {};
    const coords = f.geometry.coordinates as [number, number][];
    if (!coords || coords.length < 2) continue;

    if (p.featureType === 'trail' && !p.isUnnamed) {
      const d = minDistanceToLineMeters(lng, lat, coords);
      if (!bestTrail || d < bestTrail.distanceM) {
        bestTrail = {
          name: p.name,
          difficulty: p.difficulty || 'blue',
          status: p.liveStatus || 'closed',
          groomed: Boolean(p.groomed),
          distanceM: Math.round(d),
        };
      }
    } else if (p.featureType === 'lift' && p.liveStatus === 'open') {
      const d = minDistanceToLineMeters(lng, lat, coords);
      if (!bestLift || d < bestLift.distanceM) {
        bestLift = {
          name: p.name,
          distanceM: Math.round(d),
        };
      }
    }
  }

  return {
    onResort: true,
    distanceToResortKm,
    nearestTrail: bestTrail && bestTrail.distanceM <= 120 ? bestTrail : null,
    nearestOpenLift: bestLift,
  };
}

export interface DemoWaypoint {
  lng: number;
  lat: number;
  altitudeM: number;
  speedKmh: number;
  headingDeg: number;
}

/**
 * Builds a realistic simulated ski run down an open trail at the active resort
 * so users off-mountain can preview real-time on-run GPS & trail snapping.
 */
export function buildSimulatedRun(resort: ResortData, enrichedGeojson: any | null): DemoWaypoint[] {
  if (!enrichedGeojson) return [];
  const allNamedTrails = (enrichedGeojson.features || []).filter(
    (f: any) =>
      f.geometry?.type === 'LineString' &&
      f.properties?.featureType === 'trail' &&
      !f.properties?.isUnnamed &&
      f.geometry.coordinates.length >= 6
  );
  const openTrails = allNamedTrails.filter((f: any) => f.properties?.liveStatus === 'open');
  const candidates = openTrails.length > 0 ? openTrails : allNamedTrails;

  // Pick longest candidate trail segment for a satisfying glide
  candidates.sort(
    (a: any, b: any) => (b.properties?.lengthMeters || 0) - (a.properties?.lengthMeters || 0)
  );
  const chosen = candidates[0];
  if (!chosen) return [];

  const coords: [number, number][] = chosen.geometry.coordinates;
  const topElev = Math.round(resort.elevationBaseM + resort.verticalDropM * 0.58);
  const botElev = resort.elevationBaseM + Math.min(40, Math.round(resort.verticalDropM * 0.15));

  return coords.map((c, idx) => {
    const next = coords[Math.min(coords.length - 1, idx + 1)];
    const prev = coords[Math.max(0, idx - 1)];
    const hdg =
      idx < coords.length - 1
        ? bearingDegrees(c[0], c[1], next[0], next[1])
        : bearingDegrees(prev[0], prev[1], c[0], c[1]);
    const frac = idx / Math.max(1, coords.length - 1);
    const alt = Math.round(topElev - (topElev - botElev) * frac);
    const speed = Math.round(28 + Math.sin(frac * Math.PI) * 16);
    return {
      lng: c[0],
      lat: c[1],
      altitudeM: alt,
      speedKmh: speed,
      headingDeg: hdg,
    };
  });
}
