import React from 'react';

const STATUS_TONES = [
  ['green', ['CLOSED', 'PAID', 'SETTLED']],
  ['red', ['DENIED', 'WITHDRAWN', 'DISMISSED']],
  ['amber', ['IN_LITIGATION', 'IN_SETTLEMENT', 'COVERAGE_REVIEW', 'RESERVED']]
];

export function statusTone(status) {
  const match = STATUS_TONES.find(([, statuses]) => statuses.includes(status));
  return match ? match[0] : 'blue';
}

export function shortId(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

export function humanize(value) {
  if (!value) return '—';
  return String(value).replace(/_/g, ' ');
}

export function Panel({ title, children }) {
  return (
    <section className="eia-card" aria-label={title} style={{ marginBottom: 16 }}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function Field({ label, children, className = '', span }) {
  const classes = [className, span ? `span-${span}` : ''].filter(Boolean).join(' ');
  return (
    <label className={`eia-field ${classes}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p role="alert" style={{ margin: '8px 0 0' }}>{children}</p>;
}

export function DataTable({
  columns,
  rows = [],
  empty,
  emptyText,
  rowKey,
  rowClassName,
  label
}) {
  const classNameFor = (row) => {
    if (typeof rowClassName === 'function') return rowClassName(row) || undefined;
    return rowClassName || undefined;
  };
  const emptyMessage = emptyText ?? empty ?? 'No records.';

  return (
    <div className="eia-table-wrap" style={{ marginTop: 10 }}>
      <table className="eia-table" cellPadding="8" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} align={column.align || 'left'}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey ? rowKey(row) : row.id || index}
              className={classNameFor(row)}
            >
              {columns.map((column) => (
                <td key={column.key} align={column.align || 'left'}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="eia-muted">{emptyMessage}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
