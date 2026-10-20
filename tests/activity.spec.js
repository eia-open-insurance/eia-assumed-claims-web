import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_A_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
const CLAIM_B_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a73';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';

const CLAIM_A = {
  id: CLAIM_A_ID,
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

const CLAIM_B = {
  ...CLAIM_A,
  id: CLAIM_B_ID,
  assumedClaimNumber: 'RNS-2026-0007732',
  cedentClaimNumber: 'CED-779',
  status: 'OPEN'
};

/**
 * Builds the aggregate event page exactly as the platform event inbox returns
 * it: the canonical envelope is embedded in `payload` and the business facts
 * live in `payload.data`.
 */
function makeEvent({
  eventId,
  eventType,
  aggregateId = CLAIM_A_ID,
  aggregateVersion = 1,
  occurredAt,
  status = 'PROCESSED',
  eventVersion = 1,
  data = {}
}) {
  return {
    eventId,
    eventType,
    eventVersion,
    tenantId: TENANT,
    book: 'ASSUMED',
    aggregateType: 'AssumedClaim',
    aggregateId,
    aggregateVersion,
    occurredAt,
    receivedAt: occurredAt,
    status,
    payload: {
      eventId,
      eventType,
      eventVersion,
      tenantId: TENANT,
      book: 'ASSUMED',
      aggregateType: 'AssumedClaim',
      aggregateId,
      aggregateVersion,
      occurredAt,
      data
    }
  };
}

const REGISTERED = makeEvent({
  eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee1',
  eventType: 'assumed.claim.registered',
  aggregateVersion: 1,
  occurredAt: '2026-10-01T09:00:00Z',
  data: {
    assumedClaimId: CLAIM_A_ID,
    assumedClaimNumber: CLAIM_A.assumedClaimNumber,
    status: 'NOTIFIED',
    version: 0,
    reserveAmount: '12500.0000',
    reserveCurrency: 'USD'
  }
});

const RESERVE_CHANGED = makeEvent({
  eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee2',
  eventType: 'assumed.claim.reserve-changed',
  aggregateVersion: 2,
  occurredAt: '2026-10-02T10:00:00Z',
  data: {
    status: 'RESERVED',
    version: 1,
    component: 'CASE',
    reasonCode: 'INITIAL',
    previousReserveAmount: '12500.0000',
    reserveAmount: '150000.0000',
    currency: 'USD'
  }
});

const ASSIGNED = makeEvent({
  eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee3',
  eventType: 'assumed.claim.assigned',
  aggregateVersion: 3,
  occurredAt: '2026-10-03T11:00:00Z',
  data: {
    status: 'RESERVED',
    version: 2,
    assignedAdjuster: 'Dana Adjuster',
    assignedTeam: 'ASSUMED_CLAIMS',
    assignedBy: 'Owen Owner',
    previousAssignedAdjuster: null,
    previousAssignedTeam: null
  }
});

const EXTRA_EVENT = makeEvent({
  eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee9',
  eventType: 'assumed.claim.note-added',
  aggregateVersion: 4,
  occurredAt: '2026-10-04T12:00:00Z',
  data: {
    claimStatus: 'RESERVED',
    version: 3,
    noteNumber: 'NOT-2026-0009',
    noteType: 'DIARY',
    body: 'Cedent confirmed the reserve movement.',
    author: 'Dana Handler'
  }
});

async function fulfill(route, status, body, contentType = 'application/json') {
  await route.fulfill({
    status,
    contentType,
    body: JSON.stringify(body)
  });
}

/**
 * Serves the assumed-claims queue and every workspace read the claim header
 * issues, the platform event aggregate endpoint, and the cross-vertical
 * lookups. Event requests are recorded so a test can assert path, query,
 * headers, and selection-driven refetches.
 */
async function installMock(page, options = {}) {
  const state = {
    claims: [CLAIM_A, CLAIM_B],
    defaultEvents: options.events || [],
    eventsByAggregate: options.eventsByAggregate || null,
    eventsStatus: options.eventsStatus || 200,
    eventsMessage: options.eventsMessage || 'The event inbox is unavailable',
    gate: options.gate || null,
    eventRequests: []
  };

  await page.route('**/api/v1/assumed-claims**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/assumed-claims', '');
    const method = request.method();

    if (method === 'GET' && path === '/claims') {
      await fulfill(route, 200, state.claims);
      return;
    }

    const claimRead = path.match(/^\/claims\/([^/]+)$/);
    if (method === 'GET' && claimRead) {
      const found = state.claims.find((claim) => claim.id === claimRead[1]);
      if (found) await fulfill(route, 200, found);
      else await fulfill(route, 404, { message: `No assumed claim ${claimRead[1]}` }, 'application/problem+json');
      return;
    }

    if (method === 'GET' && path.endsWith('/financials')) {
      await fulfill(route, 200, {
        assumedClaimId: CLAIM_A_ID,
        tenantId: TENANT,
        currency: 'USD',
        cededReserveAmount: '0.0000',
        sourceVersion: 0
      });
      return;
    }

    if (method === 'GET' && path.endsWith('/commutation')) {
      await fulfill(route, 404, { message: 'No commutation recorded' }, 'application/problem+json');
      return;
    }

    if (method === 'GET' && path.startsWith('/claims/')) {
      await fulfill(route, 200, []);
      return;
    }

    await fulfill(route, 404, { message: `No mock route for ${method} ${path}` }, 'application/problem+json');
  });

  await page.route('**/api/v1/events/aggregate/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const aggregateId = decodeURIComponent(url.pathname.split('/').pop());

    state.eventRequests.push({
      method: request.method(),
      path: url.pathname,
      aggregateId,
      limit: url.searchParams.get('limit'),
      tenant: request.headers()['x-eia-tenant'],
      book: request.headers()['x-eia-book']
    });

    if (state.gate) await state.gate;

    if (state.eventsStatus !== 200) {
      await fulfill(
        route,
        state.eventsStatus,
        {
          code: 'EIA-PLT-5030',
          category: 'UNAVAILABLE',
          message: state.eventsMessage
        },
        'application/problem+json'
      );
      return;
    }

    const items = state.eventsByAggregate
      ? state.eventsByAggregate[aggregateId] || []
      : state.defaultEvents;
    await fulfill(route, 200, {
      aggregateId,
      limit: Number(url.searchParams.get('limit') || 50),
      items
    });
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
    await fulfill(route, 200, { items: [] });
  });

  await page.route('**/api/v1/documents**', async (route) => {
    await fulfill(route, 200, { items: [] });
  });

  return state;
}

function itemFor(page, label) {
  return page.getByTestId('activity-item').filter({ hasText: label });
}

test('renders activity newest first with readable events, status, version, and tab order', async ({ page }) => {
  await installMock(page, { events: [REGISTERED, RESERVE_CHANGED, ASSIGNED] });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM_A.assumedClaimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  await expect(page.getByRole('heading', { name: 'Activity timeline' })).toBeVisible();
  await expect(page.getByTestId('activity-count')).toHaveText('3 events');
  await expect(page.getByTestId('activity-item')).toHaveCount(3);

  // The API returned oldest-first; the timeline presents newest-first.
  expect(await page.getByTestId('activity-label').allTextContents()).toEqual([
    'Claim assigned',
    'Reserve changed',
    'Claim registered'
  ]);

  const times = await page
    .getByTestId('activity-time')
    .evaluateAll((nodes) => nodes.map((node) => Date.parse(node.getAttribute('datetime'))));
  expect(times).toEqual([...times].sort((left, right) => right - left));
  expect(times[0]).toBe(Date.parse('2026-10-03T11:00:00Z'));
  expect(times[times.length - 1]).toBe(Date.parse('2026-10-01T09:00:00Z'));

  const first = page.getByTestId('activity-item').first();
  await expect(first.getByTestId('activity-time')).toHaveAttribute('dateTime', '2026-10-03T11:00:00Z');
  await expect(first.getByTestId('activity-time')).toContainText('Oct 03, 2026');
  await expect(first.getByTestId('activity-label')).toHaveText('Claim assigned');
  await expect(first.getByTestId('activity-status')).toHaveText('PROCESSED');
  await expect(first.getByTestId('activity-version')).toHaveText('v1');
  await expect(first.getByTestId('activity-raw-type')).toHaveText('assumed.claim.assigned');
  await expect(first.getByTestId('activity-aggregate-version')).toContainText('aggregate v3');
  await expect(first.getByTestId('activity-fact-status')).toContainText('RESERVED');

  // The Activity tab sits directly after Audit and leaves Audit in place.
  const tabLabels = (await page.getByRole('tab').allTextContents()).map((label) => label.trim());
  expect(tabLabels.indexOf('Activity')).toBe(tabLabels.indexOf('Audit') + 1);
  await expect(page.getByRole('tab', { name: 'Audit' })).toBeVisible();
});

test('requests the claim aggregate path with tenant header and refresh re-reads the same aggregate', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const state = await installMock(page, {
    events: [REGISTERED, RESERVE_CHANGED, ASSIGNED],
    gate
  });

  await page.goto(`/?record=${CLAIM_A_ID}`);
  await expect(page.getByRole('heading', { name: CLAIM_A.assumedClaimNumber })).toBeVisible();

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity-loading')).toBeVisible();
  await expect(page.getByTestId('activity-count')).toHaveText('…');
  // The held event response never blocks the claim record above the tabs.
  await expect(page.locator('.eia-summary-grid')).toBeVisible();

  release();
  await expect(page.getByTestId('activity-item')).toHaveCount(3);
  await expect(page.getByTestId('activity-count')).toHaveText('3 events');

  expect(state.eventRequests).toHaveLength(1);
  expect(state.eventRequests[0]).toMatchObject({
    method: 'GET',
    path: `/api/v1/events/aggregate/${CLAIM_A_ID}`,
    aggregateId: CLAIM_A_ID,
    limit: '50',
    tenant: TENANT
  });
  // The platform inbox is tenant-scoped; it is not an ASSUMED-book read.
  expect(state.eventRequests[0].book).toBeUndefined();

  state.defaultEvents = [REGISTERED, RESERVE_CHANGED, ASSIGNED, EXTRA_EVENT];
  await page.getByTestId('activity-refresh').click();
  await expect(page.getByTestId('activity-item')).toHaveCount(4);
  await expect(page.getByTestId('activity-count')).toHaveText('4 events');

  expect(state.eventRequests).toHaveLength(2);
  expect(state.eventRequests[1]).toMatchObject({
    method: 'GET',
    path: `/api/v1/events/aggregate/${CLAIM_A_ID}`,
    limit: '50',
    tenant: TENANT
  });
});

test('shows the card-local empty state and explains the event-derived record', async ({ page }) => {
  await installMock(page, { events: [] });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM_A.assumedClaimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  await expect(page.getByTestId('activity-count')).toHaveText('0 events');
  await expect(page.getByTestId('activity-empty')).toContainText(
    'No events have been received for this claim yet.'
  );
  await expect(page.getByTestId('activity-empty')).toContainText('source of truth');
  await expect(page.getByTestId('activity-timeline')).toHaveCount(0);

  const note = page.getByTestId('activity-context-note');
  await expect(note).toContainText('Event-derived timeline');
  await expect(note).toContainText('append-only');
  await expect(note).toContainText('source of truth');
  await expect(page.getByTestId('activity-context')).toContainText('derived from the platform event inbox');
  await expect(page.getByRole('heading', { name: CLAIM_A.assumedClaimNumber })).toBeVisible();
});

test('keeps the 503 event-inbox failure contained in the activity card', async ({ page }) => {
  await installMock(page, {
    eventsStatus: 503,
    eventsMessage: 'The event inbox is temporarily unavailable.'
  });

  await page.goto(`/?record=${CLAIM_A_ID}`);
  await expect(page.getByRole('heading', { name: CLAIM_A.assumedClaimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const error = page.getByTestId('activity-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('The event inbox is temporarily unavailable.');
  await expect(error).toContainText('The claim record is unaffected.');
  await expect(page.getByTestId('activity-count')).toHaveText('Activity unavailable');
  await expect(page.getByTestId('activity-timeline')).toHaveCount(0);

  // No page-level error: the claim record and its workbench remain usable.
  await expect(page.locator('main > p[role="alert"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: CLAIM_A.assumedClaimNumber })).toBeVisible();
  await expect(page.locator('.eia-summary-grid')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
});

test('summarizes status, reserve, advice, cash call, recovery, commutation, task/note, and assignment facts', async ({ page }) => {
  const events = [
    REGISTERED,
    ASSIGNED,
    makeEvent({
      eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee4',
      eventType: 'assumed.claim.loss-advice-posted',
      aggregateVersion: 4,
      occurredAt: '2026-10-04T09:00:00Z',
      data: {
        status: 'RESERVED',
        version: 3,
        adviceNumber: 'ADV-9001',
        adviceType: 'INITIAL_NOTICE',
        adviceStatus: 'POSTED',
        reportedAmount: '250000.0000',
        cededAmount: '125000.0000',
        currency: 'USD'
      }
    }),
    makeEvent({
      eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee5',
      eventType: 'assumed.claim.cash-call-requested',
      aggregateVersion: 5,
      occurredAt: '2026-10-05T09:00:00Z',
      data: {
        status: 'RESERVED',
        version: 4,
        requestNumber: 'CSH-2026-000001',
        cashCallStatus: 'SUBMITTED',
        requestedAmount: '50000.0000',
        currency: 'USD'
      }
    }),
    makeEvent({
      eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee6',
      eventType: 'assumed.claim.recovery-recorded',
      aggregateVersion: 6,
      occurredAt: '2026-10-06T09:00:00Z',
      data: {
        status: 'RESERVED',
        version: 5,
        recoveryType: 'SALVAGE',
        recoveryStatus: 'RECEIVED',
        amount: '25000.0000',
        currency: 'USD'
      }
    }),
    makeEvent({
      eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee7',
      eventType: 'assumed.claim.commuted',
      aggregateVersion: 7,
      occurredAt: '2026-10-07T09:00:00Z',
      data: {
        status: 'CLOSED',
        version: 6,
        commutationNumber: 'COM-2026-0001',
        commutationStatus: 'EXECUTED',
        acceptedAmount: '750000.0000',
        currency: 'USD'
      }
    }),
    makeEvent({
      eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee8',
      eventType: 'assumed.claim.task-created',
      aggregateVersion: 8,
      occurredAt: '2026-10-08T09:00:00Z',
      data: {
        claimStatus: 'RESERVED',
        version: 7,
        taskNumber: 'TSK-2026-0001',
        title: 'Obtain updated medical records',
        status: 'OPEN',
        priority: 'HIGH'
      }
    }),
    makeEvent({
      eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee9',
      eventType: 'assumed.claim.note-added',
      aggregateVersion: 9,
      occurredAt: '2026-10-09T09:00:00Z',
      data: {
        claimStatus: 'RESERVED',
        version: 8,
        noteNumber: 'NOT-2026-0001',
        noteType: 'DIARY',
        body: 'Spoke with the cedent about the reserve movement.',
        author: 'Dana Handler'
      }
    })
  ];

  await installMock(page, { events });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM_A.assumedClaimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity-item')).toHaveCount(8);

  const registered = itemFor(page, 'Claim registered');
  await expect(registered.getByTestId('activity-fact-status')).toContainText('NOTIFIED');
  await expect(registered.getByTestId('activity-fact-reserve')).toContainText('$12,500.00');
  await expect(registered.getByTestId('activity-fact-version')).toHaveText(/Version\s*0/);

  const assigned = itemFor(page, 'Claim assigned');
  await expect(assigned.getByTestId('activity-fact-assignment')).toContainText('Dana Adjuster');
  await expect(assigned.getByTestId('activity-fact-assignment')).toContainText('Assumed claims');
  await expect(assigned.getByTestId('activity-fact-assignedBy')).toContainText('Owen Owner');

  const advice = itemFor(page, 'Loss advice posted');
  await expect(advice.getByTestId('activity-fact-advice')).toContainText('ADV-9001');
  await expect(advice.getByTestId('activity-fact-advice')).toContainText('INITIAL NOTICE');
  await expect(advice.getByTestId('activity-fact-adviceReported')).toContainText('$250,000.00');
  await expect(advice.getByTestId('activity-fact-adviceCeded')).toContainText('$125,000.00');

  const cashCall = itemFor(page, 'Cash call requested');
  await expect(cashCall.getByTestId('activity-fact-cashCall')).toContainText('CSH-2026-000001');
  await expect(cashCall.getByTestId('activity-fact-cashCall')).toContainText('SUBMITTED');
  await expect(cashCall.getByTestId('activity-fact-cashCallAmount')).toContainText('$50,000.00');

  const recovery = itemFor(page, 'Recovery recorded');
  await expect(recovery.getByTestId('activity-fact-recovery')).toContainText('SALVAGE');
  await expect(recovery.getByTestId('activity-fact-recoveryAmount')).toContainText('$25,000.00');

  const commutation = itemFor(page, 'Claim commuted');
  await expect(commutation.getByTestId('activity-fact-commutation')).toContainText('COM-2026-0001');
  await expect(commutation.getByTestId('activity-fact-commutationAccepted')).toContainText('$750,000.00');

  const task = itemFor(page, 'Diary task created');
  await expect(task.getByTestId('activity-fact-task')).toContainText('TSK-2026-0001');
  await expect(task.getByTestId('activity-fact-task')).toContainText('Obtain updated medical records');
  await expect(task.getByTestId('activity-fact-taskStatus')).toContainText('OPEN');
  await expect(task.getByTestId('activity-fact-status')).toContainText('RESERVED');

  const note = itemFor(page, 'Note added');
  await expect(note.getByTestId('activity-fact-note')).toContainText('NOT-2026-0001');
  await expect(note.getByTestId('activity-fact-note')).toContainText('Spoke with the cedent');
  await expect(note.getByTestId('activity-fact-noteAuthor')).toContainText('Dana Handler');
});

test('refetches activity for the newly selected claim', async ({ page }) => {
  const state = await installMock(page, {
    eventsByAggregate: {
      [CLAIM_A_ID]: [
        makeEvent({
          eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeea1',
          eventType: 'assumed.claim.task-created',
          aggregateId: CLAIM_A_ID,
          aggregateVersion: 1,
          occurredAt: '2026-10-10T09:00:00Z',
          data: { claimStatus: 'NOTIFIED', taskNumber: 'TSK-A-0001', title: 'Claim A task', status: 'OPEN' }
        })
      ],
      [CLAIM_B_ID]: [
        makeEvent({
          eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeea2',
          eventType: 'assumed.claim.note-added',
          aggregateId: CLAIM_B_ID,
          aggregateVersion: 1,
          occurredAt: '2026-10-11T09:00:00Z',
          data: {
            claimStatus: 'OPEN',
            noteNumber: 'NOT-B-0001',
            noteType: 'GENERAL',
            body: 'Claim B note',
            author: 'B. Handler'
          }
        })
      ]
    }
  });

  await page.goto(`/?record=${CLAIM_A_ID}`);
  await expect(page.getByRole('heading', { name: CLAIM_A.assumedClaimNumber })).toBeVisible();
  await expect.poll(() => state.eventRequests.length).toBe(1);

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity-fact-task')).toContainText('Claim A task');

  await page.getByRole('button', { name: `Open ${CLAIM_B.assumedClaimNumber}` }).click();
  await expect(page.getByRole('heading', { name: CLAIM_B.assumedClaimNumber })).toBeVisible();
  await expect.poll(() => state.eventRequests.length).toBe(2);
  expect(state.eventRequests[1].path).toBe(`/api/v1/events/aggregate/${CLAIM_B_ID}`);
  expect(state.eventRequests[1].tenant).toBe(TENANT);

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity-fact-note')).toContainText('Claim B note');
  await expect(page.getByTestId('activity-item')).toHaveCount(1);

  expect(state.eventRequests.map((request) => request.aggregateId)).toEqual([
    CLAIM_A_ID,
    CLAIM_B_ID
  ]);
});
