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

/**
 * Stable key for one logical create attempt. `crypto.randomUUID` is available
 * in every supported browser; the fallback keeps the v4 shape for older
 * webviews so the server always receives a valid UUID.
 */
export function newIdempotencyKey() {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') {
    return source.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (source && typeof source.getRandomValues === 'function') {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

function idempotencyHeaders(key) {
  return key ? { 'Idempotency-Key': key } : {};
}

/** Create a diary task; `key` is optional for callers that do not retry. */
export function createTask(claimId, body, key) {
  return request(`/claims/${encodeURIComponent(claimId)}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: idempotencyHeaders(key)
  });
}

/** Create a claim note; `key` is optional for callers that do not retry. */
export function createNote(claimId, body, key) {
  return request(`/claims/${encodeURIComponent(claimId)}/notes`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: idempotencyHeaders(key)
  });
}

export const api = {
  claims: {
    get: (claimId) => request(`/claims/${encodeURIComponent(claimId)}`),
    /**
     * Change operational ownership only. `expectedVersion` is the claim version
     * the caller read; the expert rejects a stale version with 409 rather than
     * overwriting a concurrent reassignment.
     */
    assign: (claimId, body, actor) =>
      request(`/claims/${encodeURIComponent(claimId)}/assignment`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: actor ? { 'X-EIA-Actor': actor } : {}
      })
  },
  tasks: {
    list: (claimId) => request(`/claims/${encodeURIComponent(claimId)}/tasks`),
    create: (claimId, body, key) => createTask(claimId, body, key),
    update: (claimId, taskId, body) =>
      request(`/claims/${encodeURIComponent(claimId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      })
  },
  notes: {
    list: (claimId) => request(`/claims/${encodeURIComponent(claimId)}/notes`),
    create: (claimId, body, key) => createNote(claimId, body, key)
  }
};

export function today() {
  return new Date().toISOString().slice(0, 10);
}
