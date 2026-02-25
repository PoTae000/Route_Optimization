const OSRM_BASE = 'https://router.project-osrm.org';

/**
 * Call OSRM Route API directly (free, fast, no traffic)
 * Returns same format as Mapbox: { code: 'Ok', routes: [{ geometry, distance, duration, legs }] }
 */
export async function callOSRMDirect(
  coords: string,
  options?: { steps?: boolean; alternatives?: boolean; annotations?: string },
  signal?: AbortSignal
): Promise<any> {
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson'
  });
  if (options?.steps) params.set('steps', 'true');
  if (options?.alternatives) params.set('alternatives', 'true');
  if (options?.annotations) params.set('annotations', options.annotations);

  const url = `${OSRM_BASE}/route/v1/driving/${coords}?${params}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('OSRM: no route');
  return data;
}

/**
 * Call OSRM Table API — NxN distance matrix in 1 request
 * Returns { code: 'Ok', durations: number[][], distances: number[][] }
 */
export async function callOSRMTable(
  coords: string,
  signal?: AbortSignal
): Promise<{ durations: (number | null)[][]; distances: (number | null)[][] }> {
  const url = `${OSRM_BASE}/table/v1/driving/${coords}?annotations=distance,duration`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`OSRM Table HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error(`OSRM Table: ${data.code}`);
  return { durations: data.durations, distances: data.distances };
}

/**
 * Call OSRM Nearest API — snap a point to the nearest road
 * Returns { lat, lng, name, distance }
 */
export async function callOSRMNearest(
  lng: number,
  lat: number,
  signal?: AbortSignal
): Promise<{ lat: number; lng: number; name: string; distance: number }> {
  const url = `${OSRM_BASE}/nearest/v1/driving/${lng},${lat}?number=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`OSRM Nearest HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.waypoints?.[0]) throw new Error('OSRM Nearest: no result');
  const wp = data.waypoints[0];
  return {
    lng: wp.location[0],
    lat: wp.location[1],
    name: wp.name || '',
    distance: wp.distance // meters from original point to snapped point
  };
}

/**
 * Call OSRM Match API — snap GPS trace to road network
 * coords: array of [lng, lat] pairs
 * Returns matched geometry (GeoJSON LineString coordinates)
 */
export async function callOSRMMatch(
  coords: [number, number][],
  signal?: AbortSignal
): Promise<{ coordinates: [number, number][]; confidence: number }> {
  if (coords.length < 2) throw new Error('OSRM Match: need >= 2 coords');
  const coordStr = coords.map(c => `${c[0]},${c[1]}`).join(';');
  const url = `${OSRM_BASE}/match/v1/driving/${coordStr}?geometries=geojson&overview=full`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`OSRM Match HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.matchings?.[0]) throw new Error('OSRM Match: no matching');
  const matching = data.matchings[0];
  return {
    coordinates: matching.geometry.coordinates, // [lng, lat][]
    confidence: matching.confidence
  };
}

/**
 * Call OSRM Table API to approximate isochrone
 * Generates sample points around origin and checks travel time
 * Returns array of { lat, lng, minutes } for points reachable within each contour
 */
export async function callOSRMIsochrone(
  lng: number,
  lat: number,
  minuteContours: number[] = [10, 20, 30],
  signal?: AbortSignal
): Promise<{ contours: { minutes: number; points: [number, number][] }[] }> {
  // Generate sample points in concentric rings (8 directions × 4 distances)
  const samplePoints: [number, number][] = [];
  const maxMinutes = Math.max(...minuteContours);
  // Rough estimate: 60km/h average → maxMinutes * 1km per minute
  const maxRadiusKm = maxMinutes * 0.8; // conservative
  const distances = [0.25, 0.5, 0.75, 1.0].map(f => f * maxRadiusKm);
  const directions = 12; // every 30 degrees

  for (const distKm of distances) {
    for (let i = 0; i < directions; i++) {
      const angle = (i * 360 / directions) * Math.PI / 180;
      const dLat = (distKm / 111.32) * Math.cos(angle);
      const dLng = (distKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);
      samplePoints.push([lng + dLng, lat + dLat]);
    }
  }

  // Build coords: origin first, then all sample points
  const allCoords = [[lng, lat], ...samplePoints];
  const coordStr = allCoords.map(c => `${c[0]},${c[1]}`).join(';');
  // sources=0 means only calculate from origin to all destinations
  const sources = '0';
  const destinations = samplePoints.map((_, i) => i + 1).join(';');
  const url = `${OSRM_BASE}/table/v1/driving/${coordStr}?sources=${sources}&destinations=${destinations}&annotations=duration`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`OSRM Isochrone HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error(`OSRM Isochrone: ${data.code}`);

  const durations: (number | null)[] = data.durations[0]; // from origin to all destinations
  const contours: { minutes: number; points: [number, number][] }[] = [];

  // Sort contours ascending for proper nesting
  const sortedMinutes = [...minuteContours].sort((a, b) => a - b);

  for (const mins of sortedMinutes) {
    const reachable: [number, number][] = [];
    durations.forEach((dur, i) => {
      if (dur !== null && dur <= mins * 60) {
        // Use snapped destination locations if available
        const dest = data.destinations?.[i];
        if (dest?.location) {
          reachable.push(dest.location);
        } else {
          reachable.push(samplePoints[i]);
        }
      }
    });
    contours.push({ minutes: mins, points: reachable });
  }

  return { contours };
}
