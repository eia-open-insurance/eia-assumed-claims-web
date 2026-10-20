import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
const SECOND_CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a73';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';
const RETRO_ID = '33333333-3333-7333-8333-333333333333';
const CONTRACT_NUMBER = 'QS-2026-00042';
const CONTRACT_LABEL = `${CONTRACT_NUMBER} · QUOTA_SHARE`;

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

/**
 * A small stateful mock for the public Assumed Claims API. It is deliberately stateful so the
 * tests exercise the same reload-after-command behaviour as the real workbench.
 */
async function installWorkspaceMock(page, options = {}) {
  const state = {
    claims: [{ ...CLAIM }],
    archivedClaims: [],
    searches: [],
    advices: [],
    bordereaux: [],
    reserves: [],
    cashCalls: [],
    recoveries: [],
    disputes: [],
    audit: [{
      id: 'audit-1',
      tenantId: TENANT,
      assumedClaimId: CLAIM_ID,
      eventType: 'CLAIM_REGISTERED',
      actor: 'claims.adjuster@eia.example',
      detail: 'Assumed claim registered from the cedent notice.',
      occurredAt: '2026-09-02T13:00:00Z',
      sequence: 1
    }],
    commutation: null,
    contractDetail: {
      id: CONTRACT_ID,
      tenantId: TENANT,
      contractNumber: CONTRACT_NUMBER,
      contractType: 'QUOTA_SHARE',
      status: 'BOUND',
      effectiveDate: '2026-01-01',
      expirationDate: '2026-12-31',
      currency: 'USD',
      version: 1
    },
    contracts: [{
      id: CONTRACT_ID,
      type: 'CONTRACT',
      label: 'CTR-2026-00042',
      secondary: 'QUOTA_SHARE · BOUND',
      status: 'BOUND',
      href: `/contract?record=${CONTRACT_ID}`
    }],
    retrocessions: [{
      id: RETRO_ID,
      type: 'RETROCESSION',
      label: 'RET-2026-00012',
      secondary: 'ASSUMED · BOUND',
      status: 'BOUND',
      href: `/retrocession?record=${RETRO_ID}`
    }],
    contractSearches: [],
    contractDetailRequests: [],
    retroSearches: [],
    seenHeaders: []
  };

  function summary() {
    const reserve = state.reserves.filter((entry) => entry.isCurrent)
      .reduce((sum, entry) => sum + Number(entry.amount), 0);
    return {
      assumedClaimId: CLAIM_ID,
      tenantId: TENANT,
      currency: 'USD',
      cededPaidAmount: '0.0000',
      cededOutstandingAmount: '0.0000',
      cededReserveAmount: reserve.toFixed(4),
      cededIbnrAmount: '0.0000',
      cededIncurredAmount: reserve.toFixed(4),
      cededRecoveryAmount: '0.0000',
      netCededAmount: reserve.toFixed(4),
      cashCallAmount: '0.0000',
      advisedLossAmount: '0.0000',
      lastAdviceAt: null,
      sourceVersion: state.claims[0].version
    };
  }

  await page.route('**/api/v1/contracts/search**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const query = url.searchParams.get('q') || '';
    const limit = url.searchParams.get('limit') || '10';
    state.contractSearches.push({ q: query, limit, headers: request.headers() });
    const needle = query.toLowerCase();
    const items = state.contracts.filter((contract) => !needle
      || contract.label.toLowerCase().includes(needle)
      || contract.secondary.toLowerCase().includes(needle));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ query, limit: Number(limit), items })
    });
  });

  await page.route(/\/api\/v1\/contracts\/[0-9a-fA-F-]{36}$/, async (route) => {
    const request = route.request();
    state.contractDetailRequests.push({
      url: request.url(),
      headers: request.headers()
    });
    if (options.contractDetail === 'fail') {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'EIA-CTR-5030',
          category: 'UNAVAILABLE',
          message: 'Contract service is unavailable'
        })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.contractDetail)
    });
  });

  await page.route('**/api/v1/retrocessions/search**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const query = url.searchParams.get('q') || '';
    const limit = url.searchParams.get('limit') || '10';
    state.retroSearches.push({ q: query, limit, headers: request.headers() });
    const items = query.toLowerCase().includes(CONTRACT_ID.toLowerCase())
      || CONTRACT_ID.toLowerCase().includes(query.toLowerCase())
      ? state.retrocessions
      : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ query, limit: Number(limit), items })
    });
  });

  await page.route('**/api/v1/assumed-claims**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/assumed-claims', '');
    const method = request.method();
    state.seenHeaders.push(request.headers());

    const fulfill = (status, body) => route.fulfill({
      status,
      contentType: status === 404 ? 'application/problem+json' : 'application/json',
      body: JSON.stringify(body)
    });

    if (path === '/claims' && method === 'GET') {
      return fulfill(200, state.claims);
    }
    if (path === '/claims' && method === 'POST') {
      const body = request.postDataJSON();
      const created = {
        ...CLAIM,
        id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a99',
        assumedClaimNumber: 'RNS-2026-0007732',
        contractId: body.contractId || CLAIM.contractId,
        cedentClaimNumber: body.cedentClaimNumber,
        reserveAmount: Number(body.reserveAmount),
        status: 'NOTIFIED',
        version: 0
      };
      state.claims = [created, ...state.claims];
      return fulfill(201, created);
    }

    if (path === '/search' && method === 'GET') {
      const query = url.searchParams.get('q') || '';
      const limit = Number(url.searchParams.get('limit') || 10);
      state.searches.push({ q: query, limit, headers: request.headers() });
      const needle = query.toLowerCase();
      const pool = [...state.claims, ...state.archivedClaims];
      const items = pool
        .filter((claim) => claim.id === query
          || claim.assumedClaimNumber.toLowerCase().includes(needle)
          || String(claim.cedentClaimNumber || '').toLowerCase().includes(needle)
          || String(claim.contractId || '').toLowerCase().includes(needle))
        .slice(0, limit)
        .map((claim) => ({
          id: claim.id,
          type: 'ASSUMED_CLAIM',
          label: claim.assumedClaimNumber,
          secondary: `${claim.cedentClaimNumber || claim.contractId} · ${claim.status}`,
          status: claim.status,
          href: `/assumed-claims?record=${claim.id}`
        }));
      return fulfill(200, { query, limit, items });
    }

    const claimRead = path.match(/^\/claims\/([^/]+)$/);
    if (claimRead && method === 'GET') {
      const found = [...state.claims, ...state.archivedClaims]
        .find((claim) => claim.id === claimRead[1]);
      return found
        ? fulfill(200, found)
        : fulfill(404, {
          type: 'https://errors.eia.example/not-found',
          title: 'Not found',
          status: 404,
          detail: `No assumed claim ${claimRead[1]}`
        });
    }

    const subresource = path.match(
      /^\/claims\/([^/]+)\/(advices|bordereaux|reserves|cash-calls|recoveries|disputes|commutation|financials|status|audit|close)(?:\/([^/]+))?(?:\/(accept|resolve))?$/
    );

    if (!subresource) {
      return fulfill(404, {
        type: 'https://errors.eia.example/not-found',
        title: 'Not found',
        status: 404,
        code: 'EIA-RNS-7001',
        category: 'NOT_FOUND',
        detail: `No mock route for ${method} ${path}`
      });
    }

    const [, , resource, childId, action] = subresource;

    if (resource === 'financials' && method === 'GET') {
      return fulfill(200, summary());
    }

    if (resource === 'audit' && method === 'GET') {
      return fulfill(200, state.audit);
    }

    if (resource === 'advices' && method === 'GET') {
      return fulfill(200, state.advices);
    }
    if (resource === 'advices' && action === 'accept') {
      const advice = state.advices.find((entry) => entry.id === childId);
      advice.status = 'POSTED';
      advice.version += 1;
      return fulfill(200, advice);
    }
    if (resource === 'advices' && method === 'POST') {
      const body = request.postDataJSON();
      const advice = {
        id: `advice-${state.advices.length + 1}`,
        tenantId: TENANT,
        assumedClaimId: CLAIM_ID,
        adviceNumber: body.adviceNumber,
        adviceType: body.adviceType,
        adviceDate: body.adviceDate,
        receivedDate: body.adviceDate,
        reportedAmount: Number(body.reportedAmount).toFixed(4),
        paidAmount: body.paidAmount ? Number(body.paidAmount).toFixed(4) : null,
        outstandingAmount: body.outstandingAmount ? Number(body.outstandingAmount).toFixed(4) : null,
        currency: body.currency,
        cessionPct: body.cessionPct,
        status: 'RECEIVED',
        version: 1
      };
      state.advices = [advice, ...state.advices];
      return fulfill(201, advice);
    }

    if (resource === 'bordereaux' && method === 'GET') {
      return fulfill(200, state.bordereaux);
    }
    if (resource === 'bordereaux' && method === 'POST') {
      const body = request.postDataJSON();
      const batch = {
        id: 'bordereau-1',
        bordereauReference: body.bordereauReference,
        adviceDate: body.adviceDate,
        lineCount: body.lines.length,
        acceptedCount: body.lines.length,
        duplicateCount: 0,
        rejectedCount: 0,
        status: 'PROCESSED'
      };
      state.bordereaux = [batch, ...state.bordereaux];
      return fulfill(201, { batch, lines: [], replayed: false });
    }

    if (resource === 'reserves' && method === 'GET') {
      return fulfill(200, state.reserves);
    }
    if (resource === 'reserves' && method === 'POST') {
      const body = request.postDataJSON();
      state.reserves = state.reserves.map((entry) => ({ ...entry, isCurrent: false }));
      const entry = {
        id: `reserve-${state.reserves.length + 1}`,
        component: body.component,
        sequence: state.reserves.length + 1,
        amount: Number(body.amount).toFixed(4),
        currency: body.currency,
        effectiveDate: body.effectiveDate,
        reasonCode: body.reasonCode,
        reasonText: body.reasonText,
        authority: body.authority,
        authorityRequired: false,
        approvedBy: body.approvedBy,
        isCurrent: true,
        version: 1
      };
      state.reserves = [entry, ...state.reserves];
      return fulfill(201, entry);
    }

    if (resource === 'cash-calls' && method === 'GET') {
      return fulfill(200, state.cashCalls);
    }
    if (resource === 'cash-calls' && method === 'POST') {
      const body = request.postDataJSON();
      const call = {
        id: 'cash-1',
        requestNumber: 'CSH-2026-000001',
        requestedAmount: Number(body.requestedAmount).toFixed(4),
        currency: body.currency,
        dueDate: body.dueDate,
        status: body.approvedBy ? 'APPROVED' : 'SUBMITTED',
        approvalStatus: body.approvedBy ? 'APPROVED' : 'NOT_REQUIRED',
        reason: body.reason
      };
      state.cashCalls = [call, ...state.cashCalls];
      return fulfill(201, call);
    }

    if (resource === 'recoveries' && method === 'GET') {
      return fulfill(200, state.recoveries);
    }
    if (resource === 'recoveries' && method === 'POST') {
      const body = request.postDataJSON();
      const recovery = {
        id: 'recovery-1',
        recoveryType: body.recoveryType,
        amount: Number(body.amount).toFixed(4),
        currency: body.currency,
        receivedDate: body.receivedDate,
        status: body.status || 'RECEIVED'
      };
      state.recoveries = [recovery, ...state.recoveries];
      return fulfill(201, recovery);
    }

    if (resource === 'disputes' && method === 'GET') {
      return fulfill(200, state.disputes);
    }
    if (resource === 'disputes' && method === 'POST' && !action) {
      const body = request.postDataJSON();
      const dispute = {
        id: 'dispute-1',
        disputeNumber: 'DSP-2026-000001',
        disputeType: body.disputeType,
        reason: body.reason,
        contestedAmount: Number(body.contestedAmount).toFixed(4),
        currency: body.currency,
        status: 'OPEN',
        resolution: null
      };
      state.disputes = [dispute, ...state.disputes];
      return fulfill(201, dispute);
    }
    if (resource === 'disputes' && action === 'resolve') {
      const dispute = state.disputes.find((entry) => entry.id === childId);
      const body = request.postDataJSON();
      dispute.status = body.status;
      dispute.resolution = body.resolution;
      return fulfill(200, dispute);
    }

    if (resource === 'commutation' && method === 'GET') {
      if (!state.commutation) {
        return fulfill(404, {
          type: 'https://errors.eia.example/eia-rns-7506',
          title: 'Commutation not found',
          status: 404,
          code: 'EIA-RNS-7506',
          category: 'NOT_FOUND',
          detail: 'No commutation has been recorded for this assumed claim.'
        });
      }
      return fulfill(200, state.commutation);
    }

    if (resource === 'status' && method === 'POST') {
      const body = request.postDataJSON();
      const claim = state.claims.find((entry) => entry.id === CLAIM_ID);
      claim.status = body.targetStatus;
      claim.version += 1;
      return fulfill(200, claim);
    }

    if (resource === 'close' && method === 'POST') {
      const claim = state.claims.find((entry) => entry.id === CLAIM_ID);
      claim.status = 'CLOSED';
      claim.version += 1;
      state.audit = [{
        id: 'audit-2',
        tenantId: TENANT,
        assumedClaimId: CLAIM_ID,
        eventType: 'CLAIM_CLOSED',
        actor: 'claims.adjuster@eia.example',
        detail: 'Claim closed from the assumed claims workbench.',
        occurredAt: '2026-10-20T12:00:00Z',
        sequence: 2
      }, ...state.audit];
      return fulfill(200, claim);
    }

    return fulfill(404, {
      type: 'https://errors.eia.example/not-found',
      title: 'Not found',
      status: 404,
      code: 'EIA-RNS-7001',
      category: 'NOT_FOUND',
      detail: `No mock route for ${method} ${path}`
    });
  });

  return state;
}

async function pickContract(dialog) {
  const picker = dialog.getByRole('searchbox', { name: /Search contracts by number or type/ });
  await picker.fill('CTR-2026');
  await dialog.getByRole('button', { name: /CTR-2026-00042/ }).click();
}

test('renders the operational assumed claims workbench and scopes requests to the ASSUMED book', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/');

  await expect(page.getByText('Claims · Assumed book')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assumed Claims' })).toBeVisible();
  await expect(page.getByLabel('Book scope')).toHaveText('ASSUMED');

  const record = page.getByRole('button', { name: 'Open RNS-2026-0007731' });
  await expect(record).toBeVisible();
  await expect(record).toContainText('RNS-2026-0007731');
  await expect(record).toContainText('CED-778');
  await expect(record).toContainText('NOTIFIED');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();

  const summary = page.locator('.eia-summary-grid');
  await expect(summary).toContainText('Current reserve');
  await expect(summary).toContainText('Advised loss');
  await expect(summary).toContainText('Recoveries');
  await expect(summary).toContainText('Cash calls');
  await expect(page.getByText('$12,500.00')).toBeVisible();

  expect(state.seenHeaders.length).toBeGreaterThan(0);
  expect(state.seenHeaders.every((headers) => headers['x-eia-book'] === 'ASSUMED')).toBe(true);
  expect(state.seenHeaders.every((headers) => headers['x-eia-tenant'] === TENANT)).toBe(true);
});

test('registers an assumed claim from the page action instead of an always-open form', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Register assumed claim' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Register assumed claim' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Register assumed claim' })).toBeVisible();

  await pickContract(dialog);
  await expect(dialog.getByText('QUOTA_SHARE')).toBeVisible();

  await dialog.getByLabel('Cedent claim number').fill('CED-900');
  await dialog.getByLabel('Loss date').fill('2026-10-01');
  await dialog.getByLabel('Report date').fill('2026-10-02');
  await dialog.getByLabel('Reserve amount').fill('42000');
  await dialog.getByRole('button', { name: 'Create assumed claim' }).click();

  await expect(dialog).toBeHidden();
  const created = page.getByRole('button', { name: 'Open RNS-2026-0007732' });
  await expect(created).toBeVisible();
  await expect(created).toContainText('CED-900');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007732' })).toBeVisible();

  expect(state.claims).toHaveLength(2);
  expect(state.claims[0].cedentClaimNumber).toBe('CED-900');
  expect(state.claims[0].reserveAmount).toBe(42000);
  expect(state.seenHeaders.every((headers) => headers['x-eia-book'] === 'ASSUMED')).toBe(true);
});

test('records and accepts a loss advice from the new workbench tabs', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();
  await page.getByRole('tab', { name: 'Loss Advice' }).click();

  await expect(page.getByRole('heading', { name: 'Loss advice history' })).toBeVisible();
  const form = page.getByRole('form', { name: 'Record loss advice' });
  await form.getByLabel('Advice number').fill('ADV-9001');
  await form.getByLabel('Reported amount').fill('250000');
  await form.getByLabel('Cession %').fill('0.500000');
  await form.getByRole('button', { name: 'Record advice' }).click();

  await expect(page.getByText('ADV-9001')).toBeVisible();
  await expect(page.getByText('RECEIVED')).toBeVisible();

  await page.getByRole('button', { name: 'Accept ADV-9001' }).click();
  await expect(page.getByText('POSTED')).toBeVisible();

  expect(state.advices[0].status).toBe('POSTED');
  expect(state.advices[0].reportedAmount).toBe('250000.0000');
});

test('adds a reserve movement and shows the derived current reserve', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();
  await page.getByRole('tab', { name: 'Reserve History' }).click();

  await expect(page.getByRole('heading', { name: 'Reserve position' })).toBeVisible();
  await expect(page.locator('[aria-label="Current reserve total"]')).toHaveText('$0.00');

  const form = page.getByRole('form', { name: 'Change reserve' });
  await form.getByLabel('Component').selectOption('CASE');
  await form.getByLabel('Amount').fill('100000');
  await form.getByLabel('Reason').selectOption('INITIAL');
  await form.getByLabel('Authority').selectOption('ADJUSTER');
  await form.getByRole('button', { name: 'Change reserve' }).click();

  await expect(page.locator('[aria-label="Current reserve total"]')).toHaveText('$100,000.00');
  await expect(page.getByRole('cell', { name: 'CASE', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'INITIAL', exact: true })).toBeVisible();

  expect(state.reserves).toHaveLength(1);
  expect(state.reserves[0].amount).toBe('100000.0000');
  expect(state.reserves[0].isCurrent).toBe(true);
});

test('navigates every assumed claim tab, including the audit trail', async ({ page }) => {
  await installWorkspaceMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();

  const sections = [
    ['Overview', 'Claim details'],
    ['Loss Advice', 'Loss advice history'],
    ['Reserve History', 'Reserve position'],
    ['Cash Calls', 'Cash call history'],
    ['Recoveries', 'Recovery history'],
    ['Commutation', 'Commutation'],
    ['Disputes', 'Dispute register'],
    ['Audit', 'Claim audit trail']
  ];

  for (const [tabName, heading] of sections) {
    const tab = page.getByRole('tab', { name: tabName });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: tabName })).toBeVisible();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  await expect(page.getByRole('cell', { name: 'CLAIM_REGISTERED' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'claims.adjuster@eia.example' })).toBeVisible();
});

test('closes the selected assumed claim and reflects the new status', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();

  await page.getByRole('button', { name: 'Close claim' }).click();

  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toContainText('CLOSED');
  await expect(page.getByRole('button', { name: 'Close claim' })).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Audit' })).toBeVisible();

  expect(state.claims[0].status).toBe('CLOSED');
  expect(state.audit[0].eventType).toBe('CLAIM_CLOSED');
});

test('opens a deep-linked assumed claim and the create modal from the URL', async ({ page }) => {
  const state = await installWorkspaceMock(page);
  state.claims = [
    CLAIM,
    {
      ...CLAIM,
      id: SECOND_CLAIM_ID,
      assumedClaimNumber: 'RNS-2026-0007732',
      cedentClaimNumber: 'CED-779',
      status: 'OPEN'
    }
  ];

  await page.goto(`/?record=${CLAIM_ID}`);
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' }))
    .toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Open RNS-2026-0007732' }).click();
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007732' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('record')).toBe(SECOND_CLAIM_ID);

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();

  await page.goto('/?new=1');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Register assumed claim' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('new')).toBeNull();
});

test('resolves a deep link through the assumed claims search projection', async ({ page }) => {
  const state = await installWorkspaceMock(page);
  state.claims = [
    {
      ...CLAIM,
      id: SECOND_CLAIM_ID,
      assumedClaimNumber: 'RNS-2026-0007732',
      cedentClaimNumber: 'CED-779',
      status: 'OPEN'
    }
  ];
  state.archivedClaims = [CLAIM];

  await page.goto(`/?record=${CLAIM_ID}`);
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();

  expect(state.searches).toHaveLength(1);
  expect(state.searches[0].q).toBe(CLAIM_ID);
  expect(state.searches[0].limit).toBe(25);
  expect(state.searches[0].headers['x-eia-book']).toBe('ASSUMED');
  expect(state.searches[0].headers['x-eia-tenant']).toBe(TENANT);
});

test('filters the assumed claim queue by claim number, cedent reference, or status', async ({ page }) => {
  const state = await installWorkspaceMock(page);
  state.claims = [
    CLAIM,
    {
      ...CLAIM,
      id: SECOND_CLAIM_ID,
      assumedClaimNumber: 'RNS-2026-0007732',
      cedentClaimNumber: 'CED-779',
      status: 'OPEN'
    }
  ];

  await page.goto('/');
  const filter = page.getByRole('searchbox', { name: 'Filter assumed claims' });
  await expect(filter).toHaveAttribute(
    'placeholder',
    'Filter assumed claims by claim number, cedent reference, or status…'
  );

  await filter.fill('CED-779');
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007732' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toHaveCount(0);
  await expect(page.locator('.eia-record-list-head')).toContainText('1 of 2');

  await filter.fill('open');
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007732' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toHaveCount(0);

  await filter.fill('RNS-2026-0007731');
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007732' })).toHaveCount(0);

  await filter.fill('ZZZ-NO-MATCH');
  await expect(page.getByText(/No assumed claims match/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(filter).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007731' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open RNS-2026-0007732' })).toBeVisible();
});

test('uses predictive contract lookup and posts the selected contract id', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/?new=1');
  const dialog = page.getByRole('dialog');
  const picker = dialog.getByRole('searchbox', { name: /Search contracts by number or type/ });

  await picker.fill('QUOTA');
  const option = dialog.getByRole('button', { name: /CTR-2026-00042/ });
  await expect(option).toBeVisible();
  await option.click();

  await expect(dialog.getByText('CTR-2026-00042').first()).toBeVisible();
  await expect(dialog.getByText('QUOTA_SHARE')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open contract' }))
    .toHaveAttribute('href', `/contract?record=${CONTRACT_ID}`);

  await dialog.getByLabel('Cedent claim number').fill('CED-901');
  await dialog.getByLabel('Reserve amount').fill('51000');
  await dialog.getByRole('button', { name: 'Create assumed claim' }).click();
  await expect(dialog).toHaveCount(0);

  expect(state.contractSearches).toHaveLength(1);
  expect(state.contractSearches[0].q).toBe('QUOTA');
  expect(state.contractSearches[0].limit).toBe('8');
  expect(state.contractSearches[0].headers['x-eia-book']).toBe('ASSUMED');
  expect(state.contractSearches[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.claims[0].contractId).toBe(CONTRACT_ID);
  expect(state.claims[0].cedentClaimNumber).toBe('CED-901');
});

test('shows contract context, the why-this-matters panel, and related retrocessions', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();

  await expect(page.locator(`a[href="/contract?record=${CONTRACT_ID}"]`).first()).toBeVisible();
  await expect(page.getByText('Cedent reference').first()).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Why this matters' })).toBeVisible();
  const panel = page.getByLabel('Why this matters');
  await expect(panel).toContainText('coverage');
  await expect(panel).toContainText(/cessions/i);
  await expect(panel).toContainText(/recoveries/i);
  await expect(panel).toContainText('SAP FS-RI');
  await expect(panel).toContainText('system of record');
  await expect(panel).toContainText('actual reinsurance');

  const retroLink = page.getByRole('link', { name: 'Open retrocession RET-2026-00012' });
  await expect(retroLink).toBeVisible();
  await expect(retroLink).toHaveAttribute('href', `/retrocession?record=${RETRO_ID}`);

  await expect.poll(() => state.retroSearches.length).toBe(1);
  expect(state.retroSearches[0].q).toBe(CONTRACT_ID);
  expect(state.retroSearches[0].limit).toBe('5');
  expect(state.retroSearches[0].headers['x-eia-book']).toBe('ASSUMED');
  expect(state.retroSearches[0].headers['x-eia-tenant']).toBe(TENANT);
});

test('resolves the governing contract into a readable label on every cross-link', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();

  for (const testId of [
    'contract-link-header',
    'contract-link-overview',
    'contract-link-context',
    'contract-link-related'
  ]) {
    const link = page.getByTestId(testId);
    await expect(link).toHaveText(CONTRACT_LABEL);
    await expect(link).toHaveAttribute('href', `/contract?record=${CONTRACT_ID}`);
  }

  await expect.poll(() => state.contractDetailRequests.length).toBe(1);
  const request = state.contractDetailRequests[0];
  expect(new URL(request.url).pathname).toBe(`/api/v1/contracts/${CONTRACT_ID}`);
  expect(request.headers['x-eia-book']).toBe('ASSUMED');
  expect(request.headers['x-eia-tenant']).toBe(TENANT);
});

test('keeps the claim workbench rendering with a short contract id fallback', async ({ page }) => {
  const state = await installWorkspaceMock(page, { contractDetail: 'fail' });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'RNS-2026-0007731' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claim details' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');

  const shortContractId = CONTRACT_ID.slice(0, 8);
  for (const testId of [
    'contract-link-header',
    'contract-link-overview',
    'contract-link-context',
    'contract-link-related'
  ]) {
    const link = page.getByTestId(testId);
    await expect(link).toHaveText(shortContractId);
    await expect(link).toHaveAttribute('href', `/contract?record=${CONTRACT_ID}`);
  }

  await expect.poll(() => state.contractDetailRequests.length).toBe(1);
  expect(state.contractDetailRequests[0].headers['x-eia-book']).toBe('ASSUMED');
  expect(state.contractDetailRequests[0].headers['x-eia-tenant']).toBe(TENANT);
});
