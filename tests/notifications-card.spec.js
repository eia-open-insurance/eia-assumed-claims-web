import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
const CLAIM_ID_2 = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a73';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'ASSUMED',
  assumedClaimNumber: 'RNS-2026-0007731',
  contractId: CONTRACT_ID,
  cedentClaimNumber: 'CED-778',
  status: 'NOTIFIED',
  lossDate: '2026-09-01',
  reportDate: '2026-09-02',
  reserveAmount: 12500.0,
  reserveCurrency: 'USD',
  version: 0
};

const CLAIM_2 = {
  ...CLAIM,
  id: CLAIM_ID_2,
  assumedClaimNumber: 'RNS-2026-0007732',
  cedentClaimNumber: 'CED-779'
};

function notification(overrides = {}) {
  return {
    tenantId: TENANT,
    notificationType: 'ASSUMED_CLAIM_STATUS_CHANGE',
    channel: 'EMAIL',
    status: 'SENT',
    sourceType: 'ASSUMED_CLAIM',
    sourceId: CLAIM_ID,
    sourceReference: CLAIM.assumedClaimNumber,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
    ...overrides
  };
}

// Deliberately out of order and mixed with rows that point at another claim,
// another source type, or carry no linkage: the card must show only this
// claim's newest three.
const NOTIFICATION_NEWEST = notification({
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a91',
  notificationNumber: 'NTF-2026-0000041',
  subject: 'Assumed claim moved to adjustment',
  status: 'DELIVERED',
  createdAt: '2026-10-12T09:30:00Z'
});

const NOTIFICATION_MIDDLE = notification({
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a90',
  notificationNumber: 'NTF-2026-0000040',
  subject: 'Reserve change acknowledged',
  status: 'READ',
  createdAt: '2026-10-02T10:15:00Z'
});

const NOTIFICATION_OLD = notification({
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a89',
  notificationNumber: 'NTF-2026-0000039',
  subject: 'Cash call approved',
  status: 'QUEUED',
  createdAt: '2026-09-28T14:05:00Z'
});

const NOTIFICATION_OLDEST = notification({
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a88',
  notificationNumber: 'NTF-2026-0000038',
  subject: 'Assumed claim registered',
  status: 'FAILED',
  createdAt: '2026-09-01T08:00:00Z'
});

const NOTIFICATION_OTHER_CLAIM = notification({
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a87',
  notificationNumber: 'NTF-2026-0000037',
  subject: 'Other assumed claim reminder',
  status: 'SENT',
  sourceId: CLAIM_ID_2,
  sourceReference: CLAIM_2.assumedClaimNumber,
  createdAt: '2026-10-20T08:00:00Z'
});

const NOTIFICATION_OTHER_SOURCE = notification({
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a86',
  notificationNumber: 'NTF-2026-0000036',
  subject: 'Payment receipt',
  status: 'SENT',
  sourceType: 'PAYMENT',
  createdAt: '2026-10-21T08:00:00Z'
});

const NOTIFICATION_UNLINKED = notification({
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a85',
  notificationNumber: 'NTF-2026-0000035',
  subject: 'Untraceable reminder',
  status: 'SENT',
  sourceType: null,
  sourceId: null,
  sourceReference: null,
  createdAt: '2026-10-22T08:00:00Z'
});

const RELATED = [
  NOTIFICATION_OLD,
  NOTIFICATION_NEWEST,
  NOTIFICATION_MIDDLE,
  NOTIFICATION_OLDEST,
  NOTIFICATION_OTHER_CLAIM,
  NOTIFICATION_OTHER_SOURCE,
  NOTIFICATION_UNLINKED
];

const NOTIFICATION_CLAIM_2 = notification({
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a92',
  notificationNumber: 'NTF-2026-0000042',
  subject: 'Second assumed claim reserved',
  status: 'DELIVERED',
  sourceId: CLAIM_ID_2,
  sourceReference: CLAIM_2.assumedClaimNumber,
  createdAt: '2026-10-18T09:00:00Z'
});

async function fulfill(route, status, body) {
  await route.fulfill({
    status,
    contentType: status === 200 ? 'application/json' : 'application/problem+json',
    body: JSON.stringify(body)
  });
}

/**
 * Serves the assumed-claims queue, the Overview workspace reads, and the
 * related-notifications endpoint. Notification requests are recorded so a test
 * can assert the exact source query and headers; `gate` holds the response open
 * to prove the claim renders without it, `status` makes the lookup fail,
 * `body` replaces the payload, and `notificationsByClaim` scopes responses so a
 * claim switch can be asserted.
 */
async function installMock(page, options = {}) {
  const state = { notificationRequests: [] };
  const claims = options.claims || [CLAIM];

  await page.route('**/api/v1/assumed-claims**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/assumed-claims', '');
    const method = request.method();

    if (method === 'GET' && path === '/claims') {
      await fulfill(route, 200, claims);
      return;
    }
    if (method === 'GET' && claims.some((claim) => path === `/claims/${claim.id}`)) {
      await fulfill(route, 200, claims.find((claim) => path === `/claims/${claim.id}`));
      return;
    }
    if (method === 'GET' && /^\/claims\/[^/]+\/financials$/.test(path)) {
      await fulfill(route, 200, {
        assumedClaimId: path.split('/')[2],
        tenantId: TENANT,
        currency: 'USD',
        cededReserveAmount: '12500.0000',
        sourceVersion: 0
      });
      return;
    }
    if (method === 'GET' && path.endsWith('/commutation')) {
      await fulfill(route, 404, { code: 'NOT_FOUND', message: 'No commutation recorded' });
      return;
    }
    if (method === 'GET' && path.startsWith('/claims/')) {
      await fulfill(route, 200, []);
      return;
    }
    await fulfill(route, 200, {});
  });

  await page.route('**/api/v1/contracts/**', async (route) => {
    await fulfill(route, 200, {
      id: CONTRACT_ID,
      tenantId: TENANT,
      contractNumber: 'QS-2026-00042',
      contractType: 'QUOTA_SHARE',
      status: 'BOUND'
    });
  });

  await page.route('**/api/v1/retrocessions/search**', async (route) => {
    await fulfill(route, 200, { query: '', limit: 5, items: [] });
  });

  await page.route('**/api/v1/documents**', async (route) => {
    await fulfill(route, 200, []);
  });

  await page.route('**/api/v1/payments**', async (route) => {
    await fulfill(route, 200, []);
  });

  await page.route('**/api/v1/directory', async (route) => {
    await fulfill(route, 200, { people: [], teams: [] });
  });

  await page.route('**/api/v1/events/aggregate/**', async (route) => {
    await fulfill(route, 200, { items: [] });
  });

  await page.route('**/api/v1/notifications**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    const sourceId = url.searchParams.get('sourceId');
    state.notificationRequests.push({
      method: request.method(),
      path: url.pathname,
      sourceType: url.searchParams.get('sourceType'),
      sourceId,
      tenant: headers['x-eia-tenant'] || null,
      book: headers['x-eia-book'] || null
    });

    if (options.gate) await options.gate;

    if (options.status && options.status !== 200) {
      await fulfill(route, options.status, {
        code: 'EIA-NTF-5030',
        category: 'UNAVAILABLE',
        message: 'Notification service is unavailable'
      });
      return;
    }

    if (options.notificationsByClaim) {
      await fulfill(route, 200, options.notificationsByClaim[sourceId] || []);
      return;
    }

    await fulfill(route, 200, options.body === undefined ? RELATED : options.body);
  });

  return state;
}

test('lists the newest three related notifications with count and source query', async ({ page }) => {
  const state = await installMock(page);

  await page.goto('/');

  const card = page.getByTestId('notifications-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: /Related notifications/ })).toBeVisible();
  await expect(page.getByTestId('notifications-count')).toHaveText('4');
  await expect(page.getByTestId('notifications-context')).toContainText(
    'Notifications owns delivery, escalation, and acknowledgement'
  );
  await expect(page.getByTestId('notifications-context')).toContainText('assumed claim');

  const rows = page.getByTestId('notification-row');
  await expect(rows).toHaveCount(3);

  // Newest first, and the oldest linked row plus the unrelated rows stay hidden.
  await expect(rows.nth(0).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_NEWEST.notificationNumber
  );
  await expect(rows.nth(1).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_MIDDLE.notificationNumber
  );
  await expect(rows.nth(2).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_OLD.notificationNumber
  );
  await expect(rows.filter({ hasText: NOTIFICATION_OLDEST.notificationNumber })).toHaveCount(0);
  await expect(rows.filter({ hasText: NOTIFICATION_OTHER_CLAIM.notificationNumber })).toHaveCount(0);
  await expect(rows.filter({ hasText: NOTIFICATION_OTHER_SOURCE.notificationNumber })).toHaveCount(0);
  await expect(rows.filter({ hasText: NOTIFICATION_UNLINKED.notificationNumber })).toHaveCount(0);

  const newest = rows.filter({ hasText: NOTIFICATION_NEWEST.notificationNumber });
  await expect(newest.getByTestId('notification-subject')).toHaveText(
    NOTIFICATION_NEWEST.subject
  );
  await expect(newest.getByTestId('notification-status')).toContainText('DELIVERED');
  await expect(newest.getByTestId('notification-created')).toHaveText('2026-10-12');
  await expect(newest.getByRole('link')).toHaveAttribute(
    'href',
    `/notifications?record=${NOTIFICATION_NEWEST.id}`
  );

  await expect(page.getByTestId('notifications-more')).toHaveText(
    'Showing the 3 newest of 4 linked notifications.'
  );
  await expect(page.getByTestId('notifications-view-all')).toHaveAttribute(
    'href',
    `/notifications?sourceType=ASSUMED_CLAIM&sourceId=${CLAIM.id}`
  );
  await expect(page.getByTestId('notifications-view-all-row')).toContainText(
    'opens the Notifications queue filtered to this claim'
  );

  // The card follows the Payments card on the claim overview.
  const afterPayments = await page.evaluate(() => {
    const payments = document.querySelector('[data-testid="payments-card"]');
    const notifications = document.querySelector('[data-testid="notifications-card"]');
    if (!payments || !notifications) return false;
    return Boolean(
      payments.compareDocumentPosition(notifications) & Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
  expect(afterPayments).toBe(true);

  expect(state.notificationRequests).toEqual([
    {
      method: 'GET',
      path: '/api/v1/notifications',
      sourceType: 'ASSUMED_CLAIM',
      sourceId: CLAIM_ID,
      tenant: TENANT,
      book: null
    }
  ]);
});

test('accepts the {items} page envelope and renders a single notification', async ({ page }) => {
  await installMock(page, { body: { items: [NOTIFICATION_OLD], total: 1 } });

  await page.goto('/');

  await expect(page.getByTestId('notifications-count')).toHaveText('1');
  await expect(page.getByTestId('notification-row')).toHaveCount(1);
  await expect(page.getByTestId('notification-number')).toHaveText(
    NOTIFICATION_OLD.notificationNumber
  );
  await expect(page.getByTestId('notification-created')).toHaveText('2026-09-28');
  await expect(page.getByTestId('notifications-more')).toHaveCount(0);
});

test('uses the page total for the count and newest-page ordering', async ({ page }) => {
  await installMock(page, {
    body: { items: [NOTIFICATION_OLD, NOTIFICATION_NEWEST], total: 9 }
  });

  await page.goto('/');

  await expect(page.getByTestId('notifications-count')).toHaveText('9');
  const rows = page.getByTestId('notification-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_NEWEST.notificationNumber
  );
  await expect(rows.nth(1).getByTestId('notification-number')).toHaveText(
    NOTIFICATION_OLD.notificationNumber
  );
  await expect(page.getByTestId('notifications-more')).toHaveText(
    'Showing the 2 newest of 9 linked notifications.'
  );
});

test('shows the empty state when no notification is linked to the claim', async ({ page }) => {
  await installMock(page, { body: [] });

  await page.goto('/');

  await expect(page.getByTestId('notifications-count')).toHaveText('0');
  await expect(page.getByTestId('notifications-empty')).toHaveText(
    'No notifications linked to this claim.'
  );
  await expect(page.getByTestId('notification-row')).toHaveCount(0);
  await expect(page.getByTestId('notifications-view-all')).toBeVisible();
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();
});

test('contains a notifications failure inside the card', async ({ page }) => {
  await installMock(page, { status: 503 });

  await page.goto('/');

  await expect(page.getByTestId('notifications-error')).toContainText(
    'Related notifications could not be loaded'
  );
  await expect(page.getByTestId('notifications-error')).toContainText(
    'claim record is unaffected'
  );
  await expect(page.getByTestId('notifications-count')).toHaveText('—');
  await expect(page.getByTestId('notification-row')).toHaveCount(0);
  await expect(page.getByTestId('notifications-view-all')).toBeVisible();

  // The claim record and its other Overview cards are unaffected by the failure.
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claim details' })).toBeVisible();
  await expect(page.getByTestId('documents-card')).toBeVisible();
  await expect(page.getByTestId('payments-card')).toBeVisible();
});

test('renders the claim before the notifications response arrives', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await installMock(page, { gate });

  await page.goto('/');

  await expect(page.getByTestId('notifications-loading')).toBeVisible();
  await expect(page.getByTestId('notifications-count')).toHaveText('—');
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claim details' })).toBeVisible();

  release();
  await expect(page.getByTestId('notification-row')).toHaveCount(3);
  await expect(page.getByTestId('notifications-loading')).toHaveCount(0);
});

test('refetches notifications for the newly selected claim', async ({ page }) => {
  const state = await installMock(page, {
    claims: [CLAIM, CLAIM_2],
    notificationsByClaim: {
      [CLAIM_ID]: [NOTIFICATION_OLD],
      [CLAIM_ID_2]: [NOTIFICATION_CLAIM_2]
    }
  });

  await page.goto('/');

  await expect(page.getByTestId('notification-number')).toHaveText(
    NOTIFICATION_OLD.notificationNumber
  );

  await page.getByRole('button', { name: `Open ${CLAIM_2.assumedClaimNumber}` }).click();

  await expect(page.getByRole('heading', { name: CLAIM_2.assumedClaimNumber })).toBeVisible();
  await expect(page.getByTestId('notification-number')).toHaveText(
    NOTIFICATION_CLAIM_2.notificationNumber
  );
  await expect(page.getByTestId('notifications-count')).toHaveText('1');
  expect(state.notificationRequests.map((entry) => entry.sourceId)).toEqual([
    CLAIM_ID,
    CLAIM_ID_2
  ]);
  expect(
    state.notificationRequests.every(
      (entry) => entry.sourceType === 'ASSUMED_CLAIM' && entry.book === null
    )
  ).toBe(true);
});

test('links each notification to its record and opens the filtered queue', async ({ page }) => {
  await installMock(page);

  await page.goto('/');

  await page.getByTestId(`notification-link-${NOTIFICATION_NEWEST.id}`).click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?record=${NOTIFICATION_NEWEST.id}$`)
  );

  await page.goto('/');
  await page.getByTestId('notifications-view-all').click();
  await expect(page).toHaveURL(
    new RegExp(`/notifications\\?sourceType=ASSUMED_CLAIM&sourceId=${CLAIM_ID}$`)
  );
});
