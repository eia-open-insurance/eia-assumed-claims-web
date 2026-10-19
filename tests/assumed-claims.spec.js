import { test, expect } from '@playwright/test';

test('renders the assumed claims workbench and scopes requests to the ASSUMED book', async ({ page }) => {
  const seenHeaders = [];

  await page.route('**/api/v1/assumed-claims**', async (route) => {
    seenHeaders.push(route.request().headers());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '0192f3a4-5b1c-7e2d-9a3f-6c8d1e0b4a72',
          tenantId: '11111111-1111-7111-8111-111111111111',
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
        }
      ])
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Assumed Claims' })).toBeVisible();
  await expect(page.getByText('RNS-2026-0007731')).toBeVisible();
  await expect(page.getByText('CED-778')).toBeVisible();
  await expect(page.getByText('NOTIFIED')).toBeVisible();
  await expect(page.getByText('$12,500.00')).toBeVisible();

  expect(seenHeaders.length).toBeGreaterThan(0);
  expect(seenHeaders[0]['x-eia-book']).toBe('ASSUMED');
  expect(seenHeaders[0]['x-eia-tenant']).toBe('11111111-1111-7111-8111-111111111111');
});
