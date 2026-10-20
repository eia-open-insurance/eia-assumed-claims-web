/**
 * Resolves a contract reference into readable cross-link text.
 *
 * The Contract API returns the canonical record: `contractNumber` plus the
 * `contractType`, for example "QS-2026-00042 · QUOTA_SHARE". This module only
 * formats link text — callers keep the `/contract?record=<id>` href and fall
 * back to the short UUID when resolution fails.
 */
export function contractEndpoint(contractId) {
  return `/api/v1/contracts/${encodeURIComponent(contractId)}`;
}

export function contractRecordLabel(contract) {
  if (!contract) return '';
  const number = contract.contractNumber || '';
  const type = contract.contractType || '';
  if (number && type) return `${number} · ${type}`;
  return number || type || '';
}
