import { recordHref } from './navigation.js';

/**
 * Document records are owned by the Document service and are tenant-scoped.
 * This module only formats the projections this remote consumes: the shared
 * search item rendered by the predictive picker and the canonical document
 * read used to hydrate an existing business reference.
 */
export function documentSearchItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

/** Stable cross-link for a document record in the federated shell. */
export function documentHref(documentId) {
  return documentId ? recordHref('document', documentId) : '';
}

/**
 * Human-readable label for a hydrated document. The document number is the
 * business key; the title is the fallback for a record still waiting for its
 * numbered filing.
 */
export function documentLabel(document) {
  if (!document) return '';
  const number = typeof document.documentNumber === 'string' ? document.documentNumber.trim() : '';
  const title = typeof document.title === 'string' ? document.title.trim() : '';
  return number || title;
}
