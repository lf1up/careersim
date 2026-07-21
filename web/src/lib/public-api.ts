import type { Simulation, SimulationDetail } from './types';

// Both env vars hold the FULL base URL of the api service — version path
// included when the API runs with a prefix (e.g. `http://api:8000/v1`),
// or just the origin for an unprefixed API. Nothing is appended in code;
// the env vars alone control versioning. The fallback matches the local
// rule (API_VERSION_PREFIX=v1 in api/.env and compose).
const apiBaseUrl = () =>
  (
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:8000/v1'
  ).replace(/\/+$/, '');

async function publicRequest<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    headers: {
      Accept: 'application/json',
    },
    next: {
      revalidate: 300,
    },
  });

  if (!response.ok) {
    throw new Error(response.statusText || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function listPublicSimulations(): Promise<Simulation[]> {
  const res = await publicRequest<{ simulations: Simulation[] }>('/simulations');
  return res.simulations;
}

export async function getPublicSimulation(
  slug: string,
): Promise<SimulationDetail> {
  return publicRequest<SimulationDetail>(
    `/simulations/${encodeURIComponent(slug)}`,
  );
}
