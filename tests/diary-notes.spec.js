import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';
const CONTRACT_NUMBER = 'QS-2026-00042';

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

const OVERDUE_TASK = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a81',
  taskNumber: 'TSK-2026-0001',
  title: 'Chase cedent loss advice',
  description: 'The cedent has not returned the updated advice requested at notification.',
  dueDate: '2020-01-05',
  priority: 'URGENT',
  status: 'OPEN',
  assignedTo: 'A. Adjuster',
  version: 3,
  createdAt: '2026-09-02T09:10:00Z',
  updatedAt: '2026-09-05T10:00:00Z',
  completedAt: null
};

const COMPLETED_TASK = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a82',
  taskNumber: 'TSK-2026-0002',
  title: 'Review ceded reserve adequacy',
  description: 'Quarterly assumed-claim reserve review.',
  dueDate: '2099-12-31',
  priority: 'NORMAL',
  status: 'COMPLETE',
  assignedTo: 'B. Examiner',
  version: 1,
  createdAt: '2026-09-02T09:12:00Z',
  updatedAt: '2026-09-20T12:00:00Z',
  completedAt: '2026-09-20T12:00:00Z'
};

const CANCELLED_TASK = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a83',
  taskNumber: 'TSK-2026-0004',
  title: 'Obtain cedent duplicate advice',
  description: 'Cancelled after the duplicate notice was withdrawn.',
  dueDate: '2020-02-01',
  priority: 'LOW',
  status: 'CANCELLED',
  assignedTo: 'A. Adjuster',
  version: 2,
  createdAt: '2026-09-03T09:12:00Z',
  updatedAt: '2026-09-04T12:00:00Z',
  completedAt: null
};

const NEWER_NOTE = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a91',
  noteNumber: 'NOT-2026-0002',
  noteType: 'DIARY',
  body: 'Spoke with the cedent about the outstanding loss advice.',
  author: 'Dana Handler',
  createdAt: '2026-09-12T14:30:00Z'
};

const OLDER_NOTE = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a92',
  noteNumber: 'NOT-2026-0001',
  noteType: 'GENERAL',
  body: 'Cedent notice received and claim registered on the ASSUMED book.',
  author: 'Sam Intake',
  createdAt: '2026-09-02T09:05:00Z'
};

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

async function fulfillProblem(route, status, detail, title = 'Conflict') {
  await route.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: 'about:blank', title, status, detail })
  });
}

/**
 * Stateful mock for the assumed-claims claim queue, every workspace sub-resource
 * the shell loads, and the new task/note endpoints. Task and note mutations
 * update the same state so the list and summary refreshes are observable.
 */
async function installMocks(page) {
  const state = {
    tasks: [{ ...OVERDUE_TASK }, { ...COMPLETED_TASK }],
    notes: [{ ...OLDER_NOTE }, { ...NEWER_NOTE }],
    requests: [],
    taskCreateBody: null,
    taskPatchBody: null,
    taskPatchPath: null,
    noteCreateBody: null,
    conflict: false,
    taskCreateProblem: false
  };

  await page.route('**/api/v1/contracts/**', async (route) => {
    await fulfillJson(route, {
      id: CONTRACT_ID,
      tenantId: TENANT,
      contractNumber: CONTRACT_NUMBER,
      contractType: 'QUOTA_SHARE',
      status: 'BOUND',
      currency: 'USD',
      version: 1
    });
  });

  await page.route('**/api/v1/retrocessions/search**', async (route) => {
    const url = new URL(route.request().url());
    await fulfillJson(route, {
      query: url.searchParams.get('q') || '',
      limit: Number(url.searchParams.get('limit') || 5),
      items: []
    });
  });

  await page.route('**/api/v1/assumed-claims**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/assumed-claims', '');
    const method = request.method();
    state.requests.push({
      method,
      path: url.pathname,
      book: request.headers()['x-eia-book'],
      tenant: request.headers()['x-eia-tenant']
    });

    if (path === '/claims' && method === 'GET') {
      return fulfillJson(route, [CLAIM]);
    }

    const claimRead = path.match(/^\/claims\/([^/]+)$/);
    if (claimRead && method === 'GET') {
      return fulfillJson(route, CLAIM);
    }

    const taskMatch = path.match(/^\/claims\/([^/]+)\/tasks(?:\/([^/]+))?$/);
    if (taskMatch) {
      const taskId = taskMatch[2];

      if (method === 'GET') {
        return fulfillJson(route, state.tasks);
      }

      if (method === 'POST' && !taskId) {
        state.taskCreateBody = request.postDataJSON();
        if (state.taskCreateProblem) {
          return fulfillProblem(
            route,
            422,
            'Task title is not allowed on a closed claim.',
            'Unprocessable Entity'
          );
        }
        const created = {
          id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a84',
          taskNumber: 'TSK-2026-0003',
          title: state.taskCreateBody.title,
          description: state.taskCreateBody.description,
          dueDate: state.taskCreateBody.dueDate,
          priority: state.taskCreateBody.priority,
          status: 'OPEN',
          assignedTo: state.taskCreateBody.assignedTo,
          version: 0,
          createdAt: '2026-10-20T12:00:00Z',
          updatedAt: '2026-10-20T12:00:00Z',
          completedAt: null
        };
        state.tasks = [...state.tasks, created];
        return fulfillJson(route, created, 201);
      }

      if (method === 'PATCH' && taskId) {
        state.taskPatchBody = request.postDataJSON();
        state.taskPatchPath = url.pathname;
        if (state.conflict) {
          state.conflict = false;
          return fulfillProblem(
            route,
            409,
            'Task version conflict: the task was changed by another user.'
          );
        }
        const existing = state.tasks.find((task) => task.id === taskId);
        if (!existing) {
          return fulfillProblem(route, 404, 'Task not found', 'Not Found');
        }
        const updated = {
          ...existing,
          status: state.taskPatchBody.status,
          version: (existing.version || 0) + 1,
          updatedAt: '2026-10-20T12:00:00Z',
          completedAt:
            state.taskPatchBody.status === 'COMPLETE' ? '2026-10-20T12:00:00Z' : null
        };
        state.tasks = state.tasks.map((task) => (task.id === taskId ? updated : task));
        return fulfillJson(route, updated);
      }
    }

    const notesMatch = path.match(/^\/claims\/([^/]+)\/notes$/);
    if (notesMatch) {
      if (method === 'GET') {
        return fulfillJson(route, state.notes);
      }
      if (method === 'POST') {
        state.noteCreateBody = request.postDataJSON();
        const created = {
          id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a93',
          noteNumber: 'NOT-2026-0003',
          noteType: state.noteCreateBody.noteType,
          body: state.noteCreateBody.body,
          author: state.noteCreateBody.author,
          createdAt: '2026-10-20T12:05:00Z'
        };
        state.notes = [created, ...state.notes];
        return fulfillJson(route, created, 201);
      }
    }

    if (path.endsWith('/financials') && method === 'GET') {
      return fulfillJson(route, {
        assumedClaimId: CLAIM_ID,
        tenantId: TENANT,
        currency: 'USD',
        cededPaidAmount: '0.0000',
        cededOutstandingAmount: '0.0000',
        cededReserveAmount: '12500.0000',
        cededIbnrAmount: '0.0000',
        cededIncurredAmount: '12500.0000',
        cededRecoveryAmount: '0.0000',
        netCededAmount: '12500.0000',
        cashCallAmount: '0.0000',
        advisedLossAmount: '0.0000',
        lastAdviceAt: null,
        sourceVersion: 0
      });
    }

    if (path.endsWith('/commutation') && method === 'GET') {
      return fulfillProblem(
        route,
        404,
        'No commutation has been recorded for this assumed claim.',
        'Commutation not found'
      );
    }

    if (method === 'GET') {
      return fulfillJson(route, []);
    }

    return fulfillProblem(route, 404, `No mock route for ${method} ${path}`, 'Not Found');
  });

  return state;
}

async function openDiaryTab(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Diary & Notes', exact: true }).click();
}

function assumedRequests(state) {
  return state.requests.filter((entry) =>
    entry.path.startsWith('/api/v1/assumed-claims'));
}

test('loads diary tasks and notes, marks overdue work, and preserves the ASSUMED workbench', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  await expect(page.getByRole('heading', { name: 'Diary tasks' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();

  const overdueRows = page.locator('tr.eia-diary-overdue');
  await expect(overdueRows).toHaveCount(1);
  await expect(overdueRows).toContainText('TSK-2026-0001');
  await expect(overdueRows).toContainText('Overdue');
  await expect(overdueRows).toContainText('URGENT');
  await expect(page.getByTestId(`task-overdue-${OVERDUE_TASK.id}`)).toBeVisible();

  // The completed task is not overdue and is not counted as open.
  await expect(page.getByTestId('summary-open-tasks')).toHaveText('1');
  await expect(page.getByTestId('diary-open-count')).toContainText('1 open · 1 overdue');

  // The timeline is newest first even though the API returned the older note first.
  await expect(page.getByTestId('note-item')).toHaveCount(2);
  const firstNote = page.getByTestId('note-item').first();
  await expect(firstNote).toContainText('NOT-2026-0002');
  await expect(firstNote).toContainText(NEWER_NOTE.body);
  await expect(firstNote).toContainText('DIARY');
  await expect(firstNote).toContainText('Dana Handler');
  await expect(page.getByTestId('note-item').nth(1)).toContainText(OLDER_NOTE.body);

  // The existing tabs, stepper, and book wall survive the new workspace.
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Audit', exact: true })).toBeVisible();
  await expect(page.getByTestId('claim-progress')).toBeVisible();
  await expect(page.getByLabel('Book scope')).toHaveText('ASSUMED');
  await expect(page.getByRole('heading', { name: 'Why this matters' })).toBeVisible();
  await expect(page.getByLabel('Why this matters')).toContainText('non-financial');
  await expect(page.getByLabel('Why this matters')).toContainText('attributable');
  await expect(page.getByLabel('Why this matters')).toContainText('auditable');

  expect(
    state.requests.filter((entry) => entry.method === 'GET' && entry.path.endsWith('/tasks')).length
  ).toBeGreaterThanOrEqual(2);
  expect(
    state.requests.filter((entry) => entry.method === 'GET' && entry.path.endsWith('/notes')).length
  ).toBeGreaterThanOrEqual(1);
  const scoped = assumedRequests(state);
  expect(scoped.length).toBeGreaterThan(0);
  expect(scoped.every((entry) => entry.book === 'ASSUMED')).toBeTruthy();
  expect(scoped.every((entry) => entry.tenant === TENANT)).toBeTruthy();
});

test('adds a diary task with the form payload and refreshes the task list', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Add diary task' })).toBeVisible();

  await dialog.getByLabel('Title').fill('Obtain wage loss records');
  await dialog.getByLabel('Description').fill('Request the cedent records for the 2026 loss period.');
  await dialog.getByLabel('Due date').fill('2026-12-15');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByLabel('Assignee').fill('Jordan Claims');
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();

  await expect(dialog).toBeHidden();
  expect(state.taskCreateBody).toEqual({
    title: 'Obtain wage loss records',
    description: 'Request the cedent records for the 2026 loss period.',
    dueDate: '2026-12-15',
    priority: 'HIGH',
    assignedTo: 'Jordan Claims'
  });

  await expect(page.getByText('TSK-2026-0003', { exact: true })).toBeVisible();
  await expect(page.getByText('Obtain wage loss records', { exact: true })).toBeVisible();
  expect(
    state.requests.filter((entry) => entry.method === 'GET' && entry.path.endsWith('/tasks')).length
  ).toBeGreaterThanOrEqual(2);
  expect(
    state.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/tasks'))
  ).toHaveLength(1);
  expect(
    state.requests.find(
      (entry) => entry.method === 'POST' && entry.path.endsWith('/tasks')
    )?.book
  ).toBe('ASSUMED');
});

test('completes and reopens a task with its current version and refreshes the summary', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  await expect(page.getByTestId('summary-open-tasks')).toHaveText('1');
  await page.getByRole('button', { name: 'Complete TSK-2026-0001' }).click();

  await expect(page.getByRole('button', { name: 'Reopen TSK-2026-0001' })).toBeVisible();
  expect(state.taskPatchBody).toEqual({ status: 'COMPLETE', version: 3 });
  expect(state.taskPatchPath).toBe(
    `/api/v1/assumed-claims/claims/${CLAIM_ID}/tasks/${OVERDUE_TASK.id}`
  );
  expect(
    state.requests.find(
      (entry) =>
        entry.method === 'PATCH'
        && entry.path === `/api/v1/assumed-claims/claims/${CLAIM_ID}/tasks/${OVERDUE_TASK.id}`
    )?.book
  ).toBe('ASSUMED');

  await expect(page.getByTestId('summary-open-tasks')).toHaveText('0');
  await expect(page.locator('tr.eia-diary-overdue')).toHaveCount(0);
  const completedRow = page.locator('tr', { hasText: 'TSK-2026-0001' });
  await expect(completedRow).toContainText('COMPLETE');
  await expect(completedRow).toContainText('A. Adjuster');

  await page.getByRole('button', { name: 'Reopen TSK-2026-0001' }).click();
  await expect(page.getByRole('button', { name: 'Complete TSK-2026-0001' })).toBeVisible();
  expect(state.taskPatchBody).toEqual({ status: 'OPEN', version: 4 });
  await expect(page.getByTestId('summary-open-tasks')).toHaveText('1');
});

test('adds a note with the form payload and places it at the top of the timeline', async ({ page }) => {
  const state = await installMocks(page);
  await openDiaryTab(page);

  await expect(page.getByTestId('note-item')).toHaveCount(2);
  await expect(page.getByTestId('note-item').first()).toContainText(NEWER_NOTE.body);

  await page.getByLabel('Note type').selectOption('COVERAGE');
  await page.getByLabel('Author').fill('Dana Handler');
  await page.getByLabel('Note body').fill('Coverage position confirmed with the cedent.');
  await page.getByRole('button', { name: 'Add note' }).click();

  expect(state.noteCreateBody).toEqual({
    noteType: 'COVERAGE',
    author: 'Dana Handler',
    body: 'Coverage position confirmed with the cedent.'
  });

  await expect(page.getByTestId('note-item')).toHaveCount(3);
  const firstNote = page.getByTestId('note-item').first();
  await expect(firstNote).toContainText('Coverage position confirmed with the cedent.');
  await expect(firstNote).toContainText('Dana Handler');
  await expect(firstNote).toContainText('COVERAGE');
  await expect(firstNote).toContainText('NOT-2026-0003');
  await expect(page.getByTestId('note-item').nth(1)).toContainText(NEWER_NOTE.body);
});

test('shows problem+json errors for a 409 task conflict and a rejected task', async ({ page }) => {
  const state = await installMocks(page);
  state.conflict = true;
  await openDiaryTab(page);

  await page.getByRole('button', { name: 'Complete TSK-2026-0001' }).click();

  const conflictAlert = page.getByRole('alert');
  await expect(conflictAlert).toContainText(
    'Task version conflict: the task was changed by another user.'
  );
  await expect(conflictAlert).toContainText('reload the diary');
  await expect(page.getByRole('button', { name: 'Complete TSK-2026-0001' })).toBeVisible();
  await expect(page.getByTestId('summary-open-tasks')).toHaveText('1');

  state.taskCreateProblem = true;
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Confirm ceded reserve position');
  await dialog.getByLabel('Due date').fill('2026-12-20');
  await dialog.getByRole('button', { name: 'Add task', exact: true }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText(
    'Task title is not allowed on a closed claim.'
  );
});

test('counts only open tasks in the summary and excludes cancelled work', async ({ page }) => {
  const state = await installMocks(page);
  state.tasks = [{ ...OVERDUE_TASK }, { ...COMPLETED_TASK }, { ...CANCELLED_TASK }];

  await openDiaryTab(page);

  await expect(page.getByTestId('summary-open-tasks')).toHaveText('1');
  await expect(page.getByTestId('diary-open-count')).toContainText('1 open · 1 overdue');
  await expect(page.locator('tr.eia-diary-overdue')).toHaveCount(1);

  const cancelledRow = page.locator('tr', { hasText: 'TSK-2026-0004' });
  await expect(cancelledRow).toContainText('CANCELLED');
  await expect(cancelledRow).toContainText('LOW');
  await expect(cancelledRow.getByRole('button')).toHaveCount(0);

  await page.getByRole('button', { name: 'Complete TSK-2026-0001' }).click();
  await expect(page.getByRole('button', { name: 'Reopen TSK-2026-0001' })).toBeVisible();
  await expect(page.getByTestId('summary-open-tasks')).toHaveText('0');
  await expect(page.getByTestId('diary-open-count')).toContainText('0 open · 0 overdue');
});
