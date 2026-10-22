import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { navigate, recordHref } from './navigation.js';
import { shortId } from './ui.jsx';

/**
 * Notifications are a read-only projection on the assumed claim: they are
 * delivered because the claim changed, but Notifications owns routing,
 * delivery, escalation, and acknowledgement. The lookup is independent of the
 * claim load so a slow or failing Notifications service never blocks the
 * record.
 */

/** The source linkage Notifications stores for a message sent from this claim. */
export const NOTIFICATION_SOURCE_TYPE = 'ASSUMED_CLAIM';

/** The Overview shows the newest few; the heading count covers every linked item. */
export const RELATED_NOTIFICATION_LIMIT = 3;

const NOTIFICATION_TONES = [
  ['green', ['DELIVERED', 'READ', 'ACKNOWLEDGED', 'ACTIONED']],
  ['red', ['FAILED', 'SUPPRESSED', 'EXPIRED', 'CANCELLED']],
  ['amber', ['CREATED', 'QUEUED', 'SENT']]
];

/** Delivery status tone; unknown statuses keep the default blue pill. */
export function notificationTone(status) {
  const value = String(status || '').toUpperCase();
  const match = NOTIFICATION_TONES.find(([, statuses]) => statuses.includes(value));
  return match ? match[0] : 'blue';
}

/** The notifications API returns either a bare array or an {items:[...]} envelope. */
export function notificationItems(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

/**
 * The query is already source-scoped, but Notifications is a shared service and
 * the claim record must never present another record's messages. An explicit
 * `sourceId` match is required: a row that omits the linkage cannot be proven
 * related and is dropped. A missing `sourceType` is tolerated only when the id
 * matches because the API writes the type/id pair together.
 */
export function belongsToClaim(notification, claimId) {
  const sourceId = String(notification?.sourceId || '').trim().toLowerCase();
  const expectedId = String(claimId || '').trim().toLowerCase();
  if (!sourceId || !expectedId || sourceId !== expectedId) return false;
  const sourceType = String(notification?.sourceType || '').trim().toUpperCase();
  return !sourceType || sourceType === NOTIFICATION_SOURCE_TYPE;
}

/** Renders the Notification `createdAt` instant as a stable calendar date. */
export function notificationCreatedDate(value) {
  if (value == null || value === '') return '—';
  const text = String(value);
  const date = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return date ? date[1] : text;
}

/**
 * The card count is the total number of related notifications, which can be
 * larger than the three-row preview. A page envelope may carry `total`; a bare
 * array and a payload without a usable total fall back to the rows present.
 */
export function notificationCount(body, items) {
  const rows = Array.isArray(items) ? items : [];
  const total = Number(body?.total);
  return Number.isInteger(total) && total >= rows.length ? total : rows.length;
}

function createdTimestamp(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

/**
 * Normalizes Notification DTOs into newest-first rows for the Overview. The
 * notification number breaks same-instant ties so the three-row preview is
 * deterministic across reloads.
 */
export function notificationRows(body, claimId) {
  return notificationItems(body)
    .filter((notification) => belongsToClaim(notification, claimId))
    .map((notification) => {
      const id = notification?.id ? String(notification.id) : '';
      const createdAt = notification?.createdAt || '';
      return {
        id,
        number: notification?.notificationNumber || (id ? shortId(id) : '—'),
        subject: notification?.subject || notification?.notificationType || '—',
        status: notification?.status || '',
        createdAt,
        createdAtValue: createdTimestamp(createdAt),
        href: id ? recordHref('notifications', id) : ''
      };
    })
    .sort((left, right) => {
      const timeDiff = right.createdAtValue - left.createdAtValue;
      if (timeDiff !== 0) return timeDiff;
      return String(right.number).localeCompare(String(left.number));
    });
}

/**
 * The Notifications workbench accepts `sourceType`/`sourceId` as a queue
 * scope, so the hand-off keeps the claim filter instead of falling back to an
 * unfiltered queue or a text search.
 */
export function notificationsQueueHref(claimId) {
  if (!claimId) return '/notifications';
  const params = new URLSearchParams();
  params.set('sourceType', NOTIFICATION_SOURCE_TYPE);
  params.set('sourceId', claimId);
  return `/notifications?${params.toString()}`;
}

function openNotification(event) {
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

export default function NotificationsCard({ claim }) {
  const claimId = claim?.id || '';
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const [state, setState] = useState(claimId ? 'loading' : 'empty');

  useEffect(() => {
    if (!claimId) {
      setItems([]);
      setCount(0);
      setState('empty');
      return undefined;
    }

    let alive = true;
    setItems([]);
    setCount(0);
    setState('loading');

    api.notifications
      .listBySource(NOTIFICATION_SOURCE_TYPE, claimId)
      .then((body) => {
        if (!alive) return;
        const rows = notificationRows(body, claimId);
        setItems(rows);
        setCount(notificationCount(body, rows));
        setState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setItems([]);
        setCount(0);
        setState('error');
      });

    return () => {
      alive = false;
    };
  }, [claimId]);

  const newest = items.slice(0, RELATED_NOTIFICATION_LIMIT);
  const displayedCount = state === 'ready' ? count : '—';
  const viewAllHref = notificationsQueueHref(claimId);

  return (
    <section
      className="eia-card"
      aria-label="Related notifications"
      data-testid="notifications-card"
      style={{ marginTop: 14 }}
    >
      <h3>
        Related notifications{' '}
        <span data-testid="notifications-count" style={{ color: 'var(--eia-blue)' }}>
          {displayedCount}
        </span>
      </h3>
      <p
        className="eia-muted"
        data-testid="notifications-context"
        style={{ margin: '0 0 4px', fontSize: 12 }}
      >
        Notifications sent because this assumed claim changed. The claim carries the source link;
        Notifications owns delivery, escalation, and acknowledgement.
      </p>

      {state === 'loading' && (
        <p
          className="eia-muted"
          data-testid="notifications-loading"
          role="status"
          style={{ margin: '8px 0 0' }}
        >
          Loading related notifications…
        </p>
      )}

      {state === 'error' && (
        <p
          className="eia-muted"
          data-testid="notifications-error"
          role="alert"
          style={{ margin: '8px 0 0' }}
        >
          Related notifications could not be loaded. The claim record is unaffected.
        </p>
      )}

      {state === 'ready' && items.length === 0 && (
        <p className="eia-muted" data-testid="notifications-empty" style={{ margin: '8px 0 0' }}>
          No notifications linked to this claim.
        </p>
      )}

      {state === 'ready' && items.length > 0 && (
        <>
          <div className="eia-table-wrap" style={{ marginTop: 10 }}>
            <table className="eia-table" cellPadding="8" aria-label="Related notifications">
              <thead>
                <tr>
                  <th>Notification</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {newest.map((notification, index) => (
                  <tr
                    key={notification.id || `${notification.number}-${index}`}
                    data-testid="notification-row"
                  >
                    <td className="eia-mono" data-testid="notification-number">
                      {notification.href ? (
                        <a
                          href={notification.href}
                          onClick={openNotification}
                          data-testid={
                            notification.id ? `notification-link-${notification.id}` : undefined
                          }
                          title={`Open notification ${notification.number}`}
                        >
                          {notification.number}
                        </a>
                      ) : (
                        notification.number
                      )}
                    </td>
                    <td data-testid="notification-subject">{notification.subject}</td>
                    <td data-testid="notification-status">
                      <span className={`eia-pill ${notificationTone(notification.status)}`}>
                        {notification.status || '—'}
                      </span>
                    </td>
                    <td data-testid="notification-created">
                      <time dateTime={notification.createdAt || undefined}>
                        {notificationCreatedDate(notification.createdAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {count > newest.length && (
            <p className="eia-muted" data-testid="notifications-more" style={{ margin: '6px 0 0' }}>
              Showing the {newest.length} newest of {count} linked notifications.
            </p>
          )}
        </>
      )}

      <p
        className="eia-muted"
        data-testid="notifications-view-all-row"
        style={{ margin: '10px 0 0', fontSize: 12 }}
      >
        <a href={viewAllHref} onClick={openNotification} data-testid="notifications-view-all">
          View all notifications
        </a>{' '}
        — opens the Notifications queue filtered to this claim.
      </p>
    </section>
  );
}
