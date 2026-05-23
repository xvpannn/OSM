import type { Signal, Stats } from './types'

export const fmt = (val: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)

const authenticatedFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = localStorage.getItem('osm_session_token');
  const headers = {
    ...options.headers,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem('osm_session_token');
    localStorage.removeItem('osm_user_email');
    localStorage.removeItem('osm_is_master');
    window.location.href = '/'; // Kick back to landing screen to force re-auth
    throw new Error('session expired');
  }
  return response;
};

export const fetchDatasets = async (country: string = 'us'): Promise<string[]> => {
  const r = await authenticatedFetch(`/api/datasets?country=${encodeURIComponent(country)}`)
  if (!r.ok) throw new Error('datasets fetch failed')
  return r.json()
}

export const fetchSignals = async (lane: string, dataset: string, country: string = 'us'): Promise<Signal[]> => {
  const r = await authenticatedFetch(`/api/signals?lane=${lane}&dataset=${encodeURIComponent(dataset)}&country=${encodeURIComponent(country)}`)
  if (!r.ok) throw new Error('signals fetch failed')
  return r.json()
}

export const fetchNews = async (dataset: string, country: string = 'us'): Promise<any[]> => {
  const r = await authenticatedFetch(`/api/news?dataset=${encodeURIComponent(dataset)}&country=${encodeURIComponent(country)}`)
  if (!r.ok) return []
  return r.json()
}

export const fetchStats = async (dataset: string, country: string = 'us'): Promise<Stats> => {
  const r = await authenticatedFetch(`/api/stats?dataset=${encodeURIComponent(dataset)}&country=${encodeURIComponent(country)}`)
  if (!r.ok) throw new Error('stats fetch failed')
  return r.json()
}

export const fetchStatus = async (): Promise<{ isRunning: boolean }> => {
  try {
    const r = await authenticatedFetch('/api/status')
    if (!r.ok) return { isRunning: false }
    return r.json()
  } catch {
    return { isRunning: false }
  }
}

export const deleteSignal = async (id: number, country: string = 'us'): Promise<void> => {
  const r = await authenticatedFetch(`/api/signals/${id}?country=${encodeURIComponent(country)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error('delete failed')
}

export const purgeDataset = async (dataset: string, country: string = 'us'): Promise<void> => {
  const r = await authenticatedFetch(`/api/dataset/${encodeURIComponent(dataset)}?country=${encodeURIComponent(country)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error('purge failed')
}

export const mergeDatasets = async (source: string, target: string, country: string = 'us'): Promise<void> => {
  const r = await authenticatedFetch('/api/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, target, country }),
  })
  if (!r.ok) throw new Error('merge failed')
}

