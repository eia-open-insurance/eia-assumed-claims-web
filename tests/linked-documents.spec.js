import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
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

const DOCUMENT_A = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a80',
  tenantId: TENANT,
  documentNumber: 'DOC-2026-0000011',
  title: 'Cedent loss advice',
  documentType: 'LOSS_ADVICE',
  classification: 'CONFIDENTIAL',
  status: 'RECEIVED',
  retentionUntil: '2031-01-31',
  version: 0
};

const DOCUMENT_B = {
  id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a81',
  tenantId: TENANT,
  documentNumber: 'DOC-2026-0000012',
  title: 'Assumed contract wording',
  documentType: 'CONTRACT',
  classification: 'INTERNAL',
  status: 'ACTIVE',
  retentionUntil: '2036-01-31',
  version: 2
};

async function fulfill(route, status, body) {
  await route.fulfill({
    status,
    contentType: status === 200 ? 'application/json' : 'application/problem+json',
    body: JSON.stringify(body)
  });
}

/**
 * Serves the assumed-claims queue and workspace reads the Overview issues, and
 * records every linked-document request so a test can assert the exact query
 * and headers. `gate` holds the document response open to prove the claim
 * renders without it; `status` makes the lookup fail.
 */
async function installMock(page, options = {}) {
  const state = { documentRequests: [] };

  await page.route('**/api/v1/assumed-claims**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/assumed-claims', '');
    const method = request.method();

    if (method === 'GET' && path === '/claims') {
      await fulfill(route, 200, [CLAIM]);
      return;
    }
    if (method === 'GET' && path === `/claims/${CLAIM_ID}`) {
      await fulfill(route, 200, CLAIM);
      return;
    }
    if (method === 'GET' && path === `/claims/${CLAIM_ID}/financials`) {
      await fulfill(route, 200, {
        assumedClaimId: CLAIM_ID,
        tenantId: TENANT,
        currency: 'USD',
        cededReserveAmount: '12500.0000',
        sourceVersion: 0
      });
      return;
    }
    if (method === 'GET' && path === `/claims/${CLAIM_ID}/commutation`) {
      await fulfill(route, 404, { code: 'NOT_FOUND', message: 'No commutation recorded' });
      return;
    }
    if (method === 'GET' && path.startsWith(`/claims/${CLAIM_ID}/`)) {
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
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    state.documentRequests.push({
      method: request.method(),
      path: url.pathname,
      linkedType: url.searchParams.get('linkedType'),
      linkedId: url.searchParams.get('linkedId'),
      tenant: headers['x-eia-tenant'] || null,
      book: headers['x-eia-book'] || null
    });

    if (options.gate) await options.gate;

    if (options.status && options.status !== 200) {
      await fulfill(route, options.status, {
        code: 'EIA-DOC-5030',
        category: 'UNAVAILABLE',
        message: 'Document service is unavailable'
      });
      return;
    }

    await fulfill(route, 200, options.body === undefined ? [DOCUMENT_A, DOCUMENT_B] : options.body);
  });

  return state;
}

test('loads linked documents with the ASSUMED_CLAIM query and tenant header', async ({ page }) => {
  const state = await installMock(page);

  await page.goto('/');

  const card = page.getByTestId('documents-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: /Documents/ })).toBeVisible();
  await expect(page.getByTestId('documents-count')).toHaveText('2');
  await expect(page.getByTestId('documents-context')).toContainText('evidence');
  await expect(page.getByTestId('documents-context')).toContainText('source of truth');

  const rows = page.getByTestId('document-row');
  await expect(rows).toHaveCount(2);

  const first = rows.filter({ hasText: DOCUMENT_A.documentNumber });
  await expect(first).toContainText(DOCUMENT_A.title);
  await expect(first).toContainText(DOCUMENT_A.documentType);
  await expect(first).toContainText(DOCUMENT_A.status);
  await expect(first.getByRole('link')).toHaveAttribute('href', `/document?record=${DOCUMENT_A.id}`);

  const second = rows.filter({ hasText: DOCUMENT_B.documentNumber });
  await expect(second).toContainText(DOCUMENT_B.title);
  await expect(second.getByRole('link')).toHaveAttribute('href', `/document?record=${DOCUMENT_B.id}`);

  expect(state.documentRequests).toEqual([
    {
      method: 'GET',
      path: '/api/v1/documents',
      linkedType: 'ASSUMED_CLAIM',
      linkedId: CLAIM_ID,
      tenant: TENANT,
      book: 'ASSUMED'
    }
  ]);
});

test('accepts the {items} page envelope from the documents API', async ({ page }) => {
  await installMock(page, { body: { items: [DOCUMENT_A], total: 1 } });

  await page.goto('/');

  await expect(page.getByTestId('documents-count')).toHaveText('1');
  await expect(page.getByTestId('document-row')).toHaveCount(1);
  await expect(page.getByTestId('document-number')).toHaveText(DOCUMENT_A.documentNumber);
  await expect(page.getByTestId('document-row').getByRole('link')).toHaveAttribute(
    'href',
    `/document?record=${DOCUMENT_A.id}`
  );
});

test('shows the empty state when no documents are linked', async ({ page }) => {
  await installMock(page, { body: [] });

  await page.goto('/');

  await expect(page.getByTestId('documents-count')).toHaveText('0');
  await expect(page.getByTestId('documents-empty')).toHaveText(
    'No documents linked to this claim yet.'
  );
  await expect(page.getByTestId('document-row')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();
});

test('keeps the claim rendered when the documents lookup fails', async ({ page }) => {
  await installMock(page, { status: 503 });

  await page.goto('/');

  await expect(page.getByTestId('documents-error')).toContainText(
    'Linked documents could not be loaded'
  );
  await expect(page.getByTestId('document-row')).toHaveCount(0);

  // The claim record and its other sections are unaffected by the failure.
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claim details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Related records' })).toBeVisible();
});

test('renders the claim before the documents response arrives', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await installMock(page, { gate });

  await page.goto('/');

  await expect(page.getByTestId('documents-loading')).toBeVisible();
  await expect(page.getByTestId('documents-count')).toHaveText('—');
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();

  release();
  await expect(page.getByTestId('document-row')).toHaveCount(2);
  await expect(page.getByTestId('documents-loading')).toHaveCount(0);
});
