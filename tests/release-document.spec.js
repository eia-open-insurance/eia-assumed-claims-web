import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const CLAIM_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72';
const CONTRACT_ID = '22222222-2222-7222-8222-222222222222';
const APPROVER_ID = '44444444-4444-7444-8444-444444444444';
const RELEASE_DOCUMENT_ID = '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a90';
const RELEASE_DOCUMENT_NUMBER = 'DOC-2026-0000042';
const RELEASE_DOCUMENT_TITLE = 'Signed commutation release and discharge';

const CLAIM = {
  id: CLAIM_ID,
  tenantId: TENANT,
  businessBook: 'ASSUMED',
  assumedClaimNumber: 'RNS-2026-0007731',
  contractId: CONTRACT_ID,
  cedentClaimNumber: 'CED-778',
  status: 'RESERVED',
  lossDate: '2026-09-01',
  reportDate: '2026-09-02',
  reserveAmount: 12500.0,
  reserveCurrency: 'USD',
  version: 2
};

const RELEASE_DOCUMENT = {
  id: RELEASE_DOCUMENT_ID,
  tenantId: TENANT,
  documentNumber: RELEASE_DOCUMENT_NUMBER,
  title: RELEASE_DOCUMENT_TITLE,
  documentType: 'RELEASE',
  classification: 'CONFIDENTIAL',
  status: 'ACTIVE',
  version: 1
};

const COMMUTATION = {
  id: 'commutation-1',
  commutationNumber: 'COM-2026-0001',
  status: 'EXECUTED',
  offerAmount: '800000.0000',
  acceptedAmount: '750000.0000',
  currency: 'USD',
  effectiveDate: '2026-10-01',
  approvedBy: APPROVER_ID,
  approverRole: 'UNDERWRITER',
  releaseDocumentId: RELEASE_DOCUMENT_ID,
  version: 1
};

async function fulfill(route, status, body) {
  await route.fulfill({
    status,
    contentType: status === 200 || status === 201 ? 'application/json' : 'application/problem+json',
    body: JSON.stringify(body)
  });
}

/**
 * Serves the assumed-claims workbench reads the commutation tab depends on,
 * plus the Document service search/detail routes. The state records each
 * document search and detail read so the tests can assert the exact query and
 * tenant scope; `commutation` is mutated by the POST so the reload-after-write
 * path renders the saved release document.
 */
async function installMock(page, options = {}) {
  const state = {
    documents: options.documents || [RELEASE_DOCUMENT],
    commutation: options.commutation || null,
    documentDetail: options.documentDetail || 'ok',
    documentSearches: [],
    documentDetailRequests: [],
    commutationPosts: []
  };

  await page.route('**/api/v1/assumed-claims**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/assumed-claims', '');
    const method = request.method();

    if (path === '/claims' && method === 'GET') {
      return fulfill(route, 200, [CLAIM]);
    }
    if (path === `/claims/${CLAIM_ID}/commutation` && method === 'GET') {
      return state.commutation
        ? fulfill(route, 200, state.commutation)
        : fulfill(route, 404, {
          type: 'https://errors.eia.example/eia-rns-7506',
          title: 'Commutation not found',
          status: 404,
          code: 'EIA-RNS-7506',
          category: 'NOT_FOUND',
          detail: 'No commutation has been recorded for this assumed claim.'
        });
    }
    if (path === `/claims/${CLAIM_ID}/commute` && method === 'POST') {
      const body = request.postDataJSON();
      state.commutationPosts.push(body);
      state.commutation = {
        ...COMMUTATION,
        offerAmount: Number(body.offerAmount).toFixed(4),
        acceptedAmount: Number(body.acceptedAmount).toFixed(4),
        currency: body.currency,
        effectiveDate: body.effectiveDate,
        approvedBy: body.approvedBy,
        approverRole: body.approverRole,
        releaseDocumentId: body.releaseDocumentId
      };
      return fulfill(route, 201, state.commutation);
    }
    if (path === `/claims/${CLAIM_ID}/financials` && method === 'GET') {
      return fulfill(route, 200, {
        assumedClaimId: CLAIM_ID,
        tenantId: TENANT,
        currency: 'USD',
        cededReserveAmount: '12500.0000',
        sourceVersion: CLAIM.version
      });
    }
    if (path.startsWith(`/claims/${CLAIM_ID}/`) && method === 'GET') {
      return fulfill(route, 200, []);
    }
    return fulfill(route, 404, {
      type: 'https://errors.eia.example/not-found',
      title: 'Not found',
      status: 404,
      detail: `No mock route for ${method} ${path}`
    });
  });

  await page.route('**/api/v1/documents/search**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const q = url.searchParams.get('q') || '';
    const limit = url.searchParams.get('limit') || '10';
    state.documentSearches.push({ path: url.pathname, q, limit, headers: request.headers() });
    const needle = q.toLowerCase();
    const items = state.documents
      .filter((document) => !needle
        || String(document.documentNumber || '').toLowerCase().includes(needle)
        || String(document.title || '').toLowerCase().includes(needle))
      .map((document) => ({
        id: document.id,
        type: 'DOCUMENT',
        label: document.documentNumber,
        secondary: `${document.title} · ${document.status}`,
        status: document.status,
        href: `/document?record=${document.id}`
      }));
    return fulfill(route, 200, { query: q, limit: Number(limit), items });
  });

  await page.route(/\/api\/v1\/documents\/[0-9a-fA-F-]{36}$/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const documentId = path.split('/').pop();
    state.documentDetailRequests.push({ path, id: documentId, headers: request.headers() });
    if (state.documentDetail === 'fail') {
      return fulfill(route, 503, {
        code: 'EIA-DOC-5030',
        category: 'UNAVAILABLE',
        message: 'Document service is unavailable'
      });
    }
    const found = state.documents.find((document) => document.id === documentId);
    return found
      ? fulfill(route, 200, found)
      : fulfill(route, 404, { code: 'NOT_FOUND', message: 'No document' });
  });

  await page.route(/\/api\/v1\/documents(\?.*)?$/, async (route) => {
    return fulfill(route, 200, []);
  });

  await page.route('**/api/v1/contracts/search**', async (route) => {
    return fulfill(route, 200, { query: '', limit: 8, items: [] });
  });

  await page.route(/\/api\/v1\/contracts\/[0-9a-fA-F-]{36}$/, async (route) => {
    return fulfill(route, 200, {
      id: CONTRACT_ID,
      tenantId: TENANT,
      contractNumber: 'QS-2026-00042',
      contractType: 'QUOTA_SHARE',
      status: 'BOUND',
      currency: 'USD'
    });
  });

  await page.route('**/api/v1/retrocessions/search**', async (route) => {
    return fulfill(route, 200, { query: '', limit: 5, items: [] });
  });

  await page.route('**/api/v1/directory', async (route) => {
    return fulfill(route, 200, { people: [], teams: [] });
  });

  await page.route('**/api/v1/events/**', async (route) => {
    return fulfill(route, 200, { items: [] });
  });

  await page.route('**/api/v1/payments**', async (route) => {
    return fulfill(route, 200, []);
  });

  await page.route('**/api/v1/notifications**', async (route) => {
    return fulfill(route, 200, []);
  });

  return state;
}

async function openCommutationTab(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CLAIM.assumedClaimNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Commutation' }).click();
  await expect(page.getByRole('heading', { name: 'Commutation' })).toBeVisible();
}

test('searches documents predictively, shows the label and link, and posts the selected documentId', async ({ page }) => {
  const state = await installMock(page);

  await openCommutationTab(page);

  const context = page.getByTestId('release-document-context');
  await expect(context).toContainText('document record');
  await expect(context).toContainText('required');

  const picker = page.getByTestId('release-document');
  const search = picker.getByRole('searchbox', {
    name: 'Search documents by number or title…'
  });
  await search.fill('release');

  const option = picker.getByRole('button', { name: new RegExp(RELEASE_DOCUMENT_NUMBER) });
  await expect(option).toBeVisible();
  await expect(option).toContainText(RELEASE_DOCUMENT_TITLE);
  await option.click();

  await expect(page.getByTestId('release-document-label')).toHaveText(RELEASE_DOCUMENT_NUMBER);
  await expect(page.getByTestId('release-document-link')).toHaveAttribute(
    'href',
    `/document?record=${RELEASE_DOCUMENT_ID}`
  );

  expect(state.documentSearches).toHaveLength(1);
  expect(state.documentSearches[0].path).toBe('/api/v1/documents/search');
  expect(state.documentSearches[0].q).toBe('release');
  expect(state.documentSearches[0].limit).toBe('8');
  expect(state.documentSearches[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.documentSearches[0].headers['x-eia-book']).toBeUndefined();

  await page.getByLabel('Approved by').fill(APPROVER_ID);
  await page.getByRole('button', { name: 'Execute commutation' }).click();

  await expect.poll(() => state.commutationPosts.length).toBe(1);
  expect(state.commutationPosts[0].releaseDocumentId).toBe(RELEASE_DOCUMENT_ID);
  expect(state.commutationPosts[0].releaseDocumentId).not.toBe(RELEASE_DOCUMENT_NUMBER);
  expect(state.commutationPosts[0]).not.toHaveProperty('releaseDocumentLabel');

  // The reload after the write renders the saved commutation with a hydrated
  // document label and a link back to the Document record.
  const cardLink = page.getByTestId('commutation-release-document-link');
  await expect(cardLink).toHaveText(RELEASE_DOCUMENT_NUMBER);
  await expect(cardLink).toHaveAttribute('href', `/document?record=${RELEASE_DOCUMENT_ID}`);
  await expect(page.getByTestId('commutation-release-document-title')).toContainText(
    RELEASE_DOCUMENT_TITLE
  );

  await expect.poll(() => state.documentDetailRequests.length).toBe(1);
  expect(state.documentDetailRequests[0].path).toBe(`/api/v1/documents/${RELEASE_DOCUMENT_ID}`);
  expect(state.documentDetailRequests[0].id).toBe(RELEASE_DOCUMENT_ID);
  expect(state.documentDetailRequests[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.documentDetailRequests[0].headers['x-eia-book']).toBeUndefined();
});

test('hydrates the release document label and link on an existing commutation', async ({ page }) => {
  const state = await installMock(page, { commutation: { ...COMMUTATION } });

  await openCommutationTab(page);

  const link = page.getByTestId('commutation-release-document-link');
  await expect(link).toHaveText(RELEASE_DOCUMENT_NUMBER);
  await expect(link).toHaveAttribute('href', `/document?record=${RELEASE_DOCUMENT_ID}`);
  await expect(page.getByTestId('commutation-release-document-title')).toContainText(
    RELEASE_DOCUMENT_TITLE
  );

  await expect.poll(() => state.documentDetailRequests.length).toBe(1);
  expect(state.documentDetailRequests[0].path).toBe(`/api/v1/documents/${RELEASE_DOCUMENT_ID}`);
  expect(state.documentDetailRequests[0].id).toBe(RELEASE_DOCUMENT_ID);
  expect(state.documentDetailRequests[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.documentDetailRequests[0].headers['x-eia-book']).toBeUndefined();
});

test('keeps the short document id link when the label lookup fails', async ({ page }) => {
  await installMock(page, {
    commutation: { ...COMMUTATION },
    documentDetail: 'fail'
  });

  await openCommutationTab(page);

  const link = page.getByTestId('commutation-release-document-link');
  await expect(link).toHaveText(RELEASE_DOCUMENT_ID.slice(0, 8));
  await expect(link).toHaveAttribute('href', `/document?record=${RELEASE_DOCUMENT_ID}`);
  await expect(page.getByTestId('commutation-release-document-title')).toHaveCount(0);
});

test('requires a release document before the commutation can be executed', async ({ page }) => {
  const state = await installMock(page);

  await openCommutationTab(page);

  await page.getByLabel('Approved by').fill(APPROVER_ID);
  await page.getByRole('button', { name: 'Execute commutation' }).click();

  await expect(page.getByTestId('release-document-error')).toContainText(
    'Select the signed release document before executing the commutation.'
  );
  expect(state.commutationPosts).toHaveLength(0);
  await expect(page.getByRole('form', { name: 'Commute claim' })).toBeVisible();
});
