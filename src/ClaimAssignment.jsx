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

/** Static team options are the offline fallback when the directory is down. */
const STATIC_TEAM_OPTIONS = ASSIGNMENT_TEAMS.map(({ value, label }) => ({ code: value, label }));

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

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function personKey(value) {
  return String(value || '').trim().toLowerCase();
}

/** Readable label for a stored team code, falling back to the stored value. */
export function teamLabel(team) {
  if (!team) return '';
  const match = ASSIGNMENT_TEAMS.find((entry) => entry.value === team);
  return match ? match.label : team;
}

/**
 * Reads the current ownership from a claim projection. `assignedAdjuster` and
 * `assignedTeam` are the canonical domain fields; the aliases keep the
 * workbench readable if a hand-off payload uses another shape.
 */
export function readAssignment(claim) {
  if (!claim) return { assignedAdjuster: '', assignedTeam: '' };
  return {
    assignedAdjuster: firstText(
      claim.assignedAdjuster,
      claim.assignedTo,
      claim.assignee,
      claim.assigneeName
    ),
    assignedTeam: firstText(claim.assignedTeam, claim.team, claim.assignmentTeam)
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

function peopleIn(directory) {
  return Array.isArray(directory?.people) ? directory.people : [];
}

function allTeamOptions(directory) {
  const teams = Array.isArray(directory?.teams) ? directory.teams : [];
  return teams.length > 0 ? teams : STATIC_TEAM_OPTIONS;
}

function findPerson(people, displayName) {
  const target = personKey(displayName);
  if (!target) return null;
  return people.find((person) => personKey(person.displayName) === target
    || personKey(person.email) === target) || null;
}

function defaultPerson(people) {
  return findPerson(people, DEFAULT_ASSIGNEE) || people[0] || null;
}

/**
 * A person's own teams when the directory knows them, otherwise every team so
 * the dialog never becomes unusable just because the directory has no routing
 * data for that person.
 */
function teamOptionsFor(person, teams) {
  if (!person) return teams;
  const byCode = new Map(teams.map((team) => [team.code, team]));
  const options = [];
  for (const code of person.teams || []) {
    const team = byCode.get(code);
    if (team && !options.includes(team)) options.push(team);
  }
  return options.length > 0 ? options : teams;
}

function chooseTeam(currentTeam, options, fallbackTeam) {
  if (currentTeam && options.some((team) => team.code === currentTeam)) return currentTeam;
  if (fallbackTeam && options.some((team) => team.code === fallbackTeam)) return fallbackTeam;
  return options[0]?.code || currentTeam || DEFAULT_TEAM;
}

function initialForm(claim, directory) {
  const current = readAssignment(claim);
  const people = peopleIn(directory);
  const teams = allTeamOptions(directory);
  const person = findPerson(people, current.assignedAdjuster) || defaultPerson(people);
  const options = teamOptionsFor(person, teams);
  return {
    assignedAdjuster: person ? person.displayName : current.assignedAdjuster || DEFAULT_ASSIGNEE,
    assignedTeam: chooseTeam(current.assignedTeam, options)
  };
}

function initialVersion(claim) {
  return Number.isInteger(claim?.version) ? claim.version : 0;
}

function personLabel(person) {
  return person.role ? `${person.displayName} — ${person.role}` : person.displayName;
}

/**
 * Assignment is an operational ownership change only. The dialog sends the
 * expected claim version so the expert rejects a stale edit with 409 instead of
 * overwriting a concurrent reassignment.
 */
export default function AssignmentDialog({
  claim,
  directory = null,
  directoryStatus = 'loading',
  onClose,
  onAssigned,
  onReload
}) {
  const [form, setForm] = useState(() => initialForm(claim, directory));
  const [current, setCurrent] = useState(() => readAssignment(claim));
  const [expectedVersion, setExpectedVersion] = useState(() => initialVersion(claim));
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState('');

  const people = peopleIn(directory);
  const teams = allTeamOptions(directory);
  const usesDirectory = people.length > 0;
  const selectedPerson = usesDirectory ? findPerson(people, form.assignedAdjuster) : null;
  const teamOptions = teamOptionsFor(selectedPerson, teams);

  /**
   * The app starts the directory request with the claim queue, so the dialog can
   * open before it settles. Reconcile the form once the data arrives, keeping a
   * matching current owner and any team that is still valid for that person.
   */
  useEffect(() => {
    if (people.length === 0) return;
    setForm((previous) => {
      const person = findPerson(people, previous.assignedAdjuster) || defaultPerson(people);
      if (!person) return previous;
      const options = teamOptionsFor(person, teams);
      const assignedTeam = chooseTeam(previous.assignedTeam, options);
      if (person.displayName === previous.assignedAdjuster && assignedTeam === previous.assignedTeam) {
        return previous;
      }
      return { assignedAdjuster: person.displayName, assignedTeam };
    });
  }, [directory]);

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

  function updateAdjuster(event) {
    const assignedAdjuster = event.target.value;
    const person = findPerson(people, assignedAdjuster);
    setForm((previous) => {
      const options = teamOptionsFor(person, teams);
      return {
        assignedAdjuster,
        assignedTeam: chooseTeam(previous.assignedTeam, options)
      };
    });
  }

  /** One-line role/email hint under the selected person. */
  const personHint = selectedPerson
    ? [selectedPerson.role, selectedPerson.email].filter(Boolean).join(' · ')
    : '';

  const fallbackNote =
    directoryStatus === 'error'
      ? 'Directory unavailable — enter the adjuster manually. Standard assignment teams are shown.'
      : directoryStatus === 'ready' && people.length === 0
        ? 'The directory returned no people — enter the adjuster manually. Standard assignment teams are shown.'
        : directoryStatus === 'loading'
          ? 'Loading the directory… you can enter the adjuster manually.'
          : '';

  async function submit(event) {
    event.preventDefault();
    const assignedAdjuster = form.assignedAdjuster.trim();
    if (!assignedAdjuster) {
      setError(
        usesDirectory
          ? 'Select an adjuster before assigning the claim.'
          : 'Enter the adjuster name or email before assigning the claim.'
      );
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
          <Field label="Assigned adjuster" className="span-2">
            {usesDirectory ? (
              <>
                <select
                  id="assignedAdjuster"
                  value={form.assignedAdjuster}
                  onChange={updateAdjuster}
                  required
                  autoFocus
                  disabled={busy || reloading}
                  aria-describedby={personHint ? 'assignment-adjuster-hint' : undefined}
                  data-testid="assignment-assigned-adjuster"
                >
                  {people.map((person) => (
                    <option key={person.id} value={person.displayName}>
                      {personLabel(person)}
                    </option>
                  ))}
                </select>
                {personHint && (
                  <span
                    id="assignment-adjuster-hint"
                    className="eia-picker-hint"
                    data-testid="assignment-adjuster-hint"
                  >
                    {selectedPerson.role && (
                      <span data-testid="assignment-adjuster-role">{selectedPerson.role}</span>
                    )}
                    {selectedPerson.role && selectedPerson.email ? ' · ' : null}
                    {selectedPerson.email && (
                      <span data-testid="assignment-adjuster-email">{selectedPerson.email}</span>
                    )}
                  </span>
                )}
              </>
            ) : (
              <>
                <input
                  id="assignedAdjuster"
                  value={form.assignedAdjuster}
                  onChange={update('assignedAdjuster')}
                  required
                  maxLength={160}
                  placeholder="e.g. A. Adjuster or adjuster@example.com"
                  autoComplete="off"
                  autoFocus
                  disabled={busy || reloading}
                  data-testid="assignment-assigned-adjuster"
                />
                {fallbackNote && (
                  <span
                    className="eia-picker-hint"
                    data-testid="assignment-directory-fallback"
                    role="note"
                  >
                    {fallbackNote}
                  </span>
                )}
              </>
            )}
          </Field>
          <Field label="Team">
            <select
              id="assignedTeam"
              value={form.assignedTeam}
              onChange={update('assignedTeam')}
              required
              disabled={busy || reloading}
              data-testid="assignment-assigned-team"
            >
              {teamOptions.map((team) => (
                <option key={team.code} value={team.code}>
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
