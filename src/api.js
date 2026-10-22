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
  // `book` and `tenant` are transport concerns, not fetch options. Domain reads
  // default to the ASSUMED wall; pass `book: null` for platform reads that are
  // scoped by tenant only (for example the event inbox), and `tenant: null`
  // for platform-wide master data (for example the people/team directory).
  const { book = BOOK, tenant = TENANT, ...init } = options;
  const url = String(path).startsWith('/api/') ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    cache: init.cache || 'no-store',
    headers: {
      ...(tenant ? { 'X-EIA-Tenant': tenant } : {}),
      ...(book ? { 'X-EIA-Book': book } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
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
  directory: {
    /**
     * People and teams for assignment. The directory is platform master data,
     * not book- or tenant-scoped, so neither wall is sent on this read.
     */
    get: () => request('/api/v1/directory', { book: null, tenant: null })
  },
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
  documents: {
    /**
     * Documents linked to one assumed claim. The link type identifies the
     * claim book; the claim id is the business record the document
     * association points at. The lookup is a cross-vertical read, so it uses
     * the full public path rather than the assumed-claims API base.
     */
    listLinked: (linkedType, linkedId) =>
      request(
        `/api/v1/documents?linkedType=${encodeURIComponent(linkedType)}&linkedId=${encodeURIComponent(
          linkedId
        )}`
      ),
    /**
     * Predictive document lookup for pickers. The Document service is
     * tenant-scoped platform data, not book data, so the ASSUMED wall is
     * deliberately not sent: the search carries X-EIA-Tenant only. `signal`
     * lets the picker discard a superseded keystroke.
     */
    search: (q, limit = 8, { signal } = {}) =>
      request(`/api/v1/documents/search?q=${encodeURIComponent(q)}&limit=${limit}`, {
        book: null,
        signal
      }),
    /**
     * Canonical document read used to hydrate the label behind an existing
     * business reference (for example a commutation's release document). The
     * read is tenant-scoped, so it carries X-EIA-Tenant only.
     */
    get: (documentId) =>
      request(`/api/v1/documents/${encodeURIComponent(documentId)}`, { book: null })
  },
  payments: {
    /**
     * Payments whose source is one assumed claim. Payment is the financial
     * system of record and owns approval and execution; the claim is only the
     * `sourceId` stored on the payment. The response is a bare array or an
     * `{items:[...]}` page, and the ASSUMED book wall stays on the read for
     * the same reason every other domain read in this remote carries it.
     */
    listBySource: (sourceType, sourceId) =>
      request(
        `/api/v1/payments?sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(
          sourceId
        )}`
      )
  },
  notes: {
    list: (claimId) => request(`/claims/${encodeURIComponent(claimId)}/notes`),
    create: (claimId, body, key) => createNote(claimId, body, key)
  },
  events: {
    /**
     * Activity events for one claim aggregate, newest first as published by
     * the platform event inbox. The inbox is tenant-scoped, not book-scoped,
     * so the ASSUMED wall is deliberately not sent on this platform read.
     */
    aggregate: (claimId, limit = 50) =>
      request(`/api/v1/events/aggregate/${encodeURIComponent(claimId)}?limit=${limit}`, {
        book: null
      })
  },
  notifications: {
    /**
     * Notifications linked to one business source. Notifications is a
     * tenant-scoped platform service whose own workbench sends no book
     * header, so the ASSUMED wall is not sent on this read. Assumed Claims
     * asks for its claim source (`ASSUMED_CLAIM` + the claim id) and renders
     * the result read-only.
     */
    listBySource: (sourceType, sourceId) =>
      request(
        `/api/v1/notifications?sourceType=${encodeURIComponent(
          sourceType
        )}&sourceId=${encodeURIComponent(sourceId)}`,
        { book: null }
      )
  }
};

export function money(amount, currency = 'USD') {
  const value = Number(amount ?? 0);
  return `${currency || 'USD'} ${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
