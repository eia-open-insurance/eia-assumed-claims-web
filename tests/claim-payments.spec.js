import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
const CLAIM_ID_2 = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a73';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';
const PARTY_ID = '33333333-3333-7333-8333-333333333333';

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

const PAYMENT_PENDING = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a90',
  tenantId: TENANT,
  paymentNumber: 'PAY-2026-0000042',
  paymentType: 'INDEMNITY',
  status: 'PENDING_AUTHORITY',
  amount: '2500.50',
  currency: 'USD',
  payeeName: 'Meridian Manufacturing',
  payeePartyId: PARTY_ID,
  createdAt: '2026-10-15T08:00:00Z',
  updatedAt: '2026-10-15T08:00:00Z',
  sourceType: 'ASSUMED_CLAIM',
  sourceId: CLAIM_ID,
  sourceReference: CLAIM.assumedClaimNumber
};

const PAYMENT_PAID = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a91',
  tenantId: TENANT,
  paymentNumber: 'PAY-2026-0000043',
  paymentType: 'EXPENSE',
  status: 'PAID',
  amount: '15000.00',
  currency: 'USD',
  // No payeeName: the card falls back to the party id the DTO carries.
  payeePartyId: PARTY_ID,
  createdAt: '2026-09-30T11:30:00Z',
  updatedAt: '2026-10-02T11:00:00Z',
  sourceType: 'ASSUMED_CLAIM',
  sourceId: CLAIM_ID,
  sourceReference: CLAIM.assumedClaimNumber
};

const PAYMENT_CLAIM_2 = {
  ...PAYMENT_PAID,
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a92',
  paymentNumber: 'PAY-2026-0000044',
  sourceId: CLAIM_ID_2,
  sourceReference: CLAIM_2.assumedClaimNumber
};

async function fulfill(route, status, body) {
  await route.fulfill({
    status,
    contentType: status === 200 ? 'application/json' : 'application/problem+json',
    body: JSON.stringify(body)
  });
}

/**
 * Serves the assumed-claims queue, workspace reads, linked documents, and the
 * claim payments endpoint. Payment requests are recorded so a test can assert
 * the exact source query and headers; `gate` holds the payment response open to
 * prove the claim renders without it, `status` makes the lookup fail, and
 * `paymentsByClaim` scopes the response so a claim switch can be asserted.
 */
async function installMock(page, options = {}) {
  const state = { paymentRequests: [] };
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
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    const sourceId = url.searchParams.get('sourceId');
    state.paymentRequests.push({
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
        code: 'EIA-PAY-5030',
        category: 'UNAVAILABLE',
        message: 'Payment service is unavailable'
      });
      return;
    }

    if (options.paymentsByClaim) {
      await fulfill(route, 200, options.paymentsByClaim[sourceId] || []);
      return;
    }

    await fulfill(
      route,
      200,
      options.body === undefined ? [PAYMENT_PENDING, PAYMENT_PAID] : options.body
    );
  });

  return state;
}

test('loads claim payments with the ASSUMED_CLAIM source query and renders rows', async ({ page }) => {
  const state = await installMock(page);

  await page.goto('/');

  const card = page.getByTestId('payments-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: /Payments/ })).toBeVisible();
  await expect(page.getByTestId('payments-count')).toHaveText('2');
  await expect(page.getByTestId('payments-context')).toContainText(
    'Payment owns approval and execution'
  );
  await expect(page.getByTestId('payments-context')).toContainText('loss advice');
  await expect(page.getByTestId('payments-context')).toContainText('cash calls');
  await expect(page.getByTestId('payments-context')).toContainText('settlement record');

  const rows = page.getByTestId('payment-row');
  await expect(rows).toHaveCount(2);

  const pending = rows.filter({ hasText: PAYMENT_PENDING.paymentNumber });
  await expect(pending.getByTestId('payment-number')).toHaveText(PAYMENT_PENDING.paymentNumber);
  await expect(pending.getByTestId('payment-status')).toContainText('PENDING_AUTHORITY');
  await expect(pending.getByTestId('payment-amount')).toHaveText('USD 2,500.50');
  await expect(pending.getByTestId('payment-payee')).toHaveText(PAYMENT_PENDING.payeeName);
  await expect(pending.getByTestId('payment-created')).toHaveText('2026-10-15');
  await expect(pending.getByRole('link')).toHaveAttribute(
    'href',
    `/payment?record=${PAYMENT_PENDING.id}`
  );

  const paid = rows.filter({ hasText: PAYMENT_PAID.paymentNumber });
  await expect(paid.getByTestId('payment-status')).toContainText('PAID');
  await expect(paid.getByTestId('payment-amount')).toHaveText('USD 15,000.00');
  await expect(paid.getByTestId('payment-payee')).toHaveText(PARTY_ID);
  await expect(paid.getByTestId('payment-created')).toHaveText('2026-09-30');
  await expect(paid.getByRole('link')).toHaveAttribute('href', `/payment?record=${PAYMENT_PAID.id}`);

  await expect(page.getByTestId('payments-summary')).toContainText('Total paid');
  await expect(page.getByTestId('payments-paid-total')).toHaveText('USD 15,000.00');
  await expect(page.getByTestId('payments-pending-count')).toHaveText('1');

  // The card sits after the Documents card on the claim overview.
  const afterDocuments = await page.evaluate(() => {
    const documents = document.querySelector('[data-testid="documents-card"]');
    const payments = document.querySelector('[data-testid="payments-card"]');
    if (!documents || !payments) return false;
    return Boolean(documents.compareDocumentPosition(payments) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(afterDocuments).toBe(true);

  expect(state.paymentRequests).toEqual([
    {
      method: 'GET',
      path: '/api/v1/payments',
      sourceType: 'ASSUMED_CLAIM',
      sourceId: CLAIM_ID,
      tenant: TENANT,
      book: 'ASSUMED'
    }
  ]);
});

test('accepts the {items} page envelope from the payments API', async ({ page }) => {
  await installMock(page, { body: { items: [PAYMENT_PENDING], total: 1 } });

  await page.goto('/');

  await expect(page.getByTestId('payments-count')).toHaveText('1');
  await expect(page.getByTestId('payment-row')).toHaveCount(1);
  await expect(page.getByTestId('payment-number')).toHaveText(PAYMENT_PENDING.paymentNumber);
  await expect(page.getByTestId('payments-paid-total')).toHaveText('USD 0.00');
  await expect(page.getByTestId('payments-pending-count')).toHaveText('1');
});

test('shows the empty state with cash-call and settlement context', async ({ page }) => {
  await installMock(page, { body: [] });

  await page.goto('/');

  await expect(page.getByTestId('payments-count')).toHaveText('0');
  const empty = page.getByTestId('payments-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No payments recorded for this claim yet.');
  await expect(empty).toContainText('cash call');
  await expect(empty).toContainText('Payment owns approval and execution');
  await expect(empty).toContainText('settlement record');
  await expect(page.getByTestId('payment-row')).toHaveCount(0);
  await expect(page.getByTestId('payments-summary')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();
});

test('keeps the claim rendered when the payments lookup fails', async ({ page }) => {
  await installMock(page, { status: 503 });

  await page.goto('/');

  await expect(page.getByTestId('payments-error')).toContainText(
    'Linked payments could not be loaded'
  );
  await expect(page.getByTestId('payments-error')).toContainText('claim record is unaffected');
  await expect(page.getByTestId('payments-count')).toHaveText('—');
  await expect(page.getByTestId('payment-row')).toHaveCount(0);
  await expect(page.getByTestId('payments-summary')).toHaveCount(0);

  // The claim record and its other sections are unaffected by the failure.
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claim details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Related records' })).toBeVisible();
  await expect(page.getByTestId('documents-card')).toBeVisible();
});

test('renders the claim before the payments response arrives', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await installMock(page, { gate });

  await page.goto('/');

  await expect(page.getByTestId('payments-loading')).toBeVisible();
  await expect(page.getByTestId('payments-count')).toHaveText('—');
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claim details' })).toBeVisible();

  release();
  await expect(page.getByTestId('payment-row')).toHaveCount(2);
  await expect(page.getByTestId('payments-loading')).toHaveCount(0);
});

test('refetches payments for the newly selected claim', async ({ page }) => {
  const state = await installMock(page, {
    claims: [CLAIM, CLAIM_2],
    paymentsByClaim: {
      [CLAIM_ID]: [PAYMENT_PENDING],
      [CLAIM_ID_2]: [PAYMENT_CLAIM_2]
    }
  });

  await page.goto('/');

  await expect(page.getByTestId('payment-number')).toHaveText(PAYMENT_PENDING.paymentNumber);

  await page.getByRole('button', { name: `Open ${CLAIM_2.assumedClaimNumber}` }).click();

  await expect(page.getByRole('heading', { name: CLAIM_2.assumedClaimNumber })).toBeVisible();
  await expect(page.getByTestId('payment-number')).toHaveText(PAYMENT_CLAIM_2.paymentNumber);
  await expect(page.getByTestId('payments-count')).toHaveText('1');
  expect(state.paymentRequests.map((entry) => entry.sourceId)).toEqual([CLAIM_ID, CLAIM_ID_2]);
});
