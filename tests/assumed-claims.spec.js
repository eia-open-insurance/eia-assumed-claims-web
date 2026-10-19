import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'ASSUMED',
  assumedClaimNumber: 'RNS-2026-0007731',
  contractId: '22222222-2222-7222-8222-222222222222',
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
async function installWorkspaceMock(page) {
  const state = {
    claims: [{ ...CLAIM }],
    advices: [],
    bordereaux: [],
    reserves: [],
    cashCalls: [],
    recoveries: [],
    disputes: [],
    commutation: null,
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
        cedentClaimNumber: body.cedentClaimNumber,
        reserveAmount: Number(body.reserveAmount),
        status: 'NOTIFIED',
        version: 0
      };
      state.claims = [created, ...state.claims];
      return fulfill(201, created);
    }

    const subresource = path.match(
      /^\/claims\/([^/]+)\/(advices|bordereaux|reserves|cash-calls|recoveries|disputes|commutation|financials|status)(?:\/([^/]+))?(?:\/(accept|resolve))?$/
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

test('renders the assumed claims workbench and scopes requests to the ASSUMED book', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Assumed Claims' })).toBeVisible();
  await expect(page.getByText('RNS-2026-0007731')).toBeVisible();
  await expect(page.getByText('CED-778')).toBeVisible();
  await expect(page.getByText('NOTIFIED')).toBeVisible();
  await expect(page.getByText('$12,500.00')).toBeVisible();

  expect(state.seenHeaders.length).toBeGreaterThan(0);
  expect(state.seenHeaders[0]['x-eia-book']).toBe('ASSUMED');
  expect(state.seenHeaders[0]['x-eia-tenant']).toBe(TENANT);
});

test('records and accepts a loss advice from the workbench', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Open RNS-2026-0007731' }).click();
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

  const adviceRequest = state.seenHeaders.find((headers) => headers['x-eia-book'] === 'ASSUMED');
  expect(adviceRequest).toBeTruthy();
  expect(state.advices[0].status).toBe('POSTED');
  expect(state.advices[0].reportedAmount).toBe('250000.0000');
});

test('adds a reserve movement and shows the derived current reserve', async ({ page }) => {
  const state = await installWorkspaceMock(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Open RNS-2026-0007731' }).click();
  await page.getByRole('tab', { name: 'Reserve history' }).click();

  await expect(page.getByRole('heading', { name: 'Current reserve' })).toBeVisible();
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
