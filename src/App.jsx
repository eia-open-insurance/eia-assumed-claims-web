import React, { useEffect, useRef, useState } from 'react';
import ActivityTab, {
  ACTIVITY_LIMIT,
  activityItems,
  sortActivityItems
} from './ActivityTab.jsx';
import { ApiError, BOOK, api, request } from './api.js';
import AssignmentDialog, {
  assignmentFilterValues,
  assignmentText,
  ownershipNote,
  readAssignment,
  teamLabel
} from './ClaimAssignment.jsx';
import ClaimProgress from './ClaimProgress.jsx';
import DiaryNotesTab from './DiaryNotesTab.jsx';
import DocumentsCard from './DocumentsCard.jsx';
import EntityPicker from './EntityPicker.jsx';
import { contractEndpoint, contractRecordLabel } from './contract.js';
import { navigate, recordHref } from './navigation.js';
import { DataTable, Field } from './ui.jsx';
import './ui.css';
import './tabs.css';
import './workbench.css';
import './ui-overrides.css';

const EMPTY_CLAIM_FORM = {
  contractId: '',
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

const TODAY = new Date().toISOString().slice(0, 10);

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'advices', label: 'Loss Advice' },
  { id: 'reserves', label: 'Reserve History' },
  { id: 'cash', label: 'Cash Calls' },
  { id: 'recoveries', label: 'Recoveries' },
  { id: 'commutation', label: 'Commutation' },
  { id: 'disputes', label: 'Disputes' },
  { id: 'audit', label: 'Audit' },
  { id: 'activity', label: 'Activity' },
  { id: 'diary', label: 'Diary & Notes' }
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

/** Search endpoints return either the shared envelope or a bare list. */
function searchItems(body) {
  if (Array.isArray(body)) return body;
  return asList(body?.items);
}

/** Open diary items exclude completed and cancelled tasks. */
function countOpenTasks(rows) {
  if (!Array.isArray(rows)) return null;
  const closed = ['COMPLETE', 'CANCELLED'];
  return rows.filter((row) => !closed.includes(String(row.status || 'OPEN').toUpperCase())).length;
}

/** Reads the shell deep-link parameters for this remote. */
function readRoute() {
  if (typeof window === 'undefined' || !window.location) {
    return { record: null, isNew: false };
  }
  const params = new URLSearchParams(window.location.search);
  return { record: params.get('record'), isNew: params.get('new') === '1' };
}

/**
 * Pushes the current shell route with the supplied parameters patched in.
 * The remote never owns routing: the shell's `popstate` listener swaps remotes,
 * and this helper only keeps the URL in step with the workbench state.
 */
function pushRoute(patch = {}) {
  if (typeof window === 'undefined' || !window.location) return;
  const params = new URLSearchParams(window.location.search);
  if (Object.prototype.hasOwnProperty.call(patch, 'record')) {
    if (patch.record) params.set('record', patch.record);
    else params.delete('record');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'isNew')) {
    if (patch.isNew) params.set('new', '1');
    else params.delete('new');
  }
  const query = params.toString();
  navigate(`${window.location.pathname}${query ? `?${query}` : ''}`);
}

function matchesQueueFilter(claim, needle) {
  if (!needle) return true;
  return [
    claim.assumedClaimNumber,
    claim.cedentClaimNumber,
    claim.status,
    ...assignmentFilterValues(claim)
  ].some((value) => value !== null && value !== undefined
    && String(value).toLowerCase().includes(needle));
}

function contractTypeOf(item) {
  const descriptor = String(item?.secondary || '').split('·')[0].trim();
  return descriptor || item?.type || 'CONTRACT';
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

const column = (key, label, render, align) => ({ key, label, render, align });

export default function App() {
  const [claims, setClaims] = useState([]);
  const [claimForm, setClaimForm] = useState(EMPTY_CLAIM_FORM);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('overview');
  const [registerOpen, setRegisterOpen] = useState(() => readRoute().isNew);
  const [assignOpen, setAssignOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [contractPick, setContractPick] = useState(null);
  const [queueFilter, setQueueFilter] = useState('');
  const [relatedRetrocessions, setRelatedRetrocessions] = useState([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [contractLookup, setContractLookup] = useState({ contractId: null, contract: null });
  const [resources, setResources] = useState(EMPTY_RESOURCES);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState({ openTasks: null });
  const [summaryNonce, setSummaryNonce] = useState(0);
  const [activity, setActivity] = useState({
    claimId: null,
    items: [],
    loading: false,
    error: ''
  });

  const claimsRef = useRef([]);
  const selectedIdRef = useRef(null);
  const openRecordRef = useRef(null);
  const activityRequestRef = useRef(0);

  const selectedClaim = claims.find((claim) => claim.id === selectedId) || null;
  const selectedAssignment = assignmentText(selectedClaim);
  /**
   * The event timeline is loaded as soon as a claim is selected, so its
   * loading/error state must follow the selected claim rather than the tab.
   * A state row for another claim is never rendered under this header.
   */
  const selectedActivity = selectedClaim && activity.claimId === selectedClaim.id
    ? activity
    : { items: [], loading: Boolean(selectedClaim), error: '' };
  const currency = resources.financials?.currency || selectedClaim?.reserveCurrency || 'USD';
  const nextStatuses = selectedClaim ? NEXT_STATUSES[selectedClaim.status] || [] : [];
  const queueNeedle = queueFilter.trim().toLowerCase();
  const filteredClaims = queueNeedle
    ? claims.filter((claim) => matchesQueueFilter(claim, queueNeedle))
    : claims;
  const selectedContractId = selectedClaim?.contractId || null;
  const contractHref = selectedContractId
    ? recordHref('contract', selectedContractId)
    : null;
  const resolvedContract = contractLookup.contractId === selectedContractId
    ? contractLookup.contract
    : null;
  const contractLabel = selectedContractId
    ? contractRecordLabel(resolvedContract) || shortId(selectedContractId)
    : '—';

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
    claimsRef.current = list;
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

  /**
   * Activity is derived from the platform event inbox, not from the claim
   * aggregate. It loads on selection but stays card-local: an unavailable
   * event service never blocks the claim record or writes a page-level error.
   */
  async function loadActivity(claimId) {
    const requestId = activityRequestRef.current + 1;
    activityRequestRef.current = requestId;

    if (!claimId) {
      setActivity({ claimId: null, items: [], loading: false, error: '' });
      return;
    }

    setActivity({ claimId, items: [], loading: true, error: '' });
    try {
      const body = await api.events.aggregate(claimId, ACTIVITY_LIMIT);
      if (activityRequestRef.current !== requestId) return;
      setActivity({
        claimId,
        items: sortActivityItems(activityItems(body)),
        loading: false,
        error: ''
      });
    } catch (cause) {
      if (activityRequestRef.current !== requestId) return;
      setActivity({
        claimId,
        items: [],
        loading: false,
        error: cause?.message || 'The platform event inbox could not be reached.'
      });
    }
  }

  function rememberClaim(claim) {
    if (!claim?.id) return claim;
    const next = [claim, ...claimsRef.current.filter((entry) => entry.id !== claim.id)];
    claimsRef.current = next;
    setClaims(next);
    return claim;
  }

  /** Replaces a claim in place so an assignment refresh never reorders the queue. */
  function upsertClaim(claim) {
    if (!claim?.id) return null;
    const exists = claimsRef.current.some((entry) => entry.id === claim.id);
    const next = exists
      ? claimsRef.current.map((entry) => (entry.id === claim.id ? { ...entry, ...claim } : entry))
      : [claim, ...claimsRef.current];
    claimsRef.current = next;
    setClaims(next);
    return claim;
  }

  /**
   * Committed assignment. The server answer is applied immediately, then the
   * queue and the claim detail (including the audit trail entry) are reloaded
   * so every surface shows the same owner and version.
   */
  async function handleAssigned(updated, submitted) {
    if (!selectedClaim) return;
    const claimId = selectedClaim.id;
    const claimNumber = selectedClaim.assumedClaimNumber;
    setAssignOpen(false);
    setError('');
    setNotice(`${claimNumber || 'Claim'} assigned to ${assignmentText(submitted).display}.`);

    const server = readAssignment(updated);
    upsertClaim({
      ...(updated?.id ? updated : {}),
      id: claimId,
      assumedClaimNumber: updated?.assumedClaimNumber || claimNumber,
      assignedAdjuster: server.assignedAdjuster || submitted.assignedAdjuster,
      assignedTeam: server.assignedTeam || submitted.assignedTeam
    });

    try {
      await loadClaims();
      const fresh = await api.claims.get(claimId);
      if (fresh?.id) upsertClaim(fresh);
    } catch {
      // The assignment already committed; a stale queue/detail refresh must not
      // turn a successful write into an error banner.
    }
    try {
      await loadWorkspace(claimId);
    } catch {
      setNotice(`${claimNumber || 'Claim'} assigned to ${assignmentText(submitted).display}. Refresh the record to load the latest audit entry.`);
    }
  }

  /** Loads the queue and claim detail again so a stale dialog can retry. */
  async function reloadClaimRecord(claimId) {
    const rows = await loadClaims();
    let fresh = null;
    let detailError = null;
    try {
      fresh = await api.claims.get(claimId);
    } catch (cause) {
      detailError = cause;
    }
    const fallback = Array.isArray(rows) ? rows.find((row) => row.id === claimId) : null;
    const resolved = fresh?.id ? fresh : fallback;
    if (resolved) upsertClaim(resolved);
    if (!resolved && detailError) throw detailError;
    return resolved;
  }

  function openAssignment() {
    if (!selectedClaim) return;
    setError('');
    setNotice('');
    setAssignOpen(true);
  }

  function closeAssignment() {
    setAssignOpen(false);
  }

  /**
   * Record discovery for a `?record=` deep link that is not in the loaded queue.
   * The assumed-claims search projection resolves the id, then the canonical
   * claim read loads the record so the workbench can render it.
   */
  async function discoverRecord(recordId) {
    try {
      const body = await request(`/search?q=${encodeURIComponent(recordId)}&limit=25`);
      const items = searchItems(body);
      const match = items.find((item) => item.id === recordId)
        || items.find((item) => String(item.href || '').includes(recordId));
      if (!match?.id) return null;
      const existing = claimsRef.current.find((claim) => claim.id === match.id);
      if (existing) return existing;
      const claim = await request(`/claims/${encodeURIComponent(match.id)}`);
      return claim?.id ? rememberClaim(claim) : null;
    } catch {
      return null;
    }
  }

  function openRecord(claimId) {
    const claim = claimsRef.current.find((entry) => entry.id === claimId);
    if (!claim) return false;
    if (selectedIdRef.current === claim.id) return true;

    selectedIdRef.current = claim.id;
    setSelectedId(claim.id);
    setTab('overview');
    setError('');
    setNotice('');
    setStatusTarget('');
    setResources(EMPTY_RESOURCES);
    loadWorkspace(claim.id).catch((cause) => setError(cause.message));
    return true;
  }

  async function openRecordById(recordId) {
    if (!recordId) return false;
    if (openRecord(recordId)) return true;
    const discovered = await discoverRecord(recordId);
    return discovered ? openRecord(discovered.id) : false;
  }

  openRecordRef.current = openRecord;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  /**
   * The open-task count is operational summary data, so it is loaded one step
   * behind the selected claim and refreshed by the Diary & Notes tab whenever a
   * task is added, completed, or reopened. A failed count leaves the card at
   * an em dash instead of blocking the rest of the workbench.
   */
  useEffect(() => {
    let alive = true;
    if (!selectedId) {
      setSummary({ openTasks: null });
      return undefined;
    }

    setSummary({ openTasks: null });
    api.tasks.list(selectedId)
      .then((rows) => {
        if (alive) setSummary({ openTasks: countOpenTasks(rows) });
      })
      .catch(() => {
        if (alive) setSummary({ openTasks: null });
      });

    return () => {
      alive = false;
    };
  }, [selectedId, summaryNonce]);

  /**
   * Selecting a claim immediately reads its event-aggregate timeline. The
   * request lifecycle is keyed by selection, so a slow response for the
   * previous claim can never render under the next claim's header.
   */
  useEffect(() => {
    if (!selectedId) {
      activityRequestRef.current += 1;
      setActivity({ claimId: null, items: [], loading: false, error: '' });
      return undefined;
    }
    loadActivity(selectedId);
    return () => {
      activityRequestRef.current += 1;
    };
  }, [selectedId]);

  useEffect(() => {
    let alive = true;
    async function bootstrap() {
      try {
        const list = await loadClaims();
        if (!alive) return;
        const route = readRoute();
        let opened = false;
        if (route.record) {
          opened = await openRecordById(route.record);
        }
        if (!alive) return;
        if (!opened && list.length > 0) {
          opened = openRecord(list[0].id);
        }
        if (!opened && route.record) {
          setError(`The linked assumed claim ${route.record} could not be found on the ASSUMED book.`);
        }
        if (route.isNew) setRegisterOpen(true);
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
    const onPopState = () => {
      const route = readRoute();
      setRegisterOpen(route.isNew);
      if (route.record) {
        const current = claimsRef.current.find((claim) => claim.id === route.record);
        if (current) openRecordRef.current(current.id);
        else openRecordById(route.record).then((opened) => {
          if (!opened) {
            setError(`The linked assumed claim ${route.record} could not be found on the ASSUMED book.`);
          }
        }).catch(() => {});
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!registerOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !submitting) {
        setRegisterOpen(false);
        pushRoute({ isNew: false });
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [registerOpen, submitting]);

  useEffect(() => {
    if (!selectedContractId) {
      setRelatedRetrocessions([]);
      setRelatedLoading(false);
      return undefined;
    }
    let alive = true;
    setRelatedLoading(true);
    setRelatedRetrocessions([]);
    request(`/api/v1/retrocessions/search?q=${encodeURIComponent(selectedContractId)}&limit=5`)
      .then((body) => {
        if (alive) setRelatedRetrocessions(searchItems(body).filter(Boolean));
      })
      .catch(() => {
        if (alive) setRelatedRetrocessions([]);
      })
      .finally(() => {
        if (alive) setRelatedLoading(false);
      });
    return () => { alive = false; };
  }, [selectedContractId]);

  /**
   * Resolves the governing contract after the claim is already on screen, so the
   * cross-links can show "QS-2026-00042 · QUOTA_SHARE" instead of a bare UUID.
   * The lookup is an enhancement: while it is in flight, or if it fails, the
   * links fall back to the short contract id without blocking the workbench.
   */
  useEffect(() => {
    if (!selectedContractId) {
      setContractLookup({ contractId: null, contract: null });
      return undefined;
    }
    let alive = true;
    setContractLookup({ contractId: selectedContractId, contract: null });
    request(contractEndpoint(selectedContractId))
      .then((contract) => {
        if (alive) {
          setContractLookup({ contractId: selectedContractId, contract: contract || null });
        }
      })
      .catch(() => {
        if (alive) {
          setContractLookup({ contractId: selectedContractId, contract: null });
        }
      });
    return () => { alive = false; };
  }, [selectedContractId]);

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
      selectedIdRef.current = list[0].id;
      setSelectedId(list[0].id);
      setTab('overview');
      await loadWorkspace(list[0].id);
      return;
    }
    selectedIdRef.current = null;
    setSelectedId(null);
    setResources(EMPTY_RESOURCES);
  }

  async function refreshWorkspace() {
    setError('');
    setNotice('');
    try {
      await reloadClaimsAndWorkspace();
      refreshDiarySummary();
    } catch (cause) {
      setError(cause.message);
    }
  }

  function refreshDiarySummary() {
    setSummaryNonce((value) => value + 1);
  }

  function openRegister() {
    setClaimForm(EMPTY_CLAIM_FORM);
    setContractPick(null);
    setError('');
    setRegisterOpen(true);
    pushRoute({ isNew: true });
  }

  function closeRegister() {
    if (submitting) return;
    setRegisterOpen(false);
    setError('');
    pushRoute({ isNew: false });
  }

  async function submitClaim(event) {
    event.preventDefault();
    setError('');
    if (!claimForm.contractId) {
      setError('Select the assumed contract that governs this claim before registering it.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await request('/claims', {
        method: 'POST',
        body: JSON.stringify({
          ...claimForm,
          contractId: claimForm.contractId,
          cedentClaimNumber: claimForm.cedentClaimNumber || null,
          lossDate: claimForm.lossDate || null,
          reportDate: claimForm.reportDate || null,
          reserveAmount: claimForm.reserveAmount
        })
      });
      setClaimForm(EMPTY_CLAIM_FORM);
      setContractPick(null);
      setRegisterOpen(false);
      setQueueFilter('');
      const list = await loadClaims();
      if (created?.id) {
        const next = list.some((claim) => claim.id === created.id)
          ? list
          : [created, ...list];
        claimsRef.current = next;
        setClaims(next);
        selectedIdRef.current = created.id;
        setSelectedId(created.id);
        setTab('overview');
        await loadWorkspace(created.id);
        pushRoute({ record: created.id, isNew: false });
      } else {
        pushRoute({ isNew: false });
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSubmitting(false);
    }
  }

  function selectClaim(claim) {
    openRecord(claim.id);
    pushRoute({ record: claim.id, isNew: false });
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

  function followInternalLink(event, href) {
    if (!href) return;
    if (event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(href);
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
            <dt>Cedent reference</dt>
            <dd>{selectedClaim.cedentClaimNumber || '—'}</dd>
            <dt>Status</dt>
            <dd><StatusPill status={selectedClaim.status} /></dd>
            <dt>Assumed contract</dt>
            <dd>
              {contractHref ? (
                <a
                  href={contractHref}
                  className="eia-mono"
                  title={selectedClaim.contractId}
                  data-testid="contract-link-overview"
                  onClick={(event) => followInternalLink(event, contractHref)}
                >
                  {contractLabel}
                </a>
              ) : '—'}
            </dd>
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

        <div className="eia-context-panel" aria-label="Why this matters">
          <h4>Why this matters</h4>
          <p>
            The assumed contract is the governing instrument for this claim: its terms, limits, and
            conditions determine coverage and drive the cessions and recoveries recorded against the
            claim. Retrocession is administered separately, and SAP FS-RI remains the system of record
            for the actual reinsurance amounts, recoverables, and statements.
          </p>
          {contractHref && (
            <div className="links">
              <span className="eia-muted" style={{ fontSize: 11 }}>Open the assumed contract:</span>
              <a
                href={contractHref}
                title={selectedClaim.contractId}
                data-testid="contract-link-context"
                onClick={(event) => followInternalLink(event, contractHref)}
              >
                {contractLabel}
              </a>
            </div>
          )}
        </div>

        <div className="eia-context-panel" aria-label="Claim ownership" data-testid="ownership-note">
          <h4>Claim ownership</h4>
          <p>
            {ownershipNote(
              selectedClaim,
              selectedClaim.assignedAt ? formatTimestamp(selectedClaim.assignedAt) : ''
            )}
          </p>
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

        <div className="eia-section-title">
          <h2>Related records</h2>
          <span className="eia-muted">ASSUMED book context</span>
        </div>
        <div className="eia-card" aria-label="Related records">
          <dl className="eia-kv">
            <dt>Assumed contract</dt>
            <dd>
              {contractHref ? (
                <a
                  href={contractHref}
                  className="eia-mono"
                  title={selectedClaim.contractId}
                  data-testid="contract-link-related"
                  onClick={(event) => followInternalLink(event, contractHref)}
                >
                  {contractLabel}
                </a>
              ) : '—'}
            </dd>
            <dt>Cedent reference</dt>
            <dd>{selectedClaim.cedentClaimNumber || '—'}</dd>
          </dl>

          <div className="eia-section-title" style={{ margin: '14px 0 6px' }}>
            <h3 style={{ margin: 0 }}>Related retrocessions</h3>
            {relatedLoading && <span className="eia-muted">Loading…</span>}
          </div>
          {!relatedLoading && relatedRetrocessions.length === 0 && (
            <p className="eia-muted" style={{ margin: 0, fontSize: 12 }}>
              No retrocession records reference this contract yet.
            </p>
          )}
          {relatedRetrocessions.length > 0 && (
            <div className="eia-related-list">
              {relatedRetrocessions.map((retro) => {
                const href = retro.href || recordHref('retrocession', retro.id);
                return (
                  <a
                    key={retro.id || href}
                    className="eia-related-record"
                    href={href}
                    aria-label={`Open retrocession ${retro.label}`}
                    onClick={(event) => followInternalLink(event, href)}
                  >
                    <b>{retro.label}</b>
                    {retro.secondary && <span className="eia-related-meta">{retro.secondary}</span>}
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <DocumentsCard key={selectedClaim.id} claimId={selectedClaim.id} />
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
      case 'activity': return (
        <ActivityTab
          items={selectedActivity.items}
          loading={selectedActivity.loading}
          error={selectedActivity.error}
          onRefresh={() => loadActivity(selectedClaim.id)}
        />
      );
      case 'diary': return <DiaryNotesTab claim={selectedClaim} onChanged={refreshDiarySummary} />;
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

      {notice && !registerOpen && !assignOpen && (
        <p role="status" style={{ margin: '0 0 14px' }}>{notice}</p>
      )}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Assumed claim register">
          <div className="eia-record-list-head">
            <strong>Assumed claims</strong>
            <span className="eia-muted">
              {loading
                ? 'Loading…'
                : queueNeedle
                  ? `${filteredClaims.length} of ${claims.length}`
                  : `${claims.length} record${claims.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="eia-queue-search">
            <input
              type="search"
              value={queueFilter}
              onChange={(event) => setQueueFilter(event.target.value)}
              placeholder="Filter assumed claims by number, cedent reference, status, assignee, or team…"
              aria-label="Filter assumed claims by number, cedent reference, status, assignee, or team"
              autoComplete="off"
            />
            {queueFilter && (
              <button
                type="button"
                className="eia-queue-clear"
                onClick={() => setQueueFilter('')}
              >
                Clear
              </button>
            )}
          </div>
          {loading && <div className="empty">Loading assumed claims…</div>}
          {!loading && claims.length === 0 && (
            <div className="empty">No assumed claims recorded yet. Use Register assumed claim to create the first record.</div>
          )}
          {!loading && claims.length > 0 && filteredClaims.length === 0 && (
            <div className="eia-queue-empty">
              No assumed claims match “{queueFilter.trim()}”.
            </div>
          )}
          {!loading && filteredClaims.map((claim) => {
            const owner = assignmentText(claim);
            return (
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
                <span className="record-secondary" data-testid="queue-assignee">
                  {owner.assignedAdjuster ? `Assigned to ${owner.display}` : 'Unassigned'}
                </span>
                <span><StatusPill status={claim.status} /></span>
              </button>
            );
          })}
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
                    {' '}· Contract{' '}
                    {contractHref ? (
                      <a
                        href={contractHref}
                        className="eia-mono"
                        title={selectedClaim.contractId}
                        data-testid="contract-link-header"
                        onClick={(event) => followInternalLink(event, contractHref)}
                      >
                        {contractLabel}
                      </a>
                    ) : shortId(selectedClaim.contractId)}
                    {' '}· Version {selectedClaim.version}
                  </p>
                  <p className="eia-record-subtitle" data-testid="record-assignment">
                    {selectedAssignment.assignedAdjuster ? (
                      <>
                        Assigned to <strong>{selectedAssignment.assignedAdjuster}</strong>
                        {selectedAssignment.assignedTeam
                          ? ` · ${teamLabel(selectedAssignment.assignedTeam)}`
                          : ''}
                      </>
                    ) : (
                      'Unassigned'
                    )}
                  </p>
                </div>
                <div className="eia-actions">
                  <button type="button" className="eia-btn-secondary" onClick={openAssignment}>
                    Assign
                  </button>
                  <StatusPill status={selectedClaim.status} />
                </div>
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
                  <h3>Assigned to</h3>
                  <div className="value" data-testid="summary-assigned-to">
                    {selectedAssignment.assignedAdjuster || 'Unassigned'}
                  </div>
                  <div className="eia-metric-label">
                    {selectedAssignment.assignedAdjuster
                      ? (selectedAssignment.assignedTeam
                        ? teamLabel(selectedAssignment.assignedTeam)
                        : 'No team assigned')
                      : 'Ownership queue'}
                  </div>
                </div>
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
                <div className="eia-card">
                  <h3>Open tasks</h3>
                  <div className="value" data-testid="summary-open-tasks">
                    {summary.openTasks == null ? '—' : summary.openTasks}
                  </div>
                  <div className="eia-metric-label">Open diary items</div>
                </div>
              </div>

              {workspaceLoading && <p className="eia-muted" role="status">Loading workbench…</p>}

              <ClaimProgress claim={selectedClaim} resources={resources} />

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

      {assignOpen && selectedClaim && (
        <AssignmentDialog
          claim={selectedClaim}
          onClose={closeAssignment}
          onAssigned={handleAssigned}
          onReload={() => reloadClaimRecord(selectedClaim.id)}
        />
      )}

      {registerOpen && (
        <div
          style={MODAL_BACKDROP}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRegister();
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
                  Create the reinsurer claim record from a cedent notice. Pick the governing assumed
                  contract; the ASSUMED book scope is applied to every request.
                </p>
              </div>
              <button type="button" className="eia-btn-ghost" onClick={closeRegister} disabled={submitting}>
                Cancel
              </button>
            </div>

            {error && <p role="alert" style={{ margin: '10px 0 14px' }}>{error}</p>}

            <form aria-label="Register assumed claim" className="eia-form-grid" onSubmit={submitClaim}>
              <Field label="Assumed contract">
                <EntityPicker
                  endpoint="/api/v1/contracts/search"
                  book={BOOK}
                  value={claimForm.contractId}
                  valueLabel={contractPick?.label || claimForm.contractId}
                  onChange={(id, item) => {
                    setContractPick(item || null);
                    setClaimForm((current) => ({ ...current, contractId: id }));
                  }}
                  placeholder="Search contracts by number or type…"
                  disabled={submitting}
                />
                {contractPick && (
                  <span className="eia-contract-selection">
                    <span>
                      <strong>{contractPick.label}</strong>
                      {' · '}
                      {contractTypeOf(contractPick)}
                    </span>
                    <a
                      href={contractPick.href || recordHref('contract', contractPick.id)}
                      onClick={(event) => followInternalLink(
                        event,
                        contractPick.href || recordHref('contract', contractPick.id)
                      )}
                    >
                      Open contract
                    </a>
                  </span>
                )}
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
