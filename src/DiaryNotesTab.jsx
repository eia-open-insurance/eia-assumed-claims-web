import React, { useEffect, useState } from 'react';
import { api, today } from './api.js';
import { DataTable, ErrorText, Field, Panel, shortId } from './ui.jsx';

const EMPTY_TASK = {
  title: '',
  description: '',
  dueDate: '',
  priority: 'NORMAL',
  assignedTo: ''
};

const EMPTY_NOTE = {
  noteType: 'GENERAL',
  author: '',
  body: ''
};

const TASK_PRIORITIES = [
  ['LOW', 'Low'],
  ['NORMAL', 'Normal'],
  ['HIGH', 'High'],
  ['URGENT', 'Urgent']
];

const NOTE_TYPES = [
  ['GENERAL', 'General'],
  ['DIARY', 'Diary'],
  ['COVERAGE', 'Coverage'],
  ['RESERVE', 'Reserve'],
  ['LITIGATION', 'Litigation'],
  ['SETTLEMENT', 'Settlement']
];

const COMPLETED_TASK_STATUSES = ['COMPLETE', 'CANCELLED'];

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
  width: 'min(720px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

function upper(value) {
  return String(value || '').toUpperCase();
}

function isOverdue(task) {
  if (!task?.dueDate) return false;
  if (COMPLETED_TASK_STATUSES.includes(upper(task.status))) return false;
  return String(task.dueDate).slice(0, 10) < today();
}

function taskTone(task) {
  if (isOverdue(task)) return 'red';
  const status = upper(task.status);
  if (status === 'COMPLETE') return 'green';
  if (status === 'CANCELLED') return 'amber';
  return 'blue';
}

function priorityTone(priority) {
  const value = upper(priority);
  if (value === 'URGENT') return 'red';
  if (value === 'HIGH') return 'amber';
  return 'blue';
}

function noteTone(noteType) {
  switch (upper(noteType)) {
    case 'COVERAGE':
      return 'direct';
    case 'RESERVE':
    case 'SETTLEMENT':
      return 'warn';
    case 'DIARY':
      return 'ok';
    default:
      return 'direct';
  }
}

function sortNotes(rows) {
  return [...rows].sort((left, right) =>
    String(right?.createdAt || '').localeCompare(String(left?.createdAt || ''))
  );
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * A conflict means the task changed underneath this screen. The server message
 * is kept and a recovery hint is appended so a handler knows to reload.
 */
function describeError(cause) {
  const message = cause?.message || 'The request failed.';
  if (cause?.status === 409) {
    return `${message} The task changed since this list was loaded; reload the diary and try again.`;
  }
  return message;
}

function noteFallback(payload) {
  return {
    id: `local-note-${Date.now()}`,
    noteNumber: '—',
    noteType: payload.noteType,
    body: payload.body,
    author: payload.author,
    createdAt: new Date().toISOString()
  };
}

export default function DiaryNotesTab({ claim, onChanged }) {
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [taskOpen, setTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);
  const [taskError, setTaskError] = useState('');
  const [taskSubmitting, setTaskSubmitting] = useState(false);

  const [noteForm, setNoteForm] = useState(EMPTY_NOTE);
  const [noteError, setNoteError] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  async function load() {
    const [taskRows, noteRows] = await Promise.all([
      api.tasks.list(claim.id),
      api.notes.list(claim.id)
    ]);
    setTasks(Array.isArray(taskRows) ? taskRows : []);
    setNotes(Array.isArray(noteRows) ? sortNotes(noteRows) : []);
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    load()
      .then(() => {
        if (alive) setLoading(false);
      })
      .catch((cause) => {
        if (!alive) return;
        setError(cause.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [claim.id]);

  useEffect(() => {
    if (!taskOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !taskSubmitting) {
        setTaskOpen(false);
        setTaskError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [taskOpen, taskSubmitting]);

  function updateTaskField(field) {
    return (event) => setTaskForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function updateNoteField(field) {
    return (event) => setNoteForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function openTaskModal() {
    setTaskForm({ ...EMPTY_TASK, dueDate: today() });
    setTaskError('');
    setTaskOpen(true);
  }

  function closeTaskModal() {
    if (taskSubmitting) return;
    setTaskOpen(false);
    setTaskError('');
  }

  async function refreshTasks() {
    const rows = await api.tasks.list(claim.id);
    setTasks(Array.isArray(rows) ? rows : []);
  }

  async function reload() {
    setLoading(true);
    setError('');
    try {
      await load();
      if (onChanged) await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }

  async function submitTask(event) {
    event.preventDefault();
    setTaskError('');
    if (!taskForm.title.trim()) {
      setTaskError('Task title is required.');
      return;
    }
    if (!taskForm.dueDate) {
      setTaskError('A due date is required for a diary task.');
      return;
    }

    setTaskSubmitting(true);
    try {
      await api.tasks.create(claim.id, {
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || null,
        dueDate: taskForm.dueDate,
        priority: taskForm.priority,
        assignedTo: taskForm.assignedTo.trim() || null
      });
    } catch (cause) {
      setTaskError(describeError(cause));
      setTaskSubmitting(false);
      return;
    }

    setTaskOpen(false);
    setTaskForm(EMPTY_TASK);
    try {
      await refreshTasks();
      if (onChanged) await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setTaskSubmitting(false);
    }
  }

  async function toggleTask(task) {
    const status = upper(task.status) === 'COMPLETE' ? 'OPEN' : 'COMPLETE';
    setBusyId(task.id);
    setError('');
    try {
      await api.tasks.update(claim.id, task.id, { status, version: task.version });
      await refreshTasks();
      if (onChanged) await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function submitNote(event) {
    event.preventDefault();
    setNoteError('');
    if (!noteForm.body.trim()) {
      setNoteError('Enter the note body before adding it to the record.');
      return;
    }
    if (!noteForm.author.trim()) {
      setNoteError('Enter the author of the note.');
      return;
    }

    setNoteSubmitting(true);
    try {
      const payload = {
        noteType: noteForm.noteType,
        author: noteForm.author.trim(),
        body: noteForm.body.trim()
      };
      const created = await api.notes.create(claim.id, payload);
      const note = created && typeof created === 'object' ? created : noteFallback(payload);
      // Newest first: the new note is placed directly at the top of the timeline.
      setNotes((current) => [note, ...current.filter((row) => row.id !== note.id)]);
      setNoteForm(EMPTY_NOTE);
    } catch (cause) {
      setNoteError(describeError(cause));
    } finally {
      setNoteSubmitting(false);
    }
  }

  const openTasks = tasks.filter((task) => !COMPLETED_TASK_STATUSES.includes(upper(task.status)));
  const overdueTasks = tasks.filter(isOverdue);

  return (
    <>
      <Panel title="Diary tasks">
        <div className="eia-toolbar" style={{ marginBottom: 4 }}>
          <span className="eia-muted" data-testid="diary-open-count">
            {loading
              ? 'Loading diary…'
              : `${openTasks.length} open · ${overdueTasks.length} overdue`}
          </span>
          <span className="spacer" />
          <button type="button" className="eia-btn-ghost" onClick={reload} disabled={loading}>
            Reload
          </button>
          <button type="button" onClick={openTaskModal}>
            Add task
          </button>
        </div>

        {loading ? (
          <p className="eia-muted" data-testid="diary-loading" style={{ margin: '12px 0 0' }}>
            Loading diary tasks…
          </p>
        ) : tasks.length === 0 ? (
          <div className="eia-empty" data-testid="diary-empty" style={{ marginTop: 10 }}>
            <p style={{ marginTop: 0 }}>No diary tasks for this assumed claim yet.</p>
            <p style={{ marginTop: 0 }}>
              Add a task to schedule follow-up, review, or payment work on the claim.
            </p>
            <button type="button" onClick={openTaskModal}>
              Add the first task
            </button>
          </div>
        ) : (
          <DataTable
            columns={[
              {
                key: 'taskNumber',
                label: 'Number',
                render: (row) => <span className="eia-mono">{row.taskNumber || shortId(row.id)}</span>
              },
              {
                key: 'title',
                label: 'Title',
                render: (row) => (
                  <span className="eia-diary-title" title={row.description || undefined}>
                    {row.title || '—'}
                  </span>
                )
              },
              {
                key: 'dueDate',
                label: 'Due date',
                render: (row) => (
                  <span className={isOverdue(row) ? 'eia-diary-overdue-date' : undefined}>
                    {row.dueDate || '—'}
                  </span>
                )
              },
              {
                key: 'priority',
                label: 'Priority',
                render: (row) => (
                  <span className={`eia-pill ${priorityTone(row.priority)}`}>
                    {upper(row.priority) || 'NORMAL'}
                  </span>
                )
              },
              {
                key: 'assignedTo',
                label: 'Assignee',
                render: (row) => row.assignedTo || '—'
              },
              {
                key: 'status',
                label: 'Status',
                render: (row) => (
                  <span className="eia-diary-status">
                    <span className={`eia-pill ${taskTone(row)}`}>
                      {upper(row.status) || 'OPEN'}
                    </span>
                    {isOverdue(row) && (
                      <span
                        className="eia-badge warn"
                        data-testid={`task-overdue-${row.id}`}
                      >
                        Overdue
                      </span>
                    )}
                  </span>
                )
              },
              {
                key: 'action',
                label: 'Action',
                render: (row) => {
                  if (upper(row.status) === 'CANCELLED') return <span className="eia-muted">—</span>;
                  const reopening = upper(row.status) === 'COMPLETE';
                  return (
                    <button
                      type="button"
                      className="eia-btn-secondary"
                      aria-label={`${reopening ? 'Reopen' : 'Complete'} ${
                        row.taskNumber || shortId(row.id)
                      }`}
                      disabled={busyId !== null}
                      onClick={() => toggleTask(row)}
                    >
                      {busyId === row.id ? 'Saving…' : reopening ? 'Reopen' : 'Complete'}
                    </button>
                  );
                }
              }
            ]}
            rows={tasks}
            rowClassName={(row) => (isOverdue(row) ? 'eia-diary-overdue' : '')}
            emptyText="No diary tasks for this claim."
          />
        )}
        <ErrorText>{error}</ErrorText>
      </Panel>

      <Panel title="Claim notes">
        <p className="eia-muted" style={{ marginTop: 0 }}>
          Operational notes recorded against this assumed claim, newest first.
        </p>

        {loading ? (
          <p className="eia-muted" data-testid="notes-loading" style={{ margin: '12px 0 0' }}>
            Loading claim notes…
          </p>
        ) : notes.length === 0 ? (
          <div className="eia-empty" data-testid="notes-empty">
            <p style={{ marginTop: 0 }}>No notes recorded for this assumed claim yet.</p>
            <p style={{ marginTop: 0 }}>Add a note to document a contact, review, or decision.</p>
          </div>
        ) : (
          <ol className="eia-timeline" data-testid="notes-timeline" aria-label="Claim notes timeline">
            {notes.map((note, index) => (
              <li
                key={note.id || `${note.noteNumber || 'note'}-${index}`}
                className="eia-timeline-item"
                data-testid="note-item"
              >
                <div className="eia-timeline-head">
                  <span className={`eia-badge ${noteTone(note.noteType)}`}>
                    {upper(note.noteType) || 'GENERAL'}
                  </span>
                  <span className="eia-timeline-meta">
                    <b>{note.author || 'Unknown author'}</b>
                    <span aria-hidden="true"> · </span>
                    <time dateTime={note.createdAt || undefined}>{formatTimestamp(note.createdAt)}</time>
                    {note.noteNumber && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="eia-mono">{note.noteNumber}</span>
                      </>
                    )}
                  </span>
                </div>
                <p className="eia-timeline-body" data-testid="note-body">
                  {note.body}
                </p>
              </li>
            ))}
          </ol>
        )}

        <form onSubmit={submitNote} className="eia-form-grid" style={{ marginTop: 16 }}>
          <Field label="Note type">
            <select value={noteForm.noteType} onChange={updateNoteField('noteType')}>
              {NOTE_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Author">
            <input
              value={noteForm.author}
              onChange={updateNoteField('author')}
              placeholder="Handler or examiner"
              required
            />
          </Field>
          <Field label="Note body" className="span-3">
            <textarea
              value={noteForm.body}
              onChange={updateNoteField('body')}
              rows={3}
              placeholder="What happened on the claim?"
              required
            />
          </Field>
          <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" disabled={noteSubmitting}>
              {noteSubmitting ? 'Adding…' : 'Add note'}
            </button>
          </div>
        </form>
        <ErrorText>{noteError}</ErrorText>
      </Panel>

      <section className="eia-context-panel" aria-label="Why this matters">
        <h4>Why this matters</h4>
        <p>
          Diary tasks and notes are the operational, non-financial record of work on this assumed
          claim: they capture who is doing what, when it is due, and what was observed. They do not
          change coverage, ceded reserves, cash calls, recoveries, settlement authority, or any
          financial posting, and completing a task never moves a claim through the process stepper on
          its own. Every task update and note is attributable to its author, timestamped, and retained
          on the claim record as an auditable history.
        </p>
      </section>

      {taskOpen && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !taskSubmitting) closeTaskModal();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-task-title"
            className="eia-card"
            style={DIALOG_STYLE}
          >
            <div className="eia-record-title">
              <div>
                <h2 id="add-task-title" style={{ margin: 0 }}>
                  Add diary task
                </h2>
                <p className="eia-record-subtitle">
                  Schedule operational work on this assumed claim. Due dates and priorities drive
                  diary compliance.
                </p>
              </div>
              <button type="button" className="eia-btn-ghost" onClick={closeTaskModal} disabled={taskSubmitting}>
                Close
              </button>
            </div>

            <form className="eia-form-grid" onSubmit={submitTask} style={{ marginTop: 16 }}>
              <Field label="Title" className="span-2">
                <input
                  value={taskForm.title}
                  onChange={updateTaskField('title')}
                  placeholder="Obtain updated medical records"
                  maxLength={200}
                  required
                  autoFocus
                />
              </Field>
              <Field label="Priority">
                <select value={taskForm.priority} onChange={updateTaskField('priority')}>
                  {TASK_PRIORITIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Description" className="span-3">
                <textarea
                  value={taskForm.description}
                  onChange={updateTaskField('description')}
                  rows={3}
                  placeholder="What needs to happen, and any context for the handler"
                />
              </Field>
              <Field label="Due date">
                <input
                  type="date"
                  value={taskForm.dueDate}
                  onChange={updateTaskField('dueDate')}
                  required
                />
              </Field>
              <Field label="Assignee">
                <input
                  value={taskForm.assignedTo}
                  onChange={updateTaskField('assignedTo')}
                  placeholder="Handler or examiner"
                />
              </Field>

              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeTaskModal}
                  disabled={taskSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" disabled={taskSubmitting}>
                  {taskSubmitting ? 'Adding…' : 'Add task'}
                </button>
              </div>
            </form>
            <ErrorText>{taskError}</ErrorText>
          </section>
        </div>
      )}
    </>
  );
}
