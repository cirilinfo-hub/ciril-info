import { expect, test, type Page, type Route } from '@playwright/test';
import { API, linkFromEmail, uniqueEmail } from './support/helpers';

const PASSWORD = 'Correct-Horse-42!';

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(`${API}/api/v1/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
};

/**
 * The invoice page's own behaviour around Stripe Checkout. Stripe's page cannot run in an automated test, and the server
 * side (sessions, webhooks, refunds, lookups) is covered against a pretend Stripe in the API tests. Here the test API has
 * no Stripe key, so the page is told Stripe is on, the pay call answers with a redirect back to this page as Stripe would,
 * and the confirmation call answers the way the API does.
 */
async function signedInWithUnpaidInvoice(page: Page) {
  const email = uniqueEmail('stripeui');
  await call('POST', 'auth/register', { firstName: 'Sam', lastName: 'Stripe', email, password: PASSWORD, organisationName: 'PW Stripe UI Org', acceptTerms: true });
  const link = await linkFromEmail(email, 'verify-email');
  await call('POST', 'auth/verify-email', { token: new URL(link).searchParams.get('token') });
  const token = (await call('POST', 'auth/login', { email, password: PASSWORD, portal: 'customer' }))['accessToken'] as string;
  await call('POST', 'organisation/addresses', { line1: '3 Park Street', city: 'Kolkata', stateCode: '19', postalCode: '700016' }, token);
  const order = await call('POST', 'orders', { planRef: 'pw-hosting/pw-starter', billingCycle: 'YEARLY' }, token);
  const invoiceId = (order['invoice'] as { id: string }).id;
  await page.goto('/portal/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Sam' })).toBeVisible();
  return invoiceId;
}

async function stripeMode(page: Page, invoiceId: string, confirm: 'SUCCEEDED' | 'PENDING') {
  const paid = { value: false };
  const sent: { pay: Record<string, unknown>[]; confirm: Record<string, unknown>[] } = { pay: [], confirm: [] };
  await page.route(`**/api/v1/invoices/${invoiceId}`, async (route: Route) => {
    const real = await route.fetch().catch(() => null);
    if (!real) return;
    const body = await real.json().catch(() => ({}));
    await route.fulfill({ json: { ...body, testMode: false, stripe: true, ...(paid.value ? { status: 'PAID', paidAt: new Date().toISOString() } : {}) } });
  });
  await page.route('**/api/v1/invoices/*/pay', async (route: Route) => {
    sent.pay.push(route.request().postDataJSON() as Record<string, unknown>);
    // Stripe's page would take the payment and send the customer back like this.
    await route.fulfill({ json: { paymentId: 'p1', status: 'CREATED', failureReason: null, action: 'REDIRECT', redirectUrl: `/portal/invoices/${invoiceId}?stripe=success&session=cs_test_ui123`, invoice: { id: invoiceId } } });
  });
  await page.route('**/api/v1/invoices/*/confirm-stripe', async (route: Route) => {
    sent.confirm.push(route.request().postDataJSON() as Record<string, unknown>);
    if (confirm === 'PENDING') setTimeout(() => (paid.value = true), 1500);
    else paid.value = true;
    await route.fulfill({ json: { paymentId: 'p1', status: confirm, failureReason: null, invoice: { id: invoiceId } } });
  });
  return sent;
}

test.describe('Paying with Stripe (page behaviour)', () => {
  test('the customer chooses an international card, goes to Stripe and comes back paid', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(90_000);
    const invoiceId = await signedInWithUnpaidInvoice(page);
    const sent = await stripeMode(page, invoiceId, 'SUCCEEDED');
    await page.goto(`/portal/invoices/${invoiceId}`);
    await expect(page.getByText('or with an international card on Stripe')).toBeVisible();
    await page.getByRole('button', { name: 'Pay with an international card' }).click();
    await expect(page.getByText('Payment received. Your service is being set up.')).toBeVisible();
    expect(sent.pay[0]).toMatchObject({ gateway: 'STRIPE' });
    expect(sent.confirm).toEqual([{ sessionId: 'cs_test_ui123' }]);
    await expect(page).toHaveURL(new RegExp(`/portal/invoices/${invoiceId}$`)); // the address is cleaned, so a reload does not confirm again
  });

  test('coming back before the card company confirms waits, then shows it paid', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(90_000);
    const invoiceId = await signedInWithUnpaidInvoice(page);
    await stripeMode(page, invoiceId, 'PENDING');
    await page.goto(`/portal/invoices/${invoiceId}?stripe=success&session=cs_test_ui123`);
    await expect(page.getByText('We are waiting for the card company to confirm it.')).toBeVisible();
    await expect(page.locator('.cf-badge', { hasText: 'Paid' })).toBeVisible({ timeout: 20_000 });
  });

  test('cancelling on Stripe’s page says nothing was charged', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(90_000);
    const invoiceId = await signedInWithUnpaidInvoice(page);
    const sent = await stripeMode(page, invoiceId, 'SUCCEEDED');
    await page.goto(`/portal/invoices/${invoiceId}?stripe=cancelled`);
    await expect(page.getByText('The card payment was cancelled. Nothing was charged')).toBeVisible();
    expect(sent.confirm).toHaveLength(0);
    await expect(page.getByRole('button', { name: 'Pay with an international card' })).toBeEnabled();
  });
});
