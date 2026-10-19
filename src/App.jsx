import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BOOK = 'ASSUMED';
const API_BASE = '/api/v1/assumed-claims';

const EMPTY_CLAIM_FORM = {
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

const TODAY = new Date().toISOString().slice(0, 10);

const NEXT_STATUSES = {
  NOTIFIED: ['OPEN'],
  OPEN: ['RESERVED', 'DENIED', 'WITHDRAWN', 'DISPUTED'],
  RESERVED: ['IN_ADJUSTMENT', 'COMMUTED'],
  IN_ADJUSTMENT: ['SETTLED', 'COMMUTED'],
  SETTLED: ['PAYMENT_PENDING'],
  PAYMENT_PENDING: ['PAID'],
  PAID: ['CLOSED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['OPEN'],
  DISPUTED: ['IN_ADJUSTMENT'],
  DENIED: ['CLOSED'],
  WITHDRAWN: ['CLOSED']
};

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function readError(response) {
  const fallback = `Request failed with status ${response.status}`;
  try {
    const body = await response.json();
    return body?.detail || body?.title || fallback;
  } catch {
    return fallback;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...BASE_HEADERS,
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

async function optional(path) {
  try {
    return await request(path);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) {
      return null;
    }
    throw cause;
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

function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
      {label}
      {children}
    </label>
  );
}

function TabButton({ id, active, onClick, children }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '8px 12px',
        border: '1px solid #c9d3e3',
        borderBottom: active ? '2px solid #214a8a' : '1px solid #c9d3e3',
        background: active ? '#eef4ff' : '#fff',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  );
}

function DataTable({ columns, rows, empty, rowKey }) {
  return (
    <table width="100%" cellPadding="6" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '2px solid #ccc' }}>
          {columns.map((column) => <th key={column.key} align={column.align || 'left'}>{column.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={columns.length} style={{ color: '#666' }}>{empty}</td></tr>
        )}
        {rows.map((row, index) => (
          <tr key={rowKey ? rowKey(row) : index} style={{ borderTop: '1px solid #ddd' }}>
            {columns.map((column) => (
              <td key={column.key} align={column.align || 'left'}>{column.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const column = (key, label, render, align) => ({ key, label, render, align });

export default function App() {
  const [claims, setClaims] = useState([]);
  const [claimForm, setClaimForm] = useState(EMPTY_CLAIM_FORM);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('advices');
  const [resources, setResources] = useState({
    advices: [], bordereaux: [], reserves: [], cashCalls: [], recoveries: [],
    disputes: [], commutation: null, financials: null
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedClaim = claims.find((claim) => claim.id === selectedId) || null;
  const currency = selectedClaim?.reserveCurrency || 'USD';

  const [adviceForm, setAdviceForm] = useState({
    adviceNumber: '', adviceType: 'INITIAL_NOTICE', adviceDate: TODAY,
    reportedAmount: '250000.00', paidAmount: '', outstandingAmount: '', cessionPct: '0.500000'
  });
  const [bordereauForm, setBordereauForm] = useState({ bordereauReference: '', adviceDate: TODAY, lines: 'ADV-BDX-1,5000.00' });
  const [reserveForm, setReserveForm] = useState({
    component: 'CASE', amount: '100000.00', effectiveDate: TODAY,
    reasonCode: 'INITIAL', reasonText: '', authority: 'ADJUSTER', approvedBy: ''
  });
  const [cashForm, setCashForm] = useState({ requestedAmount: '50000.00', reason: 'CASH_LOSS', dueDate: '', approvedBy: '' });
  const [recoveryForm, setRecoveryForm] = useState({ recoveryType: 'SALVAGE', amount: '25000.00', receivedDate: TODAY, status: 'RECEIVED' });
  const [commutationForm, setCommutationForm] = useState({
    offerAmount: '800000.00', acceptedAmount: '750000.00', effectiveDate: TODAY,
    approvedBy: '', approverRole: 'UNDERWRITER', releaseDocumentId: ''
  });
  const [disputeForm, setDisputeForm] = useState({ disputeType: 'QUANTUM', reason: '', contestedAmount: '100000.00' });
  const [statusTarget, setStatusTarget] = useState('');

  async function load() {
    const body = await request('/claims');
    setClaims(Array.isArray(body) ? body : []);
  }

  async function loadWorkspace(id) {
    setWorkspaceLoading(true);
    try {
      const encoded = encodeURIComponent(id);
      const [advices, bordereaux, reserves, cashCalls, recoveries, disputes, financials, commutation] = await Promise.all([
        request(`/claims/${encoded}/advices`),
        request(`/claims/${encoded}/bordereaux`),
        request(`/claims/${encoded}/reserves`),
        request(`/claims/${encoded}/cash-calls`),
        request(`/claims/${encoded}/recoveries`),
        request(`/claims/${encoded}/disputes`),
        request(`/claims/${encoded}/financials`),
        optional(`/claims/${encoded}/commutation`)
      ]);
      setResources({
        advices: advices || [],
        bordereaux: bordereaux || [],
        reserves: reserves || [],
        cashCalls: cashCalls || [],
        recoveries: recoveries || [],
        disputes: disputes || [],
        financials,
        commutation
      });
    } finally {
      setWorkspaceLoading(false);
    }
  }

  useEffect(() => {
    load()
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  function update(setter, field) {
    return (event) => setter((current) => ({ ...current, [field]: event.target.value }));
  }

  async function submitClaim(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await request('/claims', {
        method: 'POST',
        body: JSON.stringify({
          ...claimForm,
          cedentClaimNumber: claimForm.cedentClaimNumber || null,
          lossDate: claimForm.lossDate || null,
          reportDate: claimForm.reportDate || null,
          reserveAmount: claimForm.reserveAmount
        })
      });
      setClaimForm((current) => ({ ...EMPTY_CLAIM_FORM, contractId: current.contractId }));
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function selectClaim(claim) {
    setSelectedId(claim.id);
    setTab('advices');
    setError('');
    setStatusTarget('');
    try {
      await loadWorkspace(claim.id);
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function refreshWorkspace() {
    if (!selectedId) return;
    await Promise.all([load(), loadWorkspace(selectedId)]);
  }

  async function mutate(path, body, method = 'POST') {
    setError('');
    setSubmitting(true);
    try {
      await request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      await refreshWorkspace();
      return true;
    } catch (cause) {
      setError(cause.message);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function recordAdvice(event) {
    event.preventDefault();
    if (!selectedClaim) return;
    const body = {
      adviceNumber: adviceForm.adviceNumber,
      adviceType: adviceForm.adviceType,
      adviceDate: adviceForm.adviceDate,
      reportedAmount: adviceForm.reportedAmount,
      paidAmount: adviceForm.paidAmount || null,
      outstandingAmount: adviceForm.outstandingAmount || null,
      currency,
      cessionPct: adviceForm.cessionPct || null
    };
    if (await mutate(`/claims/${selectedClaim.id}/advices`, body)) {
      setAdviceForm((current) => ({ ...current, adviceNumber: '', paidAmount: '', outstandingAmount: '' }));
    }
  }

  async function ingestBordereau(event) {
    event.preventDefault();
    if (!selectedClaim) return;
    const lines = bordereauForm.lines
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [adviceNumber, reportedAmount] = line.split(',').map((part) => part.trim());
        return { adviceNumber, reportedAmount, adviceType: 'UPDATE' };
      });
    const body = {
      bordereauReference: bordereauForm.bordereauReference,
      adviceDate: bordereauForm.adviceDate,
      currency,
      lines
    };
    if (await mutate(`/claims/${selectedClaim.id}/bordereaux`, body)) {
      setBordereauForm((current) => ({ ...current, bordereauReference: '' }));
    }
  }

  async function changeReserve(event) {
    event.preventDefault();
    if (!selectedClaim) return;
    const body = {
      component: reserveForm.component,
      amount: reserveForm.amount,
      currency,
      effectiveDate: reserveForm.effectiveDate,
      reasonCode: reserveForm.reasonCode,
      reasonText: reserveForm.reasonText || null,
      authority: reserveForm.authority,
      approvedBy: reserveForm.approvedBy || null
    };
    if (await mutate(`/claims/${selectedClaim.id}/reserves`, body)) {
      setReserveForm((current) => ({ ...current, reasonText: '', approvedBy: '' }));
    }
  }

  async function requestCashCall(event) {
    event.preventDefault();
    if (!selectedClaim) return;
    const body = {
      requestedAmount: cashForm.requestedAmount,
      currency,
      reason: cashForm.reason,
      dueDate: cashForm.dueDate || null,
      approvedBy: cashForm.approvedBy || null,
      approverRole: cashForm.approvedBy ? 'CLAIMS' : null
    };
    await mutate(`/claims/${selectedClaim.id}/cash-calls`, body);
  }

  async function recordRecovery(event) {
    event.preventDefault();
    if (!selectedClaim) return;
    await mutate(`/claims/${selectedClaim.id}/recoveries`, {
      recoveryType: recoveryForm.recoveryType,
      amount: recoveryForm.amount,
      currency,
      receivedDate: recoveryForm.receivedDate || null,
      status: recoveryForm.status
    });
  }

  async function commute(event) {
    event.preventDefault();
    if (!selectedClaim) return;
    await mutate(`/claims/${selectedClaim.id}/commute`, {
      offerAmount: commutationForm.offerAmount,
      acceptedAmount: commutationForm.acceptedAmount,
      currency,
      effectiveDate: commutationForm.effectiveDate,
      approvedBy: commutationForm.approvedBy || null,
      approverRole: commutationForm.approverRole,
      releaseDocumentId: commutationForm.releaseDocumentId || null
    });
  }

  async function raiseDispute(event) {
    event.preventDefault();
    if (!selectedClaim) return;
    if (await mutate(`/claims/${selectedClaim.id}/disputes`, {
      disputeType: disputeForm.disputeType,
      reason: disputeForm.reason,
      contestedAmount: disputeForm.contestedAmount,
      currency
    })) {
      setDisputeForm((current) => ({ ...current, reason: '' }));
    }
  }

  async function resolveDispute(dispute) {
    if (!selectedClaim) return;
    await mutate(`/claims/${selectedClaim.id}/disputes/${dispute.id}/resolve`, {
      resolution: 'Resolved in assumed claims workbench',
      status: 'RESOLVED'
    });
  }

  async function applyStatus(event) {
    event.preventDefault();
    if (!selectedClaim || !statusTarget) return;
    const applied = await mutate(`/claims/${selectedClaim.id}/status`, {
      targetStatus: statusTarget,
      expectedVersion: selectedClaim.version
    });
    if (applied) {
      setStatusTarget('');
    }
  }

  const nextStatuses = selectedClaim ? NEXT_STATUSES[selectedClaim.status] || [] : [];

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1240, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 4 }}>Assumed Claims</h1>
      <p style={{ marginTop: 0, color: '#4a4a4a' }}>
        Reinsurance claims for the ASSUMED book only. Advices, reserves, cash calls, recoveries,
        commutations, and disputes are handled here.
      </p>
      <p role="note" style={{ background: '#eef4ff', border: '1px solid #c9d9f7', borderRadius: 6, padding: '8px 12px', color: '#213a63' }}>
        Book scope: <strong>ASSUMED</strong> · Tenant: {TENANT}
      </p>

      {error && (
        <p role="alert" style={{ color: '#b00020', background: '#fdecef', padding: '8px 12px', borderRadius: 6 }}>
          {error}
        </p>
      )}

      <section aria-labelledby="create-heading" style={{ margin: '24px 0' }}>
        <h2 id="create-heading" style={{ fontSize: 18 }}>Create assumed claim</h2>
        <form onSubmit={submitClaim} style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <Field label="Contract ID">
            <input value={claimForm.contractId} onChange={update(setClaimForm, 'contractId')} required />
          </Field>
          <Field label="Cedent claim number">
            <input value={claimForm.cedentClaimNumber} onChange={update(setClaimForm, 'cedentClaimNumber')} placeholder="CED-778" />
          </Field>
          <Field label="Loss date">
            <input type="date" value={claimForm.lossDate} onChange={update(setClaimForm, 'lossDate')} />
          </Field>
          <Field label="Report date">
            <input type="date" value={claimForm.reportDate} onChange={update(setClaimForm, 'reportDate')} />
          </Field>
          <Field label="Reserve amount">
            <input type="number" min="0" step="0.01" value={claimForm.reserveAmount} onChange={update(setClaimForm, 'reserveAmount')} required />
          </Field>
          <Field label="Reserve currency">
            <select value={claimForm.reserveCurrency} onChange={update(setClaimForm, 'reserveCurrency')}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </Field>
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
          <DataTable
            columns={[
              column('number', 'Claim number', (claim) => claim.assumedClaimNumber),
              column('cedent', 'Cedent claim', (claim) => claim.cedentClaimNumber || '—'),
              column('status', 'Status', (claim) => claim.status),
              column('lossDate', 'Loss date', (claim) => claim.lossDate || '—'),
              column('reportDate', 'Report date', (claim) => claim.reportDate || '—'),
              column('reserve', 'Reserve', (claim) => formatMoney(claim.reserveAmount, claim.reserveCurrency), 'right'),
              column('version', 'Version', (claim) => claim.version, 'right'),
              column('action', 'Workbench', (claim) => (
                <button onClick={() => selectClaim(claim)} aria-label={`Open ${claim.assumedClaimNumber}`}>
                  {selectedId === claim.id ? 'Selected' : 'Open'}
                </button>
              ))
            ]}
            rows={claims}
            empty="No assumed claims recorded yet."
            rowKey={(claim) => claim.id}
          />
        )}
      </section>

      {selectedClaim && (
        <section aria-labelledby="workspace-heading" style={{ marginTop: 28, borderTop: '2px solid #214a8a', paddingTop: 16 }}>
          <h2 id="workspace-heading" style={{ fontSize: 20, marginBottom: 4 }}>
            {selectedClaim.assumedClaimNumber} · {selectedClaim.status}
          </h2>
          <p style={{ marginTop: 0, color: '#555' }}>
            Cedent claim {selectedClaim.cedentClaimNumber || '—'} · Version {selectedClaim.version}
            {resources.financials && (
              <> · Incurred {formatMoney(resources.financials.cededIncurredAmount, resources.financials.currency)}
                {' '}· Reserve {formatMoney(resources.financials.cededReserveAmount, resources.financials.currency)}</>
            )}
          </p>

          <form onSubmit={applyStatus} style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 12 }}>
            <Field label="Next status">
              <select aria-label="Next status" value={statusTarget} onChange={(event) => setStatusTarget(event.target.value)}>
                <option value="">Choose…</option>
                {nextStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </Field>
            <button type="submit" disabled={!statusTarget || submitting}>Apply status</button>
          </form>

          <div role="tablist" aria-label="Assumed claim sections" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
            <TabButton id="advices" active={tab === 'advices'} onClick={() => setTab('advices')}>Loss advice</TabButton>
            <TabButton id="reserves" active={tab === 'reserves'} onClick={() => setTab('reserves')}>Reserve history</TabButton>
            <TabButton id="cash" active={tab === 'cash'} onClick={() => setTab('cash')}>Cash calls</TabButton>
            <TabButton id="recoveries" active={tab === 'recoveries'} onClick={() => setTab('recoveries')}>Recoveries</TabButton>
            <TabButton id="commutation" active={tab === 'commutation'} onClick={() => setTab('commutation')}>Commutation</TabButton>
            <TabButton id="disputes" active={tab === 'disputes'} onClick={() => setTab('disputes')}>Disputes</TabButton>
          </div>

          {workspaceLoading && <p>Loading workbench…</p>}

          {tab === 'advices' && (
            <div role="tabpanel" aria-label="Loss advice">
              <h3 style={{ fontSize: 16 }}>Loss advice history</h3>
              <DataTable
                columns={[
                  column('number', 'Advice', (advice) => advice.adviceNumber),
                  column('type', 'Type', (advice) => advice.adviceType),
                  column('date', 'Advice date', (advice) => advice.adviceDate),
                  column('reported', 'Reported', (advice) => formatMoney(advice.reportedAmount, advice.currency), 'right'),
                  column('status', 'Status', (advice) => advice.status),
                  column('action', 'Action', (advice) => advice.status === 'RECEIVED' ? (
                    <button
                      onClick={() => mutate(`/claims/${selectedClaim.id}/advices/${advice.id}/accept`, {})}
                      disabled={submitting}
                      aria-label={`Accept ${advice.adviceNumber}`}
                    >
                      Accept
                    </button>
                  ) : '—')
                ]}
                rows={resources.advices}
                empty="No loss advices recorded."
                rowKey={(advice) => advice.id}
              />

              <form onSubmit={recordAdvice} aria-label="Record loss advice" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 14 }}>
                <Field label="Advice number">
                  <input value={adviceForm.adviceNumber} onChange={update(setAdviceForm, 'adviceNumber')} placeholder="ADV-001" required />
                </Field>
                <Field label="Advice type">
                  <select value={adviceForm.adviceType} onChange={update(setAdviceForm, 'adviceType')}>
                    <option value="INITIAL_NOTICE">INITIAL_NOTICE</option>
                    <option value="RESERVE_CHANGE">RESERVE_CHANGE</option>
                    <option value="PAYMENT">PAYMENT</option>
                    <option value="RECOVERY">RECOVERY</option>
                    <option value="UPDATE">UPDATE</option>
                    <option value="CLOSE">CLOSE</option>
                  </select>
                </Field>
                <Field label="Advice date">
                  <input type="date" value={adviceForm.adviceDate} onChange={update(setAdviceForm, 'adviceDate')} required />
                </Field>
                <Field label="Reported amount">
                  <input type="number" min="0" step="0.01" value={adviceForm.reportedAmount} onChange={update(setAdviceForm, 'reportedAmount')} required />
                </Field>
                <Field label="Paid amount">
                  <input type="number" min="0" step="0.01" value={adviceForm.paidAmount} onChange={update(setAdviceForm, 'paidAmount')} />
                </Field>
                <Field label="Outstanding amount">
                  <input type="number" min="0" step="0.01" value={adviceForm.outstandingAmount} onChange={update(setAdviceForm, 'outstandingAmount')} />
                </Field>
                <Field label="Cession %">
                  <input type="number" min="0" max="1" step="0.000001" value={adviceForm.cessionPct} onChange={update(setAdviceForm, 'cessionPct')} />
                </Field>
                <button type="submit" disabled={submitting}>Record advice</button>
              </form>

              <h3 style={{ fontSize: 16, marginTop: 22 }}>Bordereau batches</h3>
              <DataTable
                columns={[
                  column('reference', 'Reference', (batch) => batch.bordereauReference),
                  column('date', 'Advice date', (batch) => batch.adviceDate),
                  column('lines', 'Lines', (batch) => batch.lineCount, 'right'),
                  column('accepted', 'Accepted', (batch) => batch.acceptedCount, 'right'),
                  column('duplicate', 'Duplicates', (batch) => batch.duplicateCount, 'right'),
                  column('rejected', 'Rejected', (batch) => batch.rejectedCount, 'right'),
                  column('status', 'Status', (batch) => batch.status)
                ]}
                rows={resources.bordereaux}
                empty="No bordereau batches ingested."
                rowKey={(batch) => batch.id}
              />
              <form onSubmit={ingestBordereau} aria-label="Ingest bordereau" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 10 }}>
                <Field label="Bordereau reference">
                  <input value={bordereauForm.bordereauReference} onChange={update(setBordereauForm, 'bordereauReference')} placeholder="BDX-2026-01" required />
                </Field>
                <Field label="Bordereau advice date">
                  <input type="date" value={bordereauForm.adviceDate} onChange={update(setBordereauForm, 'adviceDate')} required />
                </Field>
                <Field label="Lines (adviceNumber,amount)">
                  <input value={bordereauForm.lines} onChange={update(setBordereauForm, 'lines')} required />
                </Field>
                <button type="submit" disabled={submitting}>Ingest bordereau</button>
              </form>
            </div>
          )}

          {tab === 'reserves' && (
            <div role="tabpanel" aria-label="Reserve history">
              <h3 style={{ fontSize: 16 }}>Current reserve</h3>
              <p aria-label="Current reserve total" style={{ fontSize: 22, fontWeight: 700 }}>
                {formatMoney(resources.financials?.cededReserveAmount, resources.financials?.currency || currency)}
              </p>
              <p style={{ color: '#555' }}>
                IBNR {formatMoney(resources.financials?.cededIbnrAmount, resources.financials?.currency || currency)}
                {' '}· Incurred {formatMoney(resources.financials?.cededIncurredAmount, resources.financials?.currency || currency)}
              </p>
              <DataTable
                columns={[
                  column('effective', 'Effective', (entry) => entry.effectiveDate),
                  column('component', 'Component', (entry) => entry.component),
                  column('amount', 'Amount', (entry) => formatMoney(entry.amount, entry.currency), 'right'),
                  column('reason', 'Reason', (entry) => entry.reasonCode),
                  column('authority', 'Authority', (entry) => entry.authority),
                  column('current', 'Current', (entry) => entry.isCurrent ? 'Yes' : 'No'),
                  column('version', 'Version', (entry) => entry.version, 'right')
                ]}
                rows={resources.reserves}
                empty="No reserve movements recorded."
                rowKey={(entry) => entry.id}
              />
              <form onSubmit={changeReserve} aria-label="Change reserve" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 14 }}>
                <Field label="Component">
                  <select value={reserveForm.component} onChange={update(setReserveForm, 'component')}>
                    {['CASE', 'IBNR', 'IBNER', 'OUTSTANDING', 'ALAE', 'ULAE', 'CASH_LOSS', 'SALVAGE', 'SUBROGATION'].map((component) => (
                      <option key={component} value={component}>{component}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount">
                  <input type="number" min="0" step="0.01" value={reserveForm.amount} onChange={update(setReserveForm, 'amount')} required />
                </Field>
                <Field label="Effective date">
                  <input type="date" value={reserveForm.effectiveDate} onChange={update(setReserveForm, 'effectiveDate')} required />
                </Field>
                <Field label="Reason">
                  <select value={reserveForm.reasonCode} onChange={update(setReserveForm, 'reasonCode')}>
                    {['INITIAL', 'ADVICE', 'DEVELOPMENT', 'PAYMENT_APPLIED', 'RECOVERY_APPLIED', 'REVIEW', 'COMMUTATION', 'CLOSE'].map((reason) => (
                      <option key={reason} value={reason}>{reason}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Authority">
                  <select value={reserveForm.authority} onChange={update(setReserveForm, 'authority')}>
                    {['ADJUSTER', 'SENIOR_ADJUSTER', 'ACTUARIAL', 'UNDERWRITER'].map((authority) => (
                      <option key={authority} value={authority}>{authority}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Approved by">
                  <input value={reserveForm.approvedBy} onChange={update(setReserveForm, 'approvedBy')} placeholder="Approver UUID for large/IBNR reserves" />
                </Field>
                <button type="submit" disabled={submitting}>Change reserve</button>
              </form>
            </div>
          )}

          {tab === 'cash' && (
            <div role="tabpanel" aria-label="Cash calls">
              <DataTable
                columns={[
                  column('number', 'Request', (call) => call.requestNumber),
                  column('amount', 'Amount', (call) => formatMoney(call.requestedAmount, call.currency), 'right'),
                  column('due', 'Due', (call) => call.dueDate || '—'),
                  column('status', 'Status', (call) => call.status),
                  column('approval', 'Approval', (call) => call.approvalStatus),
                  column('reason', 'Reason', (call) => call.reason)
                ]}
                rows={resources.cashCalls}
                empty="No cash calls requested."
                rowKey={(call) => call.id}
              />
              <form onSubmit={requestCashCall} aria-label="Request cash call" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 14 }}>
                <Field label="Requested amount">
                  <input type="number" min="0.01" step="0.01" value={cashForm.requestedAmount} onChange={update(setCashForm, 'requestedAmount')} required />
                </Field>
                <Field label="Reason">
                  <select value={cashForm.reason} onChange={update(setCashForm, 'reason')}>
                    {['LARGE_LOSS', 'CASH_LOSS', 'EXPENSE', 'SECURITY', 'OTHER'].map((reason) => (
                      <option key={reason} value={reason}>{reason}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Due date">
                  <input type="date" value={cashForm.dueDate} onChange={update(setCashForm, 'dueDate')} />
                </Field>
                <Field label="Approved by">
                  <input value={cashForm.approvedBy} onChange={update(setCashForm, 'approvedBy')} placeholder="Approver UUID" />
                </Field>
                <button type="submit" disabled={submitting}>Request cash call</button>
              </form>
            </div>
          )}

          {tab === 'recoveries' && (
            <div role="tabpanel" aria-label="Recoveries">
              <DataTable
                columns={[
                  column('type', 'Type', (recovery) => recovery.recoveryType),
                  column('amount', 'Amount', (recovery) => formatMoney(recovery.amount, recovery.currency), 'right'),
                  column('received', 'Received', (recovery) => recovery.receivedDate),
                  column('status', 'Status', (recovery) => recovery.status)
                ]}
                rows={resources.recoveries}
                empty="No recoveries recorded."
                rowKey={(recovery) => recovery.id}
              />
              <form onSubmit={recordRecovery} aria-label="Record recovery" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 14 }}>
                <Field label="Recovery type">
                  <select value={recoveryForm.recoveryType} onChange={update(setRecoveryForm, 'recoveryType')}>
                    {['RETROCESSION', 'INURING_ASSUMED', 'FACULTATIVE', 'SALVAGE', 'SUBROGATION', 'OTHER'].map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Recovery amount">
                  <input type="number" min="0.01" step="0.01" value={recoveryForm.amount} onChange={update(setRecoveryForm, 'amount')} required />
                </Field>
                <Field label="Received date">
                  <input type="date" value={recoveryForm.receivedDate} onChange={update(setRecoveryForm, 'receivedDate')} />
                </Field>
                <Field label="Recovery status">
                  <select value={recoveryForm.status} onChange={update(setRecoveryForm, 'status')}>
                    {['IDENTIFIED', 'PURSUING', 'AGREED', 'RECEIVED', 'DENIED', 'ABANDONED'].map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </Field>
                <button type="submit" disabled={submitting}>Record recovery</button>
              </form>
            </div>
          )}

          {tab === 'commutation' && (
            <div role="tabpanel" aria-label="Commutation">
              {resources.commutation ? (
                <div style={{ background: '#f5f8fd', border: '1px solid #c9d9f7', borderRadius: 6, padding: 12 }}>
                  <p style={{ margin: 0 }}><strong>{resources.commutation.commutationNumber}</strong> · {resources.commutation.status}</p>
                  <p style={{ margin: '6px 0 0' }}>
                    Offer {formatMoney(resources.commutation.offerAmount, resources.commutation.currency)}
                    {' '}· Accepted {formatMoney(resources.commutation.acceptedAmount, resources.commutation.currency)}
                    {' '}· Effective {resources.commutation.effectiveDate}
                  </p>
                  <p style={{ margin: '6px 0 0', color: '#555' }}>
                    Release document {resources.commutation.releaseDocumentId} · Approved by {resources.commutation.approvedBy} ({resources.commutation.approverRole})
                  </p>
                </div>
              ) : (
                <form onSubmit={commute} aria-label="Commute claim" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <Field label="Offer amount">
                    <input type="number" min="0" step="0.01" value={commutationForm.offerAmount} onChange={update(setCommutationForm, 'offerAmount')} required />
                  </Field>
                  <Field label="Accepted amount">
                    <input type="number" min="0" step="0.01" value={commutationForm.acceptedAmount} onChange={update(setCommutationForm, 'acceptedAmount')} required />
                  </Field>
                  <Field label="Effective date">
                    <input type="date" value={commutationForm.effectiveDate} onChange={update(setCommutationForm, 'effectiveDate')} required />
                  </Field>
                  <Field label="Approver role">
                    <select value={commutationForm.approverRole} onChange={update(setCommutationForm, 'approverRole')}>
                      <option value="UNDERWRITER">UNDERWRITER</option>
                      <option value="CLAIMS">CLAIMS</option>
                    </select>
                  </Field>
                  <Field label="Approved by">
                    <input value={commutationForm.approvedBy} onChange={update(setCommutationForm, 'approvedBy')} placeholder="Approver UUID" required />
                  </Field>
                  <Field label="Release document ID">
                    <input value={commutationForm.releaseDocumentId} onChange={update(setCommutationForm, 'releaseDocumentId')} placeholder="Signed release document UUID" required />
                  </Field>
                  <button type="submit" disabled={submitting}>Execute commutation</button>
                </form>
              )}
            </div>
          )}

          {tab === 'disputes' && (
            <div role="tabpanel" aria-label="Disputes">
              <DataTable
                columns={[
                  column('number', 'Dispute', (dispute) => dispute.disputeNumber),
                  column('type', 'Type', (dispute) => dispute.disputeType),
                  column('amount', 'Contested', (dispute) => formatMoney(dispute.contestedAmount, dispute.currency), 'right'),
                  column('status', 'Status', (dispute) => dispute.status),
                  column('resolution', 'Resolution', (dispute) => dispute.resolution || '—'),
                  column('action', 'Action', (dispute) => ['OPEN', 'UNDER_REVIEW', 'NEGOTIATING', 'ESCALATED', 'ARBITRATION'].includes(dispute.status) ? (
                    <button onClick={() => resolveDispute(dispute)} disabled={submitting} aria-label={`Resolve ${dispute.disputeNumber}`}>
                      Resolve
                    </button>
                  ) : '—')
                ]}
                rows={resources.disputes}
                empty="No disputes recorded."
                rowKey={(dispute) => dispute.id}
              />
              <form onSubmit={raiseDispute} aria-label="Raise dispute" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 14 }}>
                <Field label="Dispute type">
                  <select value={disputeForm.disputeType} onChange={update(setDisputeForm, 'disputeType')}>
                    {['COVERAGE', 'QUANTUM', 'LATE_NOTICE', 'ALLOCATION', 'CESSION', 'BORDEREAU', 'SECURITY', 'OTHER'].map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Dispute reason">
                  <input value={disputeForm.reason} onChange={update(setDisputeForm, 'reason')} placeholder="Reason for dispute" required />
                </Field>
                <Field label="Contested amount">
                  <input type="number" min="0" step="0.01" value={disputeForm.contestedAmount} onChange={update(setDisputeForm, 'contestedAmount')} required />
                </Field>
                <button type="submit" disabled={submitting}>Raise dispute</button>
              </form>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
