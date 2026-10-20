export const TENANT = '11111111-1111-7111-8111-111111111111';
export const BOOK = 'ASSUMED';
export const API_BASE = '/api/v1/assumed-claims';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readError(response) {
  const fallback = `Request failed with status ${response.status}`;
  try {
    const body = await response.json();
    return body?.message || body?.detail || body?.title || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Transport for the Assumed Claims operational API. Relative paths are scoped
 * to the assumed-claims service and every request carries the ASSUMED book
 * wall; cross-vertical discovery endpoints pass their full `/api/...` path.
 */
export async function request(path, options = {}) {
  const url = String(path).startsWith('/api/') ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    cache: options.cache || 'no-store',
    headers: {
      'X-EIA-Tenant': TENANT,
      'X-EIA-Book': BOOK,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    throw new ApiError(await readError(response), response.status);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

export const api = {
  tasks: {
    list: (claimId) => request(`/claims/${encodeURIComponent(claimId)}/tasks`),
    create: (claimId, body) =>
      request(`/claims/${encodeURIComponent(claimId)}/tasks`, {
        method: 'POST',
        body: JSON.stringify(body)
      }),
    update: (claimId, taskId, body) =>
      request(`/claims/${encodeURIComponent(claimId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      })
  },
  notes: {
    list: (claimId) => request(`/claims/${encodeURIComponent(claimId)}/notes`),
    create: (claimId, body) =>
      request(`/claims/${encodeURIComponent(claimId)}/notes`, {
        method: 'POST',
        body: JSON.stringify(body)
      })
  }
};

export function today() {
  return new Date().toISOString().slice(0, 10);
}
