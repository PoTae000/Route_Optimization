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
