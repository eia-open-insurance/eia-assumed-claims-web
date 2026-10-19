import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BOOK = 'ASSUMED';
const API_BASE = '/api/v1/assumed-claims/claims';

const EMPTY_FORM = {
  contractId: '22222222-2222-7222-8222-222222222222',
  cedentClaimNumber: '',
  lossDate: '',
  reportDate: '',
  reserveAmount: '0.00',
  reserveCurrency: 'USD'
};

const BASE_HEADERS = {
  'X-EIA-Tenant': TENANT,
  'X-EIA-Book': BOOK
};

async function describeError(response) {
  const fallback = `Request failed with status ${response.status}`;
  try {
    const body = await response.json();
    return body?.detail || body?.title || fallback;
  } catch {
    return fallback;
  }
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) {
    return '—';
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD'
    }).format(Number(amount));
  } catch {
    return `${currency || ''} ${amount}`;
  }
}

export default function App() {
  const [claims, setClaims] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const response = await fetch(API_BASE, { headers: BASE_HEADERS });
    if (!response.ok) {
      throw new Error(await describeError(response));
    }
    const body = await response.json();
    setClaims(Array.isArray(body) ? body : []);
  }

  useEffect(() => {
    load()
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  function updateField(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          cedentClaimNumber: form.cedentClaimNumber || null,
          lossDate: form.lossDate || null,
          reportDate: form.reportDate || null,
          reserveAmount: Number(form.reserveAmount)
        })
      });
      if (!response.ok) {
        throw new Error(await describeError(response));
      }
      setForm((current) => ({ ...EMPTY_FORM, contractId: current.contractId }));
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1040, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 4 }}>Assumed Claims</h1>
      <p style={{ marginTop: 0, color: '#4a4a4a' }}>
        Reinsurance claims for the ASSUMED book only. Loss advices, reserves, and commutations are handled here.
      </p>
      <p
        role="note"
        style={{ background: '#eef4ff', border: '1px solid #c9d9f7', borderRadius: 6, padding: '8px 12px', color: '#213a63' }}
      >
        Book scope: <strong>ASSUMED</strong> · Tenant: {TENANT}
      </p>

      {error && (
        <p role="alert" style={{ color: '#b00020', background: '#fdecef', padding: '8px 12px', borderRadius: 6 }}>
          {error}
        </p>
      )}

      <section aria-labelledby="create-heading" style={{ margin: '24px 0' }}>
        <h2 id="create-heading" style={{ fontSize: 18 }}>Create assumed claim</h2>
        <form onSubmit={submit} style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            Contract ID
            <input value={form.contractId} onChange={updateField('contractId')} required />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Cedent claim number
            <input value={form.cedentClaimNumber} onChange={updateField('cedentClaimNumber')} placeholder="CED-778" />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Loss date
            <input type="date" value={form.lossDate} onChange={updateField('lossDate')} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Report date
            <input type="date" value={form.reportDate} onChange={updateField('reportDate')} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Reserve amount
            <input type="number" min="0" step="0.01" value={form.reserveAmount} onChange={updateField('reserveAmount')} required />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            Reserve currency
            <select value={form.reserveCurrency} onChange={updateField('reserveCurrency')}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </label>
          <button type="submit" disabled={submitting} style={{ alignSelf: 'end', padding: '8px 14px' }}>
            {submitting ? 'Creating…' : 'Create assumed claim'}
          </button>
        </form>
      </section>

      <section aria-labelledby="register-heading">
        <h2 id="register-heading" style={{ fontSize: 18 }}>Claim register</h2>
        {loading ? (
          <p>Loading assumed claims…</p>
        ) : (
          <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #ccc' }}>
                <th align="left">Claim number</th>
                <th align="left">Cedent claim</th>
                <th align="left">Status</th>
                <th align="left">Loss date</th>
                <th align="left">Report date</th>
                <th align="right">Reserve</th>
                <th align="right">Version</th>
              </tr>
            </thead>
            <tbody>
              {claims.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ color: '#666' }}>No assumed claims recorded yet.</td>
                </tr>
              )}
              {claims.map((claim) => (
                <tr key={claim.id} style={{ borderTop: '1px solid #ddd' }}>
                  <td>{claim.assumedClaimNumber}</td>
                  <td>{claim.cedentClaimNumber || '—'}</td>
                  <td>{claim.status}</td>
                  <td>{claim.lossDate || '—'}</td>
                  <td>{claim.reportDate || '—'}</td>
                  <td align="right">{formatMoney(claim.reserveAmount, claim.reserveCurrency)}</td>
                  <td align="right">{claim.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
