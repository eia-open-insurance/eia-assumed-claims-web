import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { documentHref, documentSearchItems } from './documents.js';
import { navigate } from './navigation.js';

const MIN_TERM = 2;
const SEARCH_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 180;

/**
 * Predictive lookup over the Document service for a document reference field.
 *
 * Props:
 *   value      selected document id
 *   valueLabel selected document number/title
 *   onChange   (id, item | null) => void
 *   placeholder
 *   disabled
 *   required
 *   testId     prefix for the rendered test hooks
 */
export default function DocumentPicker({
  value,
  valueLabel,
  onChange,
  placeholder = 'Search documents by number or title…',
  disabled = false,
  required = false,
  testId = 'document-picker'
}) {
  const [term, setTerm] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const q = term.trim();
    if (!open || q.length < MIN_TERM) {
      setItems([]);
      setLoading(false);
      setError('');
      return undefined;
    }

    let alive = true;
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError('');
      try {
        const body = await api.documents.search(q, SEARCH_LIMIT, { signal: controller.signal });
        if (!alive) return;
        setItems(documentSearchItems(body).filter((item) => item?.id));
      } catch (cause) {
        if (!alive || cause?.name === 'AbortError') return;
        setItems([]);
        setError(cause?.message || 'Document search is unavailable.');
      } finally {
        if (alive && !controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [term, open]);

  function choose(item) {
    if (!item?.id) return;
    onChange(item.id, item);
    setOpen(false);
    setTerm('');
    setItems([]);
  }

  function followLink(event, href) {
    if (!href) return;
    if (event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(href);
  }

  if (value) {
    const href = documentHref(value);
    return (
      <div className="eia-picker" ref={rootRef} data-testid={testId}>
        <div className="eia-picker-selected" data-testid={`${testId}-selected`}>
          <span className="value">
            <b data-testid={`${testId}-label`}>{valueLabel || value}</b>
            <small className="eia-mono" title={value}>{value}</small>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <a
              href={href}
              data-testid={`${testId}-link`}
              title="Open the selected document"
              onClick={(event) => followLink(event, href)}
            >
              Open document
            </a>
            <button type="button" disabled={disabled} onClick={() => onChange('', null)}>
              Change
            </button>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="eia-picker" ref={rootRef} data-testid={testId}>
      <input
        type="search"
        value={term}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={placeholder}
        aria-required={required || undefined}
        data-testid={`${testId}-search`}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
      />
      {!open && <span className="eia-picker-hint">Type at least two characters to search document records.</span>}
      {open && (
        <div className="eia-picker-results">
          {loading && <div className="eia-picker-empty">Searching documents…</div>}
          {!loading && error && <div className="eia-picker-empty">{error}</div>}
          {!loading && !error && term.trim().length < MIN_TERM && (
            <div className="eia-picker-empty">Start typing a document number or title.</div>
          )}
          {!loading && !error && term.trim().length >= MIN_TERM && items.length === 0 && (
            <div className="eia-picker-empty">No matching documents.</div>
          )}
          {!loading && items.map((item) => (
            <button
              type="button"
              key={item.id}
              className="eia-picker-option"
              data-testid={`${testId}-option`}
              onClick={() => choose(item)}
            >
              <span className="value">
                <b>{item.label}</b>
                {item.secondary && <small>{item.secondary}</small>}
              </span>
              {item.status && <span className="status">{item.status}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
