import type { RequestHandler } from './$types';

const NOMINATIM = 'https://nominatim.openstreetmap.org';

export const GET: RequestHandler = async ({ url }) => {
  const endpoint = url.searchParams.get('endpoint') || 'search';
  const params = new URLSearchParams(url.searchParams);
  params.delete('endpoint');

  const res = await fetch(`${NOMINATIM}/${endpoint}?${params.toString()}`, {
    headers: { 'User-Agent': 'RouteOptimization/2.0' }
  });

  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' }
  });
};
