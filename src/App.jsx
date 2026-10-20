import React, { useEffect, useState } from 'react';
import './ui.css';
import './tabs.css';

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

const EMPTY_RESOURCES = {
  advices: [],
  bordereaux: [],
  reserves: [],
  cashCalls: [],
  recoveries: [],
  disputes: [],
  audits: [],
  commutation: null,
  financials: null
};

const BASE_HEADERS = {
  'X-EIA-Tenant': TENANT,
  'X-EIA-Book': BOOK
};

const TODAY = new Date().toISOString().slice(0, 10);

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'advices', label: 'Loss Advice' },
  { id: 'reserves', label: 'Reserve History' },
  { id: 'cash', label: 'Cash Calls' },
  { id: 'recoveries', label: 'Recoveries' },
  { id: 'commutation', label: 'Commutation' },
  { id: 'disputes', label: 'Disputes' },
  { id: 'audit', label: 'Audit' }
];

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

const MODAL_BACKDROP = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(11, 46, 79, 0.45)'
};

const MODAL_CARD = {
  width: 'min(780px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  background: '#fff',
  border: '1px solid var(--eia-line)',
  borderRadius: 10,
  padding: 20,
  boxShadow: '0 24px 60px rgba(11, 46, 79, 0.28)'
};

function statusTone(status) {
  if (['CLOSED', 'COMMUTED', 'PAID'].includes(status)) return 'green';
  if (['DENIED', 'WITHDRAWN', 'DISPUTED'].includes(status)) return 'red';
  if (['SETTLED', 'PAYMENT_PENDING', 'REOPENED'].includes(status)) return 'amber';
  return 'blue';
}

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

function asList(value) {
  return Array.isArray(value) ? value : [];
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

function formatTimestamp(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function shortId(value) {
  return value ? String(value).slice(0, 8) : '—';
}

function StatusPill({ status }) {
  return <span className={`eia-pill ${statusTone(status)}`}>{status}</span>;
}

function Field({ label, children, span }) {
  const className = span ? `eia-field span-${span}` : 'eia-field';
  return (
    <label className={className}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function DataTable({ columns, rows = [], empty, rowKey, label }) {
  return (
    <div className="eia-table-wrap">
      <table className="eia-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((item) => (
              <th key={item.key} align={item.align || 'left'}>{item.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="eia-muted">{empty}</td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={rowKey ? rowKey(row) : index}>
              {columns.map((item) => (
                <td key={item.key} align={item.align || 'left'}>{item.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const column = (key, label, render, align) => ({ key, label, render, align });

export default function App() {
  const [claims, setClaims] = useState([]);
  const [claimForm, setClaimForm] = useState(EMPTY_CLAIM_FORM);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('overview');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [resources, setResources] = useState(EMPTY_RESOURCES);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedClaim = claims.find((claim) => claim.id === selectedId) || null;
  const currency = resources.financials?.currency || selectedClaim?.reserveCurrency || 'USD';
  const nextStatuses = selectedClaim ? NEXT_STATUSES[selectedClaim.status] || [] : [];

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

  async function loadClaims() {
    const body = await request('/claims');
    const list = asList(body);
    setClaims(list);
    return list;
  }

  async function loadWorkspace(id) {
    setWorkspaceLoading(true);
    try {
      const encoded = encodeURIComponent(id);
      const [advices, bordereaux, reserves, cashCalls, recoveries, disputes, audits, financials, commutation] = await Promise.all([
        request(`/claims/${encoded}/advices`),
        request(`/claims/${encoded}/bordereaux`),
        request(`/claims/${encoded}/reserves`),
        request(`/claims/${encoded}/cash-calls`),
        request(`/claims/${encoded}/recoveries`),
        request(`/claims/${encoded}/disputes`),
        request(`/claims/${encoded}/audit`),
        request(`/claims/${encoded}/financials`),
        optional(`/claims/${encoded}/commutation`)
      ]);
      setResources({
        advices: asList(advices),
        bordereaux: asList(bordereaux),
        reserves: asList(reserves),
        cashCalls: asList(cashCalls),
        recoveries: asList(recoveries),
        disputes: asList(disputes),
        audits: asList(audits),
        financials: financials || null,
        commutation: commutation || null
      });
    } finally {
      setWorkspaceLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    async function bootstrap() {
      try {
        const list = await loadClaims();
        if (!alive || list.length === 0) return;
        setSelectedId(list[0].id);
        await loadWorkspace(list[0].id);
      } catch (cause) {
        if (alive) setError(cause.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    bootstrap();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!registerOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setRegisterOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [registerOpen]);

  function update(setter, field) {
    return (event) => setter((current) => ({ ...current, [field]: event.target.value }));
  }

  async function reloadClaimsAndWorkspace() {
    const list = await loadClaims();
    const stillSelected = selectedId && list.some((claim) => claim.id === selectedId);
    if (stillSelected) {
      await loadWorkspace(selectedId);
      return;
    }
    if (list.length > 0) {
      setSelectedId(list[0].id);
      setTab('overview');
      await loadWorkspace(list[0].id);
      return;
    }
    setSelectedId(null);
    setResources(EMPTY_RESOURCES);
  }

  async function refreshWorkspace() {
    setError('');
    try {
      await reloadClaimsAndWorkspace();
    } catch (cause) {
      setError(cause.message);
    }
  }

  function openRegister() {
    setClaimForm((current) => ({ ...EMPTY_CLAIM_FORM, contractId: current.contractId }));
    setError('');
    setRegisterOpen(true);
  }

  async function submitClaim(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const created = await request('/claims', {
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
      setRegisterOpen(false);
      await loadClaims();
      if (created?.id) {
        setSelectedId(created.id);
        setTab('overview');
        await loadWorkspace(created.id);
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function selectClaim(claim) {
    setSelectedId(claim.id);
    setTab('overview');
    setError('');
    setStatusTarget('');
    setResources(EMPTY_RESOURCES);
    try {
      await loadWorkspace(claim.id);
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function mutate(path, body, method = 'POST') {
    setError('');
    setSubmitting(true);
    try {
      await request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      await reloadClaimsAndWorkspace();
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

  async function closeClaim() {
    if (!selectedClaim) return;
    if (await mutate(`/claims/${selectedClaim.id}/close`)) {
      setStatusTarget('');
      setTab('overview');
    }
  }

  function renderOverview() {
    return (
      <>
        <div className="eia-section-title">
          <h2>Claim details</h2>
          <span className="eia-badge">Version {selectedClaim.version}</span>
        </div>
        <div className="eia-card">
          <dl className="eia-kv">
            <dt>Assumed claim</dt>
            <dd className="eia-mono">{selectedClaim.assumedClaimNumber}</dd>
            <dt>Cedent claim</dt>
            <dd>{selectedClaim.cedentClaimNumber || '—'}</dd>
            <dt>Status</dt>
            <dd><StatusPill status={selectedClaim.status} /></dd>
            <dt>Contract</dt>
            <dd className="eia-mono" title={selectedClaim.contractId}>{selectedClaim.contractId || '—'}</dd>
            <dt>Loss date</dt>
            <dd>{selectedClaim.lossDate || '—'}</dd>
            <dt>Report date</dt>
            <dd>{selectedClaim.reportDate || '—'}</dd>
            <dt>Initial advised reserve</dt>
            <dd>{formatMoney(selectedClaim.reserveAmount, selectedClaim.reserveCurrency)}</dd>
            <dt>Reserve currency</dt>
            <dd>{selectedClaim.reserveCurrency || '—'}</dd>
            <dt>Last advice</dt>
            <dd>{formatTimestamp(resources.financials?.lastAdviceAt)}</dd>
          </dl>
        </div>

        <div className="eia-section-title">
          <h2>Financial summary</h2>
          <span className="eia-muted">{currency}</span>
        </div>
        <div className="eia-card">
          <dl className="eia-kv">
            <dt>Ceded paid</dt>
            <dd>{formatMoney(resources.financials?.cededPaidAmount, currency)}</dd>
            <dt>Ceded outstanding</dt>
            <dd>{formatMoney(resources.financials?.cededOutstandingAmount, currency)}</dd>
            <dt>Ceded reserve</dt>
            <dd>{formatMoney(resources.financials?.cededReserveAmount, currency)}</dd>
            <dt>IBNR</dt>
            <dd>{formatMoney(resources.financials?.cededIbnrAmount, currency)}</dd>
            <dt>Ceded incurred</dt>
            <dd>{formatMoney(resources.financials?.cededIncurredAmount, currency)}</dd>
            <dt>Ceded recovery</dt>
            <dd>{formatMoney(resources.financials?.cededRecoveryAmount, currency)}</dd>
            <dt>Net ceded</dt>
            <dd>{formatMoney(resources.financials?.netCededAmount, currency)}</dd>
            <dt>Advised loss</dt>
            <dd>{formatMoney(resources.financials?.advisedLossAmount, currency)}</dd>
          </dl>
        </div>
      </>
    );
  }

  function renderAdvices() {
    return (
      <>
        <div className="eia-section-title">
          <h2>Loss advice history</h2>
          <span className="eia-muted">{resources.advices.length} advice{resources.advices.length === 1 ? '' : 's'}</span>
        </div>
        <DataTable
          label="Loss advice history"
          columns={[
            column('number', 'Advice', (advice) => advice.adviceNumber),
            column('type', 'Type', (advice) => advice.adviceType),
            column('date', 'Advice date', (advice) => advice.adviceDate || '—'),
            column('reported', 'Reported', (advice) => formatMoney(advice.reportedAmount, advice.currency), 'right'),
            column('status', 'Status', (advice) => <StatusPill status={advice.status} />),
            column('action', 'Action', (advice) => advice.status === 'RECEIVED' ? (
              <button
                type="button"
                className="eia-btn-secondary"
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

        <div className="eia-section-title">
          <h2>Record loss advice</h2>
        </div>
        <form aria-label="Record loss advice" className="eia-form-grid" onSubmit={recordAdvice}>
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
          <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" disabled={submitting}>Record advice</button>
          </div>
        </form>

        <div className="eia-divider" />

        <div className="eia-section-title">
          <h2>Bordereau batches</h2>
        </div>
        <DataTable
          label="Bordereau batches"
          columns={[
            column('reference', 'Reference', (batch) => batch.bordereauReference),
            column('date', 'Advice date', (batch) => batch.adviceDate || '—'),
            column('lines', 'Lines', (batch) => batch.lineCount, 'right'),
            column('accepted', 'Accepted', (batch) => batch.acceptedCount, 'right'),
            column('duplicate', 'Duplicates', (batch) => batch.duplicateCount, 'right'),
            column('rejected', 'Rejected', (batch) => batch.rejectedCount, 'right'),
            column('status', 'Status', (batch) => <StatusPill status={batch.status} />)
          ]}
          rows={resources.bordereaux}
          empty="No bordereau batches ingested."
          rowKey={(batch) => batch.id}
        />

        <div className="eia-section-title">
          <h2>Ingest bordereau</h2>
        </div>
        <form aria-label="Ingest bordereau" className="eia-form-grid" onSubmit={ingestBordereau}>
          <Field label="Bordereau reference">
            <input value={bordereauForm.bordereauReference} onChange={update(setBordereauForm, 'bordereauReference')} placeholder="BDX-2026-01" required />
          </Field>
          <Field label="Bordereau advice date">
            <input type="date" value={bordereauForm.adviceDate} onChange={update(setBordereauForm, 'adviceDate')} required />
          </Field>
          <Field label="Lines (adviceNumber,amount)">
            <input value={bordereauForm.lines} onChange={update(setBordereauForm, 'lines')} required />
          </Field>
          <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" disabled={submitting}>Ingest bordereau</button>
          </div>
        </form>
      </>
    );
  }

  function renderReserves() {
    return (
      <>
        <div className="eia-section-title">
          <h2>Reserve position</h2>
          <span className="eia-muted">{resources.reserves.length} movement{resources.reserves.length === 1 ? '' : 's'}</span>
        </div>
        <div className="eia-card" style={{ marginBottom: 14 }}>
          <h3>Current reserve</h3>
          <div className="value" aria-label="Current reserve total" style={{ fontSize: 24, fontWeight: 700, color: 'var(--eia-navy)' }}>
            {formatMoney(resources.financials?.cededReserveAmount, currency)}
          </div>
          <p className="eia-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
            IBNR {formatMoney(resources.financials?.cededIbnrAmount, currency)}
            {' '}· Incurred {formatMoney(resources.financials?.cededIncurredAmount, currency)}
          </p>
        </div>
        <DataTable
          label="Reserve history"
          columns={[
            column('effective', 'Effective', (entry) => entry.effectiveDate || '—'),
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

        <div className="eia-section-title">
          <h2>Change reserve</h2>
        </div>
        <form aria-label="Change reserve" className="eia-form-grid" onSubmit={changeReserve}>
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
          <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" disabled={submitting}>Change reserve</button>
          </div>
        </form>
      </>
    );
  }

  function renderCashCalls() {
    return (
      <>
        <div className="eia-section-title">
          <h2>Cash call history</h2>
          <span className="eia-muted">{resources.cashCalls.length} request{resources.cashCalls.length === 1 ? '' : 's'}</span>
        </div>
        <DataTable
          label="Cash calls"
          columns={[
            column('number', 'Request', (call) => call.requestNumber),
            column('amount', 'Amount', (call) => formatMoney(call.requestedAmount, call.currency), 'right'),
            column('due', 'Due', (call) => call.dueDate || '—'),
            column('status', 'Status', (call) => <StatusPill status={call.status} />),
            column('approval', 'Approval', (call) => call.approvalStatus),
            column('reason', 'Reason', (call) => call.reason)
          ]}
          rows={resources.cashCalls}
          empty="No cash calls requested."
          rowKey={(call) => call.id}
        />

        <div className="eia-section-title">
          <h2>Request cash call</h2>
        </div>
        <form aria-label="Request cash call" className="eia-form-grid" onSubmit={requestCashCall}>
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
          <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" disabled={submitting}>Request cash call</button>
          </div>
        </form>
      </>
    );
  }

  function renderRecoveries() {
    return (
      <>
        <div className="eia-section-title">
          <h2>Recovery history</h2>
          <span className="eia-muted">{resources.recoveries.length} recovery{resources.recoveries.length === 1 ? '' : 'ies'}</span>
        </div>
        <DataTable
          label="Recoveries"
          columns={[
            column('type', 'Type', (recovery) => recovery.recoveryType),
            column('amount', 'Amount', (recovery) => formatMoney(recovery.amount, recovery.currency), 'right'),
            column('received', 'Received', (recovery) => recovery.receivedDate || '—'),
            column('status', 'Status', (recovery) => <StatusPill status={recovery.status} />)
          ]}
          rows={resources.recoveries}
          empty="No recoveries recorded."
          rowKey={(recovery) => recovery.id}
        />

        <div className="eia-section-title">
          <h2>Record recovery</h2>
        </div>
        <form aria-label="Record recovery" className="eia-form-grid" onSubmit={recordRecovery}>
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
          <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" disabled={submitting}>Record recovery</button>
          </div>
        </form>
      </>
    );
  }

  function renderCommutation() {
    return (
      <>
        <div className="eia-section-title">
          <h2>Commutation</h2>
          <span className="eia-muted">{selectedClaim.status}</span>
        </div>
        {resources.commutation ? (
          <div className="eia-card">
            <dl className="eia-kv">
              <dt>Commutation</dt>
              <dd className="eia-mono">{resources.commutation.commutationNumber}</dd>
              <dt>Status</dt>
              <dd><StatusPill status={resources.commutation.status} /></dd>
              <dt>Offer</dt>
              <dd>{formatMoney(resources.commutation.offerAmount, resources.commutation.currency)}</dd>
              <dt>Accepted</dt>
              <dd>{formatMoney(resources.commutation.acceptedAmount, resources.commutation.currency)}</dd>
              <dt>Effective date</dt>
              <dd>{resources.commutation.effectiveDate || '—'}</dd>
              <dt>Release document</dt>
              <dd className="eia-mono">{resources.commutation.releaseDocumentId || '—'}</dd>
              <dt>Approved by</dt>
              <dd className="eia-mono">{resources.commutation.approvedBy || '—'}</dd>
              <dt>Approver role</dt>
              <dd>{resources.commutation.approverRole || '—'}</dd>
            </dl>
          </div>
        ) : (
          <>
            <div className="eia-card" style={{ marginBottom: 14 }}>
              <p style={{ margin: 0 }}>
                No commutation has been recorded. Executing a commutation closes the claim and requires
                a signed release document and an underwriter or claims approver.
              </p>
            </div>
            <form aria-label="Commute claim" className="eia-form-grid" onSubmit={commute}>
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
              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" disabled={submitting}>Execute commutation</button>
              </div>
            </form>
          </>
        )}
      </>
    );
  }

  function renderDisputes() {
    return (
      <>
        <div className="eia-section-title">
          <h2>Dispute register</h2>
          <span className="eia-muted">{resources.disputes.length} dispute{resources.disputes.length === 1 ? '' : 's'}</span>
        </div>
        <DataTable
          label="Disputes"
          columns={[
            column('number', 'Dispute', (dispute) => dispute.disputeNumber),
            column('type', 'Type', (dispute) => dispute.disputeType),
            column('amount', 'Contested', (dispute) => formatMoney(dispute.contestedAmount, dispute.currency), 'right'),
            column('status', 'Status', (dispute) => <StatusPill status={dispute.status} />),
            column('resolution', 'Resolution', (dispute) => dispute.resolution || '—'),
            column('action', 'Action', (dispute) => ['OPEN', 'UNDER_REVIEW', 'NEGOTIATING', 'ESCALATED', 'ARBITRATION'].includes(dispute.status) ? (
              <button
                type="button"
                className="eia-btn-secondary"
                onClick={() => resolveDispute(dispute)}
                disabled={submitting}
                aria-label={`Resolve ${dispute.disputeNumber}`}
              >
                Resolve
              </button>
            ) : '—')
          ]}
          rows={resources.disputes}
          empty="No disputes recorded."
          rowKey={(dispute) => dispute.id}
        />

        <div className="eia-section-title">
          <h2>Raise dispute</h2>
        </div>
        <form aria-label="Raise dispute" className="eia-form-grid" onSubmit={raiseDispute}>
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
          <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" disabled={submitting}>Raise dispute</button>
          </div>
        </form>
      </>
    );
  }

  function renderAudit() {
    return (
      <>
        <div className="eia-section-title">
          <h2>Claim audit trail</h2>
          <span className="eia-muted">{resources.audits.length} event{resources.audits.length === 1 ? '' : 's'}</span>
        </div>
        <DataTable
          label="Claim audit trail"
          columns={[
            column('sequence', 'Sequence', (entry) => entry.sequence, 'right'),
            column('event', 'Event', (entry) => <span className="eia-badge">{entry.eventType}</span>),
            column('actor', 'Actor', (entry) => entry.actor || '—'),
            column('detail', 'Detail', (entry) => entry.detail || '—'),
            column('occurred', 'Occurred', (entry) => formatTimestamp(entry.occurredAt))
          ]}
          rows={resources.audits}
          empty="No audit events recorded."
          rowKey={(entry) => entry.id || entry.sequence}
        />
      </>
    );
  }

  function renderTabPanel() {
    switch (tab) {
      case 'advices': return renderAdvices();
      case 'reserves': return renderReserves();
      case 'cash': return renderCashCalls();
      case 'recoveries': return renderRecoveries();
      case 'commutation': return renderCommutation();
      case 'disputes': return renderDisputes();
      case 'audit': return renderAudit();
      default: return renderOverview();
    }
  }

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Claims · Assumed book</div>
          <h1>Assumed Claims</h1>
          <p className="subtitle">
            Loss advices, reinsurance reserves, cash calls, recoveries, disputes, commutations, and
            audit history for inward reinsurance claims on the ASSUMED book.
          </p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge assumed" aria-label="Book scope">ASSUMED</span>
          <button
            type="button"
            className="eia-btn-secondary"
            onClick={refreshWorkspace}
            disabled={loading || submitting}
          >
            Refresh
          </button>
          <button type="button" onClick={openRegister}>Register assumed claim</button>
        </div>
      </header>

      {error && !registerOpen && (
        <p role="alert" style={{ margin: '0 0 14px' }}>{error}</p>
      )}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Assumed claim register">
          <div className="eia-record-list-head">
            <strong>Assumed claims</strong>
            <span className="eia-muted">
              {loading ? 'Loading…' : `${claims.length} record${claims.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {loading && <div className="empty">Loading assumed claims…</div>}
          {!loading && claims.length === 0 && (
            <div className="empty">No assumed claims recorded yet. Use Register assumed claim to create the first record.</div>
          )}
          {!loading && claims.map((claim) => (
            <button
              key={claim.id}
              type="button"
              className={selectedId === claim.id ? 'selected' : ''}
              aria-label={`Open ${claim.assumedClaimNumber}`}
              aria-pressed={selectedId === claim.id}
              onClick={() => selectClaim(claim)}
            >
              <span className="record-primary">{claim.assumedClaimNumber}</span>
              <span className="record-secondary">Cedent claim {claim.cedentClaimNumber || '—'}</span>
              <span><StatusPill status={claim.status} /></span>
            </button>
          ))}
        </aside>

        <section className="eia-record-panel" aria-label="Assumed claim workbench" aria-busy={workspaceLoading}>
          {!selectedClaim && (
            <div className="eia-empty">
              Select an assumed claim from the register to open its operational record, or register a new claim.
            </div>
          )}

          {selectedClaim && (
            <>
              <div className="eia-record-title">
                <div>
                  <h2>{selectedClaim.assumedClaimNumber}</h2>
                  <p className="eia-record-subtitle">
                    Cedent claim <strong>{selectedClaim.cedentClaimNumber || '—'}</strong>
                    {' '}· Contract <span className="eia-mono" title={selectedClaim.contractId}>{shortId(selectedClaim.contractId)}</span>
                    {' '}· Version {selectedClaim.version}
                  </p>
                </div>
                <StatusPill status={selectedClaim.status} />
              </div>

              <form className="eia-toolbar" aria-label="Change claim status" onSubmit={applyStatus}>
                <label htmlFor="next-status" className="eia-muted">Next status</label>
                <select
                  id="next-status"
                  aria-label="Next status"
                  value={statusTarget}
                  onChange={(event) => setStatusTarget(event.target.value)}
                  disabled={nextStatuses.length === 0 || submitting}
                >
                  <option value="">{nextStatuses.length === 0 ? 'No transitions' : 'Choose…'}</option>
                  {nextStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <button type="submit" disabled={!statusTarget || submitting}>Apply status</button>
                <span className="spacer" />
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeClaim}
                  disabled={submitting || selectedClaim.status === 'CLOSED'}
                >
                  Close claim
                </button>
              </form>

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Current reserve</h3>
                  <div className="value">{formatMoney(resources.financials?.cededReserveAmount, currency)}</div>
                  <div className="eia-metric-label">ceded reserve to date</div>
                </div>
                <div className="eia-card">
                  <h3>Advised loss</h3>
                  <div className="value">{formatMoney(resources.financials?.advisedLossAmount, currency)}</div>
                  <div className="eia-metric-label">cedent advised</div>
                </div>
                <div className="eia-card">
                  <h3>Recoveries</h3>
                  <div className="value">{formatMoney(resources.financials?.cededRecoveryAmount, currency)}</div>
                  <div className="eia-metric-label">ceded recoveries</div>
                </div>
                <div className="eia-card">
                  <h3>Cash calls</h3>
                  <div className="value">{formatMoney(resources.financials?.cashCallAmount, currency)}</div>
                  <div className="eia-metric-label">requested to date</div>
                </div>
              </div>

              {workspaceLoading && <p className="eia-muted" role="status">Loading workbench…</p>}

              <div className="eia-tabs" role="tablist" aria-label="Assumed claim sections">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    id={`claim-tab-${item.id}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    aria-controls={`claim-panel-${item.id}`}
                    className={tab === item.id ? 'eia-tab active' : 'eia-tab'}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div
                id={`claim-panel-${tab}`}
                role="tabpanel"
                aria-labelledby={`claim-tab-${tab}`}
              >
                {renderTabPanel()}
              </div>
            </>
          )}
        </section>
      </div>

      {registerOpen && (
        <div
          style={MODAL_BACKDROP}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRegisterOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-claim-title"
            style={MODAL_CARD}
          >
            <div className="eia-record-title">
              <div>
                <h2 id="register-claim-title">Register assumed claim</h2>
                <p className="eia-record-subtitle">
                  Create the reinsurer claim record from a cedent notice. The ASSUMED book scope is applied
                  to every request.
                </p>
              </div>
              <button type="button" className="eia-btn-ghost" onClick={() => setRegisterOpen(false)}>
                Cancel
              </button>
            </div>

            {error && <p role="alert" style={{ margin: '10px 0 14px' }}>{error}</p>}

            <form aria-label="Register assumed claim" className="eia-form-grid" onSubmit={submitClaim}>
              <Field label="Contract ID">
                <input
                  value={claimForm.contractId}
                  onChange={update(setClaimForm, 'contractId')}
                  autoFocus
                  required
                />
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
              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" disabled={submitting}>
                  {submitting ? 'Creating…' : 'Create assumed claim'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
