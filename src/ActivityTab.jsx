import React from 'react';
import { teamLabel } from './ClaimAssignment.jsx';
import { humanize, Panel } from './ui.jsx';

/** The activity card reads one bounded page of the claim's inbox events. */
export const ACTIVITY_LIMIT = 50;

/**
 * Human labels for the Assumed Claims event names published today. The raw
 * event type is always shown in mono beside the label, so an unmapped name
 * still gives the reader the exact contract name.
 */
export const EVENT_LABELS = {
  'assumed.claim.registered': 'Claim registered',
  'assumed.claim.updated': 'Claim updated',
  'assumed.claim.closed': 'Claim closed',
  'assumed.claim.reopened': 'Claim reopened',
  'assumed.claim.assigned': 'Claim assigned',
  'assumed.claim.loss-advice-posted': 'Loss advice posted',
  'assumed.claim.reserve-changed': 'Reserve changed',
  'assumed.claim.cash-call-requested': 'Cash call requested',
  'assumed.claim.recovery-recorded': 'Recovery recorded',
  'assumed.claim.commuted': 'Claim commuted',
  'assumed.claim.task-created': 'Diary task created',
  'assumed.claim.task-completed': 'Diary task completed',
  'assumed.claim.task-updated': 'Diary task updated',
  'assumed.claim.note-added': 'Note added'
};

const WORD_SEPARATOR = /[._\-\s]+/;

/**
 * `assumed.claim.registered` -> `Claim registered`; unmapped names degrade to
 * a readable sentence instead of hiding the event. The vertical prefix is
 * dropped because every event on this timeline is an assumed-claims event.
 */
export function readableEventType(eventType) {
  const type = String(eventType || '').trim();
  if (!type) return 'Unknown event';
  if (EVENT_LABELS[type]) return EVENT_LABELS[type];

  const words = type.split(WORD_SEPARATOR).map((word) => word.trim()).filter(Boolean);
  if (words.length > 1 && words[0].toLowerCase() === 'assumed') words.shift();
  if (words.length === 0) return type;

  const deduped = [];
  for (const word of words) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.toLowerCase() === word.toLowerCase()) continue;
    deduped.push(word.toLowerCase());
  }

  const label = deduped.join(' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const FAILED_EVENT_STATUSES = ['FAILED', 'DEAD_LETTERED', 'DEAD_LETTER', 'REJECTED', 'ERROR'];
const PROCESSED_EVENT_STATUSES = ['PROCESSED', 'APPLIED', 'ACCEPTED', 'COMPLETE', 'COMPLETED', 'DELIVERED'];
const PENDING_EVENT_STATUSES = ['RECEIVED', 'PENDING', 'IN_PROGRESS', 'RETRY', 'RETRYING', 'HELD', 'QUARANTINED'];

/** Inbox lifecycle tone: processed is settled, failed is red, received is pending. */
export function eventStatusTone(status) {
  const value = String(status || '').toUpperCase();
  if (FAILED_EVENT_STATUSES.includes(value)) return 'red';
  if (PROCESSED_EVENT_STATUSES.includes(value)) return 'green';
  if (PENDING_EVENT_STATUSES.includes(value)) return 'amber';
  return 'blue';
}

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short'
});

/** Event time is rendered in UTC so the timeline is stable across machines. */
export function formatEventTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return TIMESTAMP_FORMAT.format(date);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * The inbox exposes `payload` as the canonical event envelope. Tests and
 * future projections may also send it as raw JSON text or as the payload
 * object itself, so all three shapes are accepted.
 */
export function readEventPayload(event) {
  let payload = event?.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return asObject(payload);
}

/**
 * Event business facts live in the envelope's `data` object. Merging the
 * envelope and its data keeps both projection shapes readable; `data` wins on
 * a shared field name because that is the event's own fact.
 */
export function eventData(event) {
  const payload = readEventPayload(event);
  if (!payload) return {};
  const data = asObject(payload.data);
  return data ? { ...payload, ...data } : payload;
}

function firstText(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function moneyText(amount, currency) {
  const numeric = Number(amount);
  const code = String(currency || 'USD').toUpperCase();
  if (!Number.isFinite(numeric)) return `${amount}${code ? ` ${code}` : ''}`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(numeric);
  } catch {
    return `${amount} ${code}`;
  }
}

function excerpt(value, max = 120) {
  const body = String(value || '').replace(/\s+/g, ' ').trim();
  if (!body) return '';
  return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}

/**
 * The compact, claim-readable facts a handler needs from the event payload:
 * status, version, reserve movement, advice, cash call, recovery,
 * commutation, the affected task or note, and ownership. Facts the event does
 * not carry are omitted rather than rendered as blanks.
 */
export function payloadFacts(event, fallbackCurrency = 'USD') {
  const data = eventData(event);
  const eventType = String(event?.eventType || '');
  const currency = firstText(data, ['currency', 'reserveCurrency']) || fallbackCurrency || 'USD';
  const facts = [];
  const push = (key, label, value) => {
    const text = String(value ?? '').trim();
    if (text) facts.push({ key, label, value: text });
  };

  const isTask = Boolean(firstText(data, ['taskId', 'taskNumber'])) || /task/i.test(eventType);
  const isNote = Boolean(firstText(data, ['noteId', 'noteNumber'])) || /note/i.test(eventType);

  const from = firstText(data, ['from', 'previousStatus', 'oldStatus']);
  const to = firstText(data, ['to', 'newStatus']);
  const claimStatus = firstText(data, ['claimStatus']);
  if (from && to) {
    push('status', 'Status', `${from} → ${to}`);
  } else if (from) {
    push('status', 'Status', `${from} →`);
  } else if (claimStatus) {
    push('status', 'Status', claimStatus);
  } else if (to) {
    push('status', 'Status', to);
  } else if (!isTask && !isNote) {
    push('status', 'Status', firstText(data, ['status']));
  }

  const version = firstText(data, ['version']);
  if (version) push('version', 'Version', version);

  const assignedAdjuster = firstText(data, ['assignedAdjuster']);
  const assignedTeam = firstText(data, ['assignedTeam']);
  if (assignedAdjuster || assignedTeam || firstText(data, ['assignedAt'])) {
    const previous = firstText(data, ['previousAssignedAdjuster']);
    const owner = [
      assignedAdjuster || 'Unassigned',
      assignedTeam ? teamLabel(assignedTeam) : ''
    ].filter(Boolean).join(' · ');
    push(
      'assignment',
      'Assigned to',
      previous && assignedAdjuster && previous !== assignedAdjuster ? `${previous} → ${owner}` : owner
    );
    push('assignedBy', 'Assigned by', firstText(data, ['assignedBy']));
  }

  const adviceNumber = firstText(data, ['adviceNumber']);
  if (adviceNumber || firstText(data, ['adviceId'])) {
    const adviceType = firstText(data, ['adviceType']);
    const adviceStatus = firstText(data, ['adviceStatus']);
    push(
      'advice',
      'Advice',
      [
        adviceNumber || 'Loss advice',
        adviceType ? humanize(adviceType) : '',
        adviceStatus
      ].filter(Boolean).join(' · ')
    );
    const reportedAmount = firstText(data, ['reportedAmount']);
    if (reportedAmount) push('adviceReported', 'Reported', moneyText(reportedAmount, currency));
    const cededAmount = firstText(data, ['cededAmount']);
    if (cededAmount) push('adviceCeded', 'Ceded', moneyText(cededAmount, currency));
  }

  const requestNumber = firstText(data, ['requestNumber']);
  if (requestNumber || firstText(data, ['cashCallId'])) {
    const cashCallStatus = firstText(data, ['cashCallStatus']);
    const reason = firstText(data, ['reason']);
    push(
      'cashCall',
      'Cash call',
      [
        requestNumber || 'Cash call',
        cashCallStatus,
        reason ? humanize(reason) : ''
      ].filter(Boolean).join(' · ')
    );
    const requestedAmount = firstText(data, ['requestedAmount']);
    if (requestedAmount) push('cashCallAmount', 'Requested', moneyText(requestedAmount, currency));
  }

  const recoveryType = firstText(data, ['recoveryType']);
  if (recoveryType || firstText(data, ['recoveryId'])) {
    push(
      'recovery',
      'Recovery',
      [recoveryType ? humanize(recoveryType) : '', firstText(data, ['recoveryStatus'])]
        .filter(Boolean)
        .join(' · ')
    );
    const amount = firstText(data, ['amount']);
    if (amount) push('recoveryAmount', 'Recovered', moneyText(amount, currency));
  }

  const commutationNumber = firstText(data, ['commutationNumber']);
  if (commutationNumber || firstText(data, ['commutationId'])) {
    push(
      'commutation',
      'Commutation',
      [commutationNumber || 'Commutation', firstText(data, ['commutationStatus'])]
        .filter(Boolean)
        .join(' · ')
    );
    const acceptedAmount = firstText(data, ['acceptedAmount']);
    if (acceptedAmount) {
      push('commutationAccepted', 'Accepted', moneyText(acceptedAmount, currency));
    } else {
      const offerAmount = firstText(data, ['offerAmount']);
      if (offerAmount) push('commutationOffer', 'Offer', moneyText(offerAmount, currency));
    }
  }

  const reserveAmount = firstText(data, ['reserveAmount']);
  const previousReserve = firstText(data, ['previousReserveAmount']);
  if (reserveAmount || previousReserve) {
    const value = reserveAmount && previousReserve && previousReserve !== reserveAmount
      ? `${moneyText(previousReserve, currency)} → ${moneyText(reserveAmount, currency)}`
      : moneyText(reserveAmount || previousReserve, currency);
    push('reserve', 'Reserve', value);
  }
  push('reserveComponent', 'Component', firstText(data, ['component'])
    ? humanize(firstText(data, ['component']))
    : '');
  push('reserveReason', 'Reason', firstText(data, ['reasonCode'])
    ? humanize(firstText(data, ['reasonCode']))
    : '');

  if (isTask) {
    const taskNumber = firstText(data, ['taskNumber']);
    const title = firstText(data, ['title']);
    push('task', 'Task', [taskNumber, title].filter(Boolean).join(' · '));
    const taskStatus = firstText(data, ['status']);
    const priority = firstText(data, ['priority']);
    push('taskStatus', 'Task status', [taskStatus, priority].filter(Boolean).join(' · '));
  } else if (isNote) {
    const noteNumber = firstText(data, ['noteNumber']);
    const noteType = firstText(data, ['noteType']);
    const body = excerpt(firstText(data, ['body']));
    push(
      'note',
      'Note',
      [noteNumber, noteType ? humanize(noteType) : '', body].filter(Boolean).join(' · ')
    );
    push('noteAuthor', 'Author', firstText(data, ['author']));
  }

  return facts;
}

function eventTime(event) {
  const occurred = Date.parse(event?.occurredAt);
  if (!Number.isNaN(occurred)) return occurred;
  const received = Date.parse(event?.receivedAt);
  return Number.isNaN(received) ? 0 : received;
}

/**
 * Newest first, independent of the order the page arrives in. Aggregate
 * version and event id keep same-instant events deterministic across reloads.
 */
export function sortActivityItems(items) {
  return [...items].sort((left, right) => {
    const byTime = eventTime(right) - eventTime(left);
    if (byTime !== 0) return byTime;
    const byVersion = (Number(right?.aggregateVersion) || 0) - (Number(left?.aggregateVersion) || 0);
    if (byVersion !== 0) return byVersion;
    return String(left?.eventId || '').localeCompare(String(right?.eventId || ''));
  });
}

/** The aggregate endpoint returns `{aggregateId, limit, items}`; tolerate a bare array. */
export function activityItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

function ActivityItem({ event }) {
  const eventType = event?.eventType || 'unknown';
  const status = event?.status || 'UNKNOWN';
  const facts = payloadFacts(event);
  const eventVersion = event?.eventVersion;
  const aggregateVersion = event?.aggregateVersion;

  return (
    <li
      className="eia-timeline-item"
      data-testid="activity-item"
    >
      <div className="eia-timeline-head eia-activity-head">
        <time
          className="eia-activity-time"
          data-testid="activity-time"
          dateTime={event?.occurredAt || undefined}
          title={event?.occurredAt || undefined}
        >
          {formatEventTimestamp(event?.occurredAt)}
        </time>
        <strong
          className="eia-activity-label"
          data-testid="activity-label"
          title={eventType}
        >
          {readableEventType(eventType)}
        </strong>
        <span className={`eia-pill ${eventStatusTone(status)}`} data-testid="activity-status">
          {status}
        </span>
        <span
          className="eia-mono eia-activity-version"
          data-testid="activity-version"
          title="Event schema version"
        >
          v{eventVersion === null || eventVersion === undefined ? '—' : eventVersion}
        </span>
      </div>

      {facts.length > 0 && (
        <ul className="eia-activity-facts" data-testid="activity-facts" aria-label="Event payload summary">
          {facts.map((fact) => (
            <li
              key={fact.key}
              className="eia-activity-fact"
              data-testid={`activity-fact-${fact.key}`}
            >
              <span className="eia-activity-fact-label">{fact.label}</span>
              <span>{fact.value}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="eia-activity-raw">
        <span className="eia-mono" data-testid="activity-raw-type">{eventType}</span>
        {aggregateVersion !== null && aggregateVersion !== undefined && (
          <span className="eia-mono" data-testid="activity-aggregate-version">
            {' · '}aggregate v{aggregateVersion}
          </span>
        )}
      </p>
    </li>
  );
}

export default function ActivityTab({ items = [], loading = false, error = '', onRefresh }) {
  const countLabel = loading
    ? '…'
    : error
      ? 'Activity unavailable'
      : `${items.length} event${items.length === 1 ? '' : 's'}`;

  return (
    <>
      <Panel title="Activity timeline">
        <div className="eia-toolbar" style={{ marginBottom: 4 }}>
          <span className="eia-muted" data-testid="activity-count">{countLabel}</span>
          <span className="spacer" />
          <button
            type="button"
            className="eia-btn-secondary"
            data-testid="activity-refresh"
            aria-label="Refresh activity timeline"
            onClick={() => {
              if (onRefresh) onRefresh();
            }}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <p
          className="eia-muted"
          data-testid="activity-context-note"
          style={{ margin: '0 0 4px', fontSize: 12 }}
        >
          Event-derived timeline: entries come from the platform event inbox, are append-only, and
          are never edited or removed. The assumed claim record remains the source of truth for
          status, reserves, advice, cash calls, recoveries, commutations, tasks, notes, and
          assignment.
        </p>

        {loading && (
          <p className="eia-muted" data-testid="activity-loading" role="status" style={{ margin: '12px 0 0' }}>
            Loading claim activity…
          </p>
        )}

        {!loading && error && (
          <p role="alert" data-testid="activity-error" style={{ margin: '8px 0 0' }}>
            Claim activity could not be loaded: {error} The claim record is unaffected.
          </p>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="eia-empty" data-testid="activity-empty" style={{ marginTop: 12 }}>
            <p style={{ marginTop: 0 }}>No events have been received for this claim yet.</p>
            <p style={{ marginTop: 0 }}>
              Events appear here after the platform event inbox delivers them. The assumed claim
              record remains the source of truth.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <ol
            className="eia-timeline"
            data-testid="activity-timeline"
            aria-label="Claim activity timeline"
          >
            {items.map((event, index) => (
              <ActivityItem
                key={event?.eventId || `${event?.eventType || 'event'}-${index}`}
                event={event}
              />
            ))}
          </ol>
        )}
      </Panel>

      <section
        className="eia-context-panel"
        aria-label="About the claim activity timeline"
        data-testid="activity-context"
      >
        <h4>About this timeline</h4>
        <p>
          Activity is derived from the platform event inbox, not from the claim tables. The assumed
          claim record remains the source of truth for status, reserves, advice, cash calls,
          recoveries, commutations, tasks, notes, and assignment. This timeline is a read-only
          projection that can lag behind, or miss, a delivery; events are append-only and are never
          edited or deleted on this screen.
        </p>
      </section>
    </>
  );
}
