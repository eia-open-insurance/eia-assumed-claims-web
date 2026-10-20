import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
const SECOND_CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a73';
const THIRD_CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a74';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';

/**
 * Directory fixture: people carry role/email/team codes, teams carry the
 * code/label pairs the dropdown must show. Dana has no routing teams so the
 * dialog must fall back to the complete team list for her.
 */
const DIRECTORY = {
  people: [
    {
      id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0d01',
      displayName: 'A. Adjuster',
      email: 'a.adjuster@example.com',
      role: 'Senior assumed claims adjuster',
      teams: ['ASSUMED_CLAIMS', 'MAJOR_LOSS']
    },
    {
      id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0d02',
      displayName: 'Jordan Blake',
      email: 'jordan.blake@example.com',
      role: 'Ceded reinsurance adjuster',
      teams: ['CEDED_RE']
    },
    {
      id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0d03',
      displayName: 'Riley Adjuster',
      email: 'riley.adjuster@example.com',
      role: 'Recovery adjuster',
      teams: ['RECOVERY']
    },
    {
      id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0d04',
      displayName: 'Morgan Supervisor',
      email: 'morgan.supervisor@example.com',
      role: 'Supervisory adjuster',
      teams: ['SUPERVISORY']
    },
    {
      id: '0192f3a4-2b7e-7d1f-a9c4-3e8b5f0d05',
      displayName: 'Dana Multi',
      email: 'dana.multi@example.com',
      role: 'Litigation adjuster',
      teams: []
    }
  ],
  teams: [
    { code: 'ASSUMED_CLAIMS', label: 'Assumed claims' },
    { code: 'CEDED_RE', label: 'Ceded reinsurance' },
    { code: 'MAJOR_LOSS', label: 'Major loss' },
    { code: 'LITIGATION', label: 'Litigation' },
    { code: 'RECOVERY', label: 'Recovery' },
    { code: 'SUPERVISORY', label: 'Supervisory' }
  ]
};

function claim(overrides = {}) {
  return {
    id: CLAIM_ID,
    tenantId: TENANT,
    businessBook: 'ASSUMED',
    assumedClaimNumber: 'RNS-2026-0007731',
    contractId: CONTRACT_ID,
    cedentClaimNumber: 'CED-778',
    status: 'OPEN',
    lossDate: '2026-09-01',
    reportDate: '2026-09-02',
    reserveAmount: 12500.0,
    reserveCurrency: 'USD',
    assignedAdjuster: null,
    assignedTeam: null,
    assignedAt: null,
    version: 3,
    ...overrides
  };
}

/**
 * Stateful assignment mock. It serves the queue, claim read, and shared
 * directory used by the workbench, answers the assignment PATCH with
 * optimistic-concurrency checks, and can inject one concurrent reassignment so
 * the 409 path is exercised.
 */
async function installAssignmentMock(page, options = {}) {
  const state = {
    claims: options.claims || [claim()],
    conflictOnce: options.conflictOnce || null,
    directory: options.directory || DIRECTORY,
    directoryFailure: options.directoryFailure || false,
    directoryCalls: 0,
    directoryRequest: null,
    audits: {},
    listRequests: 0,
    claimRequests: [],
    assignments: []
  };

  await page.route('**/api/v1/directory', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    state.directoryCalls += 1;
    state.directoryRequest = {
      method: request.method(),
      path: url.pathname,
      tenant: request.headers()['x-eia-tenant'],
      book: request.headers()['x-eia-book']
    };
    if (state.directoryFailure) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Directory unavailable' })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.directory)
    });
  });

  await page.route('**/api/v1/contracts/**', (route) => route.fulfill({
    status: 404,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: 'https://errors.eia.example/not-found',
      title: 'Not found',
      status: 404,
      detail: 'Contract lookup is not part of this mock.'
    })
  }));

  await page.route('**/api/v1/retrocessions/search**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ query: '', limit: 5, items: [] })
  }));

  await page.route('**/api/v1/assumed-claims**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/assumed-claims', '');
    const method = request.method();

    const fulfill = (status, body) => route.fulfill({
      status,
      contentType: status >= 400 ? 'application/problem+json' : 'application/json',
      body: JSON.stringify(body)
    });

    if (path === '/claims' && method === 'GET') {
      state.listRequests += 1;
      return fulfill(200, state.claims);
    }

    const claimRead = path.match(/^\/claims\/([^/]+)$/);
    if (claimRead && method === 'GET') {
      state.claimRequests.push(claimRead[1]);
      const found = state.claims.find((row) => row.id === claimRead[1]);
      return found
        ? fulfill(200, found)
        : fulfill(404, {
          type: 'https://errors.eia.example/not-found',
          title: 'Not found',
          status: 404,
          detail: `No assumed claim ${claimRead[1]}`
        });
    }

    const assignment = path.match(/^\/claims\/([^/]+)\/assignment$/);
    if (assignment && method === 'PATCH') {
      const body = request.postDataJSON();
      state.assignments.push({
        method,
        path: url.pathname,
        body,
        headers: request.headers()
      });
      const target = state.claims.find((row) => row.id === assignment[1]);
      if (!target) {
        return fulfill(404, {
          type: 'https://errors.eia.example/not-found',
          title: 'Not found',
          status: 404,
          detail: `No assumed claim ${assignment[1]}`
        });
      }

      if (state.conflictOnce) {
        const concurrent = state.conflictOnce;
        state.conflictOnce = null;
        target.assignedAdjuster = concurrent.assignedAdjuster;
        target.assignedTeam = concurrent.assignedTeam;
        target.assignedAt = '2026-10-20T14:30:00Z';
        target.version += 1;
        return fulfill(409, {
          type: 'https://errors.eia.example/eia-rns-7006',
          title: 'Version conflict',
          status: 409,
          code: 'EIA-RNS-7006',
          category: 'CONFLICT',
          message: `Assumed claim was modified by another request; expected version ${body.expectedVersion}.`,
          retryable: true,
          details: []
        });
      }

      if (body.expectedVersion !== target.version) {
        return fulfill(409, {
          type: 'https://errors.eia.example/eia-rns-7006',
          title: 'Version conflict',
          status: 409,
          code: 'EIA-RNS-7006',
          category: 'CONFLICT',
          message: `Assumed claim was modified by another request; expected version ${body.expectedVersion}.`,
          retryable: true,
          details: []
        });
      }

      target.assignedAdjuster = body.assignedAdjuster;
      target.assignedTeam = body.assignedTeam;
      target.assignedAt = '2026-10-20T15:00:00Z';
      target.version += 1;
      return fulfill(200, target);
    }

    if (path.endsWith('/financials') && method === 'GET') {
      return fulfill(200, {
        assumedClaimId: path.split('/')[2],
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
        lastAdviceAt: null
      });
    }

    if (path.endsWith('/audit') && method === 'GET') {
      const id = path.split('/')[2];
      return fulfill(200, state.audits[id] || []);
    }

    if (path.endsWith('/tasks') && method === 'GET') {
      return fulfill(200, []);
    }

    if (path.endsWith('/commutation') && method === 'GET') {
      return fulfill(404, {
        type: 'https://errors.eia.example/eia-rns-7506',
        title: 'Commutation not found',
        status: 404,
        detail: 'No commutation has been recorded for this assumed claim.'
      });
    }

    if (method === 'GET' && /\/(advices|bordereaux|reserves|cash-calls|recoveries|disputes)$/.test(path)) {
      return fulfill(200, []);
    }

    return fulfill(404, {
      type: 'https://errors.eia.example/not-found',
      title: 'Not found',
      status: 404,
      detail: `No mock route for ${method} ${path}`
    });
  });

  return state;
}

function adjusterSelect(dialog) {
  return dialog.locator('select[data-testid="assignment-assigned-adjuster"]');
}

async function openAssignment(page) {
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  return page.getByTestId('assignment-dialog');
}

test('loads the directory once and renders person options with role and email hints', async ({ page }) => {
  const state = await installAssignmentMock(page);

  await page.goto('/');
  await expect.poll(() => state.directoryCalls).toBe(1);
  expect(state.directoryRequest.method).toBe('GET');
  expect(state.directoryRequest.path).toBe('/api/v1/directory');
  // The directory is platform master data, not tenant- or book-scoped.
  expect(state.directoryRequest.tenant).toBeUndefined();
  expect(state.directoryRequest.book).toBeUndefined();

  let dialog = await openAssignment(page);
  const adjuster = adjusterSelect(dialog);
  await expect(adjuster).toBeVisible();
  await expect(adjuster).toHaveValue('A. Adjuster');
  await expect(adjuster.locator('option')).toHaveCount(DIRECTORY.people.length);

  const options = adjuster.locator('option');
  await expect(options.nth(0)).toContainText('A. Adjuster');
  await expect(options.nth(0)).toContainText('Senior assumed claims adjuster');
  await expect(options.nth(1)).toContainText('Jordan Blake');
  await expect(options.nth(1)).toContainText('Ceded reinsurance adjuster');

  const team = dialog.getByTestId('assignment-assigned-team');
  await expect(team).toHaveValue('ASSUMED_CLAIMS');
  await expect(team.locator('option')).toHaveCount(2);
  await expect(team.locator('option').nth(0)).toHaveText('Assumed claims');

  // Role/email hint sits under the selected person.
  await expect(dialog.getByTestId('assignment-adjuster-role')).toHaveText(
    'Senior assumed claims adjuster'
  );
  await expect(dialog.getByTestId('assignment-adjuster-email')).toHaveText('a.adjuster@example.com');
  await expect(dialog.getByTestId('assignment-adjuster-hint')).toHaveText(
    'Senior assumed claims adjuster · a.adjuster@example.com'
  );

  // Reopening the dialog reuses the cached directory rather than refetching.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  dialog = await openAssignment(page);
  await expect(adjusterSelect(dialog)).toBeVisible();
  expect(state.directoryCalls).toBe(1);
});

test('filters teams by the selected person and falls back to all teams', async ({ page }) => {
  await installAssignmentMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();
  const dialog = await openAssignment(page);
  const adjuster = adjusterSelect(dialog);
  const team = dialog.getByTestId('assignment-assigned-team');

  // A. Adjuster owns ASSUMED_CLAIMS and MAJOR_LOSS.
  await expect(team.locator('option')).toHaveCount(2);
  await expect(team).toHaveValue('ASSUMED_CLAIMS');

  // Jordan only owns CEDED_RE, so the select narrows and picks his first team.
  await adjuster.selectOption('Jordan Blake');
  await expect(team.locator('option')).toHaveCount(1);
  await expect(team.locator('option').nth(0)).toHaveText('Ceded reinsurance');
  await expect(team).toHaveValue('CEDED_RE');
  await expect(dialog.getByTestId('assignment-adjuster-email')).toHaveText(
    'jordan.blake@example.com'
  );

  // Riley only owns RECOVERY; the previous CEDED_RE choice is replaced.
  await adjuster.selectOption('Riley Adjuster');
  await expect(team.locator('option')).toHaveCount(1);
  await expect(team).toHaveValue('RECOVERY');

  // A person without routing teams gets the complete directory team list.
  await adjuster.selectOption('Dana Multi');
  await expect(team.locator('option')).toHaveCount(DIRECTORY.teams.length);
  await expect(team.locator('option').nth(5)).toHaveText('Supervisory');
  await expect(team).toHaveValue('RECOVERY');
});

test('shows ownership in the header, queue, summary card, and context panel', async ({ page }) => {
  await installAssignmentMock(page, {
    claims: [
      claim(),
      claim({
        id: SECOND_CLAIM_ID,
        assumedClaimNumber: 'RNS-2026-0007732',
        cedentClaimNumber: 'CED-779',
        status: 'RESERVED',
        assignedAdjuster: 'A. Adjuster',
        assignedTeam: 'ASSUMED_CLAIMS',
        assignedAt: '2026-10-18T09:30:00Z',
        version: 5
      })
    ]
  });

  await page.goto('/');

  await expect(page.getByTestId('record-assignment')).toHaveText('Unassigned');
  await expect(page.getByTestId('summary-assigned-to')).toHaveText('Unassigned');
  await expect(page.getByTestId('ownership-note')).toContainText('unassigned');
  await expect(page.getByTestId('ownership-note')).toContainText('shared assumed claims queue');

  const unassignedRow = page.getByRole('button', { name: 'Open RNS-2026-0007731' });
  await expect(unassignedRow.getByTestId('queue-assignee')).toHaveText('Unassigned');

  const assignedRow = page.getByRole('button', { name: 'Open RNS-2026-0007732' });
  await expect(assignedRow.getByTestId('queue-assignee'))
    .toHaveText('Assigned to A. Adjuster · Assumed claims');

  await assignedRow.click();
  await expect(page.getByTestId('record-assignment')).toContainText('A. Adjuster');
  await expect(page.getByTestId('record-assignment')).toContainText('Assumed claims');
  await expect(page.getByTestId('summary-assigned-to')).toHaveText('A. Adjuster');
  await expect(page.getByTestId('ownership-note')).toContainText('A. Adjuster (Assumed claims)');
  await expect(page.getByTestId('ownership-note')).toContainText('owns this claim');
});

test('assigns an assumed claim with the selected displayName, team code, and version', async ({ page }) => {
  const state = await installAssignmentMock(page);

  await page.goto('/');
  await expect(page.getByTestId('record-assignment')).toHaveText('Unassigned');
  await expect.poll(() => state.directoryCalls).toBe(1);

  const dialog = await openAssignment(page);
  await expect(dialog.getByRole('heading', { name: 'Assign claim' })).toBeVisible();
  await expect(dialog.getByTestId('assignment-current')).toContainText('Unassigned');

  const adjuster = adjusterSelect(dialog);
  const team = dialog.getByTestId('assignment-assigned-team');
  // Unassigned claims open pre-filled with the default person and their team.
  await expect(adjuster).toHaveValue('A. Adjuster');
  await expect(team).toHaveValue('ASSUMED_CLAIMS');
  await expect(dialog.getByTestId('assignment-version')).toContainText('Claim version 3');
  await expect(dialog.getByTestId('assignment-context')).toContainText(
    /does not change\s+coverage, ceded reserves, cash calls, recoveries/i
  );

  await adjuster.selectOption('Jordan Blake');
  await expect(team).toHaveValue('CEDED_RE');
  await expect(dialog.getByTestId('assignment-adjuster-hint')).toContainText(
    'Ceded reinsurance adjuster'
  );
  await dialog.getByRole('button', { name: 'Assign claim' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'assigned to' })).toContainText(
    'RNS-2026-0007731 assigned to Jordan Blake · Ceded reinsurance.'
  );
  await expect(page.getByTestId('record-assignment')).toContainText('Jordan Blake');
  await expect(page.getByTestId('record-assignment')).toContainText('Ceded reinsurance');
  await expect(page.getByTestId('summary-assigned-to')).toHaveText('Jordan Blake');
  await expect(page.getByTestId('ownership-note')).toContainText('Jordan Blake (Ceded reinsurance)');

  const row = page.getByRole('button', { name: 'Open RNS-2026-0007731' });
  await expect(row.getByTestId('queue-assignee'))
    .toHaveText('Assigned to Jordan Blake · Ceded reinsurance');

  expect(state.assignments).toHaveLength(1);
  const submitted = state.assignments[0];
  expect(submitted.method).toBe('PATCH');
  expect(submitted.path).toBe(`/api/v1/assumed-claims/claims/${CLAIM_ID}/assignment`);
  expect(submitted.body).toEqual({
    assignedAdjuster: 'Jordan Blake',
    assignedTeam: 'CEDED_RE',
    expectedVersion: 3
  });
  expect(submitted.headers['x-eia-actor']).toBe('A. Adjuster');
  expect(submitted.headers['x-eia-book']).toBe('ASSUMED');
  expect(submitted.headers['x-eia-tenant']).toBe(TENANT);
  expect(state.claims[0].version).toBe(4);

  // Reopening the dialog pre-fills the persisted owner and the new version.
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const reopened = page.getByTestId('assignment-dialog');
  await expect(adjusterSelect(reopened)).toHaveValue('Jordan Blake');
  await expect(reopened.getByTestId('assignment-assigned-team')).toHaveValue('CEDED_RE');
  await expect(reopened.getByTestId('assignment-version')).toContainText('Claim version 4');
});

test('defaults to the default adjuster when the current owner is unknown', async ({ page }) => {
  await installAssignmentMock(page, {
    claims: [
      claim({
        assignedAdjuster: 'Contractor X',
        assignedTeam: 'LITIGATION',
        assignedAt: '2026-10-18T09:30:00Z',
        version: 2
      })
    ]
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();
  const dialog = await openAssignment(page);
  const adjuster = adjusterSelect(dialog);
  const team = dialog.getByTestId('assignment-assigned-team');

  await expect(adjuster).toHaveValue('A. Adjuster');
  await expect(team).toHaveValue('ASSUMED_CLAIMS');
  await expect(team.locator('option')).toHaveCount(2);
});

test('filters the queue by assignee, team, and unassigned', async ({ page }) => {
  await installAssignmentMock(page, {
    claims: [
      claim(),
      claim({
        id: SECOND_CLAIM_ID,
        assumedClaimNumber: 'RNS-2026-0007732',
        cedentClaimNumber: 'CED-779',
        assignedAdjuster: 'A. Adjuster',
        assignedTeam: 'ASSUMED_CLAIMS',
        version: 4
      }),
      claim({
        id: THIRD_CLAIM_ID,
        assumedClaimNumber: 'RNS-2026-0007733',
        cedentClaimNumber: 'CED-780',
        assignedAdjuster: 'B. Examiner',
        assignedTeam: 'CEDED_RE',
        version: 2
      })
    ]
  });

  await page.goto('/');
  const filter = page.getByRole('searchbox', {
    name: 'Filter assumed claims by number, cedent reference, status, assignee, or team'
  });

  await filter.fill('A. Adjuster');
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007732' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007733' })).toHaveCount(0);
  await expect(page.locator('.eia-record-list-head')).toContainText('1 of 3');

  // The humanized team label is searchable alongside the stored code.
  await filter.fill('Ceded reinsurance');
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007733' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007732' })).toHaveCount(0);

  await filter.fill('CEDED_RE');
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007733' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toHaveCount(0);

  await filter.fill('Unassigned');
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007732' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007733' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007732' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007733' })).toBeVisible();
});

test('recovers from a stale assignment with a reload and retry', async ({ page }) => {
  const state = await installAssignmentMock(page, {
    claims: [
      claim({
        assignedAdjuster: 'A. Adjuster',
        assignedTeam: 'ASSUMED_CLAIMS',
        assignedAt: '2026-10-17T08:00:00Z',
        version: 2
      })
    ],
    conflictOnce: {
      assignedAdjuster: 'Morgan Supervisor',
      assignedTeam: 'SUPERVISORY'
    }
  });

  await page.goto('/');
  const dialog = await openAssignment(page);
  const adjuster = adjusterSelect(dialog);
  const team = dialog.getByTestId('assignment-assigned-team');
  await expect(adjuster).toHaveValue('A. Adjuster');

  await adjuster.selectOption('Riley Adjuster');
  await expect(team).toHaveValue('RECOVERY');
  await dialog.getByRole('button', { name: 'Assign claim' }).click();

  // The expert rejected the stale version: the dialog stays open and offers a reload.
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('assignment-stale')).toBeVisible();
  await expect(dialog.getByTestId('assignment-stale')).toContainText('changed since the assignment form was opened');
  await expect(dialog.getByRole('button', { name: 'Reload claim' })).toBeVisible();
  expect(state.assignments).toHaveLength(1);
  expect(state.assignments[0].body.expectedVersion).toBe(2);
  const listRequestsBeforeReload = state.listRequests;

  await dialog.getByRole('button', { name: 'Reload claim' }).click();

  await expect(dialog.getByTestId('assignment-status')).toContainText('Claim reloaded at version 3');
  await expect(dialog.getByTestId('assignment-current')).toContainText('Morgan Supervisor · Supervisory');
  await expect(dialog.getByTestId('assignment-version')).toContainText('Claim version 3');
  // The adjuster's typed values are preserved; only the optimistic token moves.
  await expect(adjuster).toHaveValue('Riley Adjuster');
  await expect(team).toHaveValue('RECOVERY');
  expect(state.listRequests).toBeGreaterThan(listRequestsBeforeReload);

  await dialog.getByRole('button', { name: 'Assign claim' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('record-assignment')).toContainText('Riley Adjuster');

  expect(state.assignments).toHaveLength(2);
  expect(state.assignments[1].body.expectedVersion).toBe(3);
  expect(state.claims[0].assignedAdjuster).toBe('Riley Adjuster');
  expect(state.claims[0].assignedTeam).toBe('RECOVERY');
});

test('falls back to free text and static teams when the directory is unavailable', async ({ page }) => {
  const state = await installAssignmentMock(page, { directoryFailure: true });

  await page.goto('/');
  await expect.poll(() => state.directoryCalls).toBe(1);

  const dialog = await openAssignment(page);
  const adjuster = dialog.getByTestId('assignment-assigned-adjuster');
  await expect(adjuster).toBeVisible();
  await expect(adjuster).toHaveValue('A. Adjuster');
  await expect(dialog.getByTestId('assignment-directory-fallback')).toContainText(
    'Directory unavailable'
  );
  await expect(dialog.getByTestId('assignment-directory-fallback')).toContainText(
    'Standard assignment teams'
  );

  const team = dialog.getByTestId('assignment-assigned-team');
  await expect(team.locator('option')).toHaveCount(6);
  await expect(team.locator('option').nth(0)).toHaveText('Assumed claims');
  await expect(team.locator('option').nth(5)).toHaveText('Supervisory');

  await adjuster.fill('Legacy Adjuster');
  await team.selectOption('RECOVERY');
  await dialog.getByRole('button', { name: 'Assign claim' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('record-assignment')).toContainText('Legacy Adjuster');
  expect(state.assignments).toHaveLength(1);
  expect(state.assignments[0].body).toEqual({
    assignedAdjuster: 'Legacy Adjuster',
    assignedTeam: 'RECOVERY',
    expectedVersion: 3
  });
});
