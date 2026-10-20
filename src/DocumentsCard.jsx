import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { navigate, recordHref } from './navigation.js';
import { statusTone } from './ui.jsx';

export const LINKED_TYPE = 'ASSUMED_CLAIM';

/**
 * Linked documents are evidence: the Document service owns the document and
 * the assumed claim stays the source of truth. The lookup runs separately from
 * the claim workspace, so a slow or failing document service never delays the
 * claim record itself.
 */

/** The documents API returns either a bare array or an {items:[...]} envelope. */
export function documentItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

function openDocument(event) {
  const href = event.currentTarget.getAttribute('href');
  if (!href) return;
  if (event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  navigate(href);
}

export default function DocumentsCard({ claimId }) {
  const [state, setState] = useState(claimId ? 'loading' : 'empty');
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!claimId) {
      setItems([]);
      setState('empty');
      return undefined;
    }

    let alive = true;
    setItems([]);
    setState('loading');

    api.documents
      .listLinked(LINKED_TYPE, claimId)
      .then((body) => {
        if (!alive) return;
        setItems(documentItems(body));
        setState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setItems([]);
        setState('error');
      });

    return () => {
      alive = false;
    };
  }, [claimId]);

  const count = state === 'ready' ? items.length : '—';

  return (
    <section className="eia-card" aria-label="Documents" data-testid="documents-card" style={{ marginTop: 14 }}>
      <h3>
        Documents{' '}
        <span data-testid="documents-count" style={{ color: 'var(--eia-blue)' }}>{count}</span>
      </h3>
      <p className="eia-muted" data-testid="documents-context" style={{ margin: '0 0 4px', fontSize: 12 }}>
        Documents linked to this claim are evidence. The claim record remains the source of truth: a
        document never changes claim facts, coverage, reserves, or settlement decisions.
      </p>

      {state === 'loading' && (
        <p className="eia-muted" data-testid="documents-loading" style={{ margin: '8px 0 0' }}>
          Loading linked documents…
        </p>
      )}
      {state === 'error' && (
        <p className="eia-muted" data-testid="documents-error" style={{ margin: '8px 0 0' }}>
          Linked documents could not be loaded. The claim record is unaffected.
        </p>
      )}
      {state === 'ready' && items.length === 0 && (
        <p className="eia-muted" data-testid="documents-empty" style={{ margin: '8px 0 0' }}>
          No documents linked to this claim yet.
        </p>
      )}
      {state === 'ready' && items.length > 0 && (
        <div className="eia-table-wrap" style={{ marginTop: 10 }}>
          <table className="eia-table" cellPadding="8" aria-label="Linked documents">
            <thead>
              <tr>
                <th>Document</th>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {items.map((document) => {
                const href = document.id ? recordHref('document', document.id) : '';
                return (
                  <tr key={document.id || document.documentNumber} data-testid="document-row">
                    <td className="eia-mono" data-testid="document-number">{document.documentNumber || '—'}</td>
                    <td>{document.title || '—'}</td>
                    <td>{document.documentType || '—'}</td>
                    <td>
                      <span className={`eia-pill ${statusTone(document.status)}`}>{document.status || '—'}</span>
                    </td>
                    <td>
                      {href ? (
                        <a
                          href={href}
                          onClick={openDocument}
                          aria-label={`Open document ${document.documentNumber || document.id}`}
                        >
                          Open
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
