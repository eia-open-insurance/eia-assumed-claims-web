import React, { useEffect, useState } from 'react';
import { api, money } from './api.js';
import { navigate, recordHref } from './navigation.js';
import { shortId, statusTone } from './ui.jsx';

/**
 * Payments linked to one assumed claim are read-only here. Payment is the
 * financial system of record and owns approval and execution; the assumed
 * claim keeps the loss advice, cash calls, and settlement position. The
 * lookup is card-local so a slow or unavailable Payment service never blocks
 * the claim record.
 */

/** The source linkage stored by the Payment workbench. */
export const CLAIM_SOURCE_TYPE = 'ASSUMED_CLAIM';

/** Payment statuses that represent money actually paid to the claim. */
export const PAID_PAYMENT_STATUSES = ['PAID', 'RECONCILED'];

/** Payment statuses still moving through approval, scheduling, or execution. */
export const PENDING_PAYMENT_STATUSES = [
  'DRAFT',
  'PENDING_AUTHORITY',
  'AUTHORIZED',
  'APPROVED',
  'SCHEDULED',
  'SUBMITTED',
  'ACCEPTED',
  'PROCESSING',
  'PARTIALLY_PAID'
];

/** The payments API returns either a bare array or an {items:[...]} envelope. */
export function paymentItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

/**
 * The endpoint filters by source, but Payment is a shared service and the
 * workbench must never show another claim's payment. A row that carries an
 * explicit source is only kept when it points at this claim; a row that omits
 * the linkage metadata is kept so a thinner payload still renders.
 */
export function belongsToClaim(payment, claimId) {
  const sourceType = String(payment?.sourceType || '').trim().toUpperCase();
  const sourceId = String(payment?.sourceId || '').trim().toLowerCase();
  if (sourceType && sourceType !== CLAIM_SOURCE_TYPE) return false;
  if (sourceId && sourceId !== String(claimId || '').trim().toLowerCase()) return false;
  return true;
}

/** Renders the Payment `createdAt` instant as a stable calendar date. */
export function paymentCreatedDate(value) {
  if (value == null || value === '') return '—';
  const text = String(value);
  const date = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return date ? date[1] : text;
}

/** Normalizes Payment DTOs into the rows rendered by the card. */
export function paymentRows(body, claimId, fallbackCurrency = 'USD') {
  return paymentItems(body)
    .filter((payment) => belongsToClaim(payment, claimId))
    .map((payment) => {
      const id = payment?.id ? String(payment.id) : '';
      const payeeName = String(payment?.payeeName || '').trim();
      const payeePartyId = String(payment?.payeePartyId || '').trim();
      return {
        id,
        paymentNumber: payment?.paymentNumber || (id ? shortId(id) : '—'),
        status: payment?.status || '',
        amount: payment?.amount ?? payment?.paymentAmount ?? null,
        currency: payment?.currency || fallbackCurrency,
        payee: payeeName || payeePartyId || '—',
        createdAt: payment?.createdAt || '',
        href: id ? recordHref('payment', id) : ''
      };
    });
}

/** Sums paid amounts per currency and counts payments still in flight. */
export function paymentSummary(rows) {
  const paidByCurrency = new Map();
  let pending = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const status = String(row?.status || '').toUpperCase();
    if (PAID_PAYMENT_STATUSES.includes(status)) {
      const currency = String(row?.currency || 'USD');
      const amount = Number(row?.amount);
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      paidByCurrency.set(currency, (paidByCurrency.get(currency) || 0) + safeAmount);
    } else if (PENDING_PAYMENT_STATUSES.includes(status)) {
      pending += 1;
    }
  }

  return {
    paid: Array.from(paidByCurrency, ([currency, amount]) => ({ currency, amount })),
    pending
  };
}

/** Mixed-currency claims show one total per currency rather than a bad sum. */
export function paidTotalText(paid, fallbackCurrency = 'USD') {
  if (!Array.isArray(paid) || paid.length === 0) return money(0, fallbackCurrency);
  return paid.map((entry) => money(entry.amount, entry.currency)).join(' · ');
}

function openPayment(event) {
  const href = event.currentTarget.getAttribute('href');
  if (!href) return;
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  navigate(href);
}

export default function PaymentsCard({ claim }) {
  const claimId = claim?.id || '';
  const fallbackCurrency = claim?.reserveCurrency || 'USD';
  const [items, setItems] = useState([]);
  const [state, setState] = useState(claimId ? 'loading' : 'empty');

  useEffect(() => {
    if (!claimId) {
      setItems([]);
      setState('empty');
      return undefined;
    }

    let alive = true;
    setItems([]);
    setState('loading');

    api.payments
      .listBySource(CLAIM_SOURCE_TYPE, claimId)
      .then((body) => {
        if (!alive) return;
        setItems(paymentRows(body, claimId, fallbackCurrency));
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
  }, [claimId, fallbackCurrency]);

  const summary = paymentSummary(items);
  const count = state === 'ready' ? items.length : '—';

  return (
    <section className="eia-card" aria-label="Payments" data-testid="payments-card" style={{ marginTop: 14 }}>
      <h3>
        Payments{' '}
        <span data-testid="payments-count" style={{ color: 'var(--eia-blue)' }}>{count}</span>
      </h3>
      <p className="eia-muted" data-testid="payments-context" style={{ margin: '0 0 4px', fontSize: 12 }}>
        Payment owns approval and execution. The assumed claim holds the loss advice, cash calls,
        and settlement record behind a payment; these rows are the payments linked back to it by
        source.
      </p>

      {state === 'loading' && (
        <p
          className="eia-muted"
          data-testid="payments-loading"
          role="status"
          style={{ margin: '8px 0 0' }}
        >
          Loading linked payments…
        </p>
      )}

      {state === 'error' && (
        <p
          className="eia-muted"
          data-testid="payments-error"
          role="alert"
          style={{ margin: '8px 0 0' }}
        >
          Linked payments could not be loaded. The claim record is unaffected.
        </p>
      )}

      {state === 'ready' && items.length > 0 && (
        <p className="eia-muted" data-testid="payments-summary" style={{ margin: '8px 0 0' }}>
          Total paid <strong data-testid="payments-paid-total">{paidTotalText(summary.paid, fallbackCurrency)}</strong>
          {' · '}
          <strong data-testid="payments-pending-count">{summary.pending}</strong> pending
        </p>
      )}

      {state === 'ready' && items.length === 0 && (
        <div className="eia-empty" data-testid="payments-empty" style={{ marginTop: 10 }}>
          <p style={{ marginTop: 0 }}>No payments recorded for this claim yet.</p>
          <p style={{ marginTop: 0 }}>
            Payments are raised in the Payment workbench from a cash call or settlement recorded on
            this claim. Payment owns approval and execution; the assumed claim keeps the advice,
            cash-call, and settlement record.
          </p>
        </div>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="eia-table-wrap" style={{ marginTop: 10 }}>
          <table className="eia-table" cellPadding="8" aria-label="Claim payments">
            <thead>
              <tr>
                <th>Payment</th>
                <th>Status</th>
                <th align="right">Amount</th>
                <th>Payee</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {items.map((payment, index) => (
                <tr key={payment.id || `${payment.paymentNumber}-${index}`} data-testid="payment-row">
                  <td className="eia-mono" data-testid="payment-number">
                    {payment.href ? (
                      <a
                        href={payment.href}
                        onClick={openPayment}
                        data-testid={payment.id ? `payment-link-${payment.id}` : undefined}
                        title={`Open payment ${payment.paymentNumber}`}
                      >
                        {payment.paymentNumber}
                      </a>
                    ) : (
                      payment.paymentNumber
                    )}
                  </td>
                  <td data-testid="payment-status">
                    <span className={`eia-pill ${statusTone(payment.status)}`}>{payment.status || '—'}</span>
                  </td>
                  <td align="right" data-testid="payment-amount">
                    {payment.amount == null ? '—' : money(payment.amount, payment.currency)}
                  </td>
                  <td data-testid="payment-payee">{payment.payee}</td>
                  <td data-testid="payment-created">
                    <time dateTime={payment.createdAt || undefined}>
                      {paymentCreatedDate(payment.createdAt)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
