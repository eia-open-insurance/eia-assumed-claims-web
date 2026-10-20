import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { Field } from './ui.jsx';

/** Teams that can own an ASSUMED claim. The codes are the API contract. */
export const ASSIGNMENT_TEAMS = [
  { value: 'ASSUMED_CLAIMS', label: 'Assumed claims' },
  { value: 'CEDED_RE', label: 'Ceded reinsurance' },
  { value: 'MAJOR_LOSS', label: 'Major loss' },
  { value: 'LITIGATION', label: 'Litigation' },
  { value: 'RECOVERY', label: 'Recovery' },
  { value: 'SUPERVISORY', label: 'Supervisory' }
];

/** The signed-in adjuster is not modelled by this remote yet. */
export const DEFAULT_ASSIGNEE = 'A. Adjuster';
export const DEFAULT_TEAM = ASSIGNMENT_TEAMS[0].value;

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(11, 46, 79, 0.52)'
};

const DIALOG_STYLE = {
  width: 'min(640px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

/** Readable label for a stored team code, falling back to the stored value. */
export function teamLabel(team) {
  if (!team) return '';
  const match = ASSIGNMENT_TEAMS.find((entry) => entry.value === team);
  return match ? match.label : team;
}

/**
 * Reads the current ownership from a claim projection. `assignedAdjuster` and
 * `assignedTeam` are the canonical domain fields.
 */
export function readAssignment(claim) {
  if (!claim) return { assignedAdjuster: '', assignedTeam: '' };
  return {
    assignedAdjuster: String(claim.assignedAdjuster || '').trim(),
    assignedTeam: String(claim.assignedTeam || '').trim()
  };
}

export function assignmentText(claim) {
  const { assignedAdjuster, assignedTeam } = readAssignment(claim);
  if (!assignedAdjuster) {
    return { assignedAdjuster: '', assignedTeam, display: 'Unassigned' };
  }
  return {
    assignedAdjuster,
    assignedTeam,
    display: assignedTeam ? `${assignedAdjuster} · ${teamLabel(assignedTeam)}` : assignedAdjuster
  };
}

/** Values the queue search matches in addition to the claim facts. */
export function assignmentFilterValues(claim) {
  const { assignedAdjuster, assignedTeam } = readAssignment(claim);
  return [
    assignedAdjuster,
    assignedTeam,
    assignedTeam ? teamLabel(assignedTeam) : '',
    assignedAdjuster ? '' : 'Unassigned'
  ].filter(Boolean);
}

/** The Overview ownership note explains who owns the claim and why it is audited. */
export function ownershipNote(claim, assignedAtLabel) {
  const { assignedAdjuster, assignedTeam } = readAssignment(claim);
  const base =
    'Reassignment is versioned, audited, and visible to everyone working the ASSUMED book.';
  if (!assignedAdjuster) {
    return `This claim is unassigned. It stays in the shared assumed claims queue until an adjuster and team take ownership. ${base}`;
  }
  const owner = assignedTeam
    ? `${assignedAdjuster} (${teamLabel(assignedTeam)})`
    : assignedAdjuster;
  const since = assignedAtLabel ? ` The current assignment was recorded ${assignedAtLabel}.` : '';
  return `${owner} owns this claim in the assumed claims queue.${since} ${base}`;
}

function initialForm(claim) {
  const current = readAssignment(claim);
  return {
    assignedAdjuster: current.assignedAdjuster || DEFAULT_ASSIGNEE,
    assignedTeam: current.assignedTeam || DEFAULT_TEAM
  };
}

function initialVersion(claim) {
  return Number.isInteger(claim?.version) ? claim.version : 0;
}

/**
 * Assignment is an operational ownership change only. The dialog sends the
 * expected claim version so the expert rejects a stale edit with 409 instead of
 * overwriting a concurrent reassignment.
 */
export default function AssignmentDialog({ claim, onClose, onAssigned, onReload }) {
  const [form, setForm] = useState(() => initialForm(claim));
  const [current, setCurrent] = useState(() => readAssignment(claim));
  const [expectedVersion, setExpectedVersion] = useState(() => initialVersion(claim));
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy && !reloading) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, reloading, onClose]);

  const update = (field) => (event) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
  };

  async function submit(event) {
    event.preventDefault();
    const assignedAdjuster = form.assignedAdjuster.trim();
    if (!assignedAdjuster) {
      setError('Enter the adjuster name or email before assigning the claim.');
      return;
    }

    setBusy(true);
    setError('');
    setStatus('');
    setStale(false);
    try {
      const assignment = { assignedAdjuster, assignedTeam: form.assignedTeam };
      const updated = await api.claims.assign(
        claim.id,
        { ...assignment, expectedVersion },
        DEFAULT_ASSIGNEE
      );
      await onAssigned(updated, assignment);
    } catch (cause) {
      if (cause.status === 409) {
        setStale(true);
        setError(
          `This claim changed since the assignment form was opened${
            cause.message ? ` (${cause.message})` : ''
          }. Reload the claim for the latest version, then assign again.`
        );
      } else {
        setError(cause.message || 'The assignment could not be saved.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setReloading(true);
    setError('');
    setStatus('');
    try {
      const fresh = await onReload();
      const next = readAssignment(fresh || claim);
      setCurrent(next);
      setExpectedVersion(initialVersion(fresh || claim));
      setStale(false);
      setStatus(
        `Claim reloaded${
          fresh && Number.isInteger(fresh.version) ? ` at version ${fresh.version}` : ''
        }. Review the assignment and submit again.`
      );
    } catch (cause) {
      setError(cause.message || 'The claim could not be reloaded.');
    } finally {
      setReloading(false);
    }
  }

  const currentLabel = current.assignedAdjuster
    ? `${current.assignedAdjuster}${current.assignedTeam ? ` · ${teamLabel(current.assignedTeam)}` : ''}`
    : 'Unassigned';

  return (
    <div
      style={OVERLAY_STYLE}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy && !reloading) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="assignment-title"
        className="eia-card"
        style={DIALOG_STYLE}
        data-testid="assignment-dialog"
      >
        <div className="eia-record-title">
          <div>
            <h2 id="assignment-title" style={{ margin: 0 }}>Assign claim</h2>
            <p className="eia-record-subtitle" data-testid="assignment-current">
              {claim.assumedClaimNumber} · Current owner {currentLabel}
            </p>
          </div>
          <button type="button" className="eia-btn-ghost" onClick={onClose} disabled={busy || reloading}>
            Close
          </button>
        </div>

        <form className="eia-form-grid" onSubmit={submit} style={{ marginTop: 16 }} aria-label="Assign claim">
          <Field label="Assigned adjuster (name or email)" className="span-2">
            <input
              id="assignedAdjuster"
              value={form.assignedAdjuster}
              onChange={update('assignedAdjuster')}
              required
              maxLength={120}
              placeholder="e.g. A. Adjuster or adjuster@example.com"
              autoComplete="off"
              autoFocus
              disabled={busy || reloading}
              data-testid="assignment-assigned-adjuster"
            />
          </Field>
          <Field label="Team">
            <select
              id="assignedTeam"
              value={form.assignedTeam}
              onChange={update('assignedTeam')}
              disabled={busy || reloading}
              data-testid="assignment-assigned-team"
            >
              {ASSIGNMENT_TEAMS.map((team) => (
                <option key={team.value} value={team.value}>
                  {team.label}
                </option>
              ))}
            </select>
          </Field>

          <p className="eia-muted span-3" data-testid="assignment-version" style={{ margin: 0, fontSize: 11 }}>
            Claim version {expectedVersion} is sent with this assignment so a concurrent change is
            rejected instead of overwritten.
          </p>

          <div className="span-3">
            <div className="eia-context-panel" data-testid="assignment-context">
              <h4>Why this matters</h4>
              <p>
                Ownership determines the queue and workload that carry this claim. It does not change
                coverage, ceded reserves, cash calls, recoveries, or any other financial data.
              </p>
            </div>
          </div>

          {status && (
            <p className="span-3" role="status" style={{ margin: '4px 0 0' }} data-testid="assignment-status">
              {status}
            </p>
          )}

          {error && (
            <div className="span-3" data-testid={stale ? 'assignment-stale' : 'assignment-error'}>
              <p role="alert" style={{ margin: '4px 0 0' }}>{error}</p>
              {stale && (
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={reload}
                  disabled={reloading}
                  style={{ marginTop: 8 }}
                >
                  {reloading ? 'Reloading…' : 'Reload claim'}
                </button>
              )}
            </div>
          )}

          <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="eia-btn-secondary" onClick={onClose} disabled={busy || reloading}>
              Cancel
            </button>
            <button type="submit" disabled={busy || reloading}>
              {busy ? 'Assigning…' : 'Assign claim'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
