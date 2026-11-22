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
 * The page's own behaviour around Razorpay's checkout. The real Razorpay window cannot run in an automated test, and the
 * server side (orders, signatures, webhooks, refunds) is covered against a fake provider in the API tests. So here
 * `window.Razorpay` is a stand-in that reports what a customer would do, and the two payment calls are answered the
 * way a real-provider API answers them.
 */
async function signedInWithUnpaidInvoice(page: Page) {
  const email = uniqueEmail('rzpui');
  await call('POST', 'auth/register', { firstName: 'Rhea', lastName: 'Pay', email, password: PASSWORD, organisationName: 'PW Razorpay UI Org', acceptTerms: true });
  const link = await linkFromEmail(email, 'verify-email');
  await call('POST', 'auth/verify-email', { token: new URL(link).searchParams.get('token') });
  const token = ((await call('POST', 'auth/login', { email, password: PASSWORD, portal: 'customer' }))['accessToken']) as string;
  await call('POST', 'organisation/addresses', { line1: '8 Beach Road', city: 'Chennai', stateCode: '33', postalCode: '600001' }, token);
  const order = await call('POST', 'orders', { planRef: 'pw-hosting/pw-starter', billingCycle: 'YEARLY' }, token);
  const invoiceId = (order['invoice'] as { id: string }).id;

  await page.goto('/portal/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Rhea' })).toBeVisible();
  return invoiceId;
}

/** Makes the page behave as if a real provider is connected. */
async function realProviderMode(page: Page, invoiceId: string, opts: { customer: 'pays' | 'closes'; confirm: 'SUCCEEDED' | 'PENDING' | 'FAILED'; paidAfterWait?: boolean }) {
  await page.addInitScript((mode) => {
    const w = window as unknown as { Razorpay: unknown; __rzp: { opened?: Record<string, unknown> } };
    w.__rzp = {};
    w.Razorpay = function (this: { open: () => void; on: () => void }, o: { order_id: string; handler: (r: object) => void; modal: { ondismiss: () => void } }) {
      this.on = () => undefined;
      this.open = () => {
        w.__rzp.opened = o as unknown as Record<string, unknown>;
        setTimeout(() => (mode === 'closes' ? o.modal.ondismiss() : o.handler({ razorpay_payment_id: 'pay_stub1', razorpay_order_id: o.order_id, razorpay_signature: 'signature_from_razorpay_stub' })), 50);
      };
    };
  }, opts.customer);

  const confirmCalls: Record<string, unknown>[] = [];
  let paid = false;
  // The pay call is answered here, never sent on: the test API is in test mode and would really mark the invoice paid.
  await page.route('**/api/v1/invoices/*/pay', async (route: Route) => {
    await route.fulfill({
      json: {
        paymentId: 'p1', status: 'CREATED', failureReason: null, action: 'CHECKOUT', invoice: { id: invoiceId },
        checkout: { keyId: 'rzp_test_ui', orderId: 'order_ui1', amountPaise: 144000, currency: 'INR', description: 'Invoice test', name: 'Ciril Info', prefillEmail: 'x@example.test' },
      },
    }).catch(() => undefined);
  });
  await page.route('**/api/v1/invoices/*/confirm-payment', async (route: Route) => {
    confirmCalls.push(route.request().postDataJSON() as Record<string, unknown>);
    const real = await route.fetch({ url: `${API}/api/v1/invoices/${invoiceId}`, method: 'GET' }).catch(() => null);
    const inv = real ? await real.json().catch(() => ({})) : {};
    if (opts.confirm === 'PENDING') setTimeout(() => (paid = true), 1500);
    await route.fulfill({ json: { paymentId: 'p1', status: opts.confirm, failureReason: opts.confirm === 'FAILED' ? 'Card declined by the bank' : null, invoice: inv } });
  });
  // The invoice page reads as "not test mode", and becomes paid once the bank confirms.
  await page.route(`**/api/v1/invoices/${invoiceId}`, async (route: Route) => {
    const real = await route.fetch().catch(() => null);
    if (!real) return;
    const body = await real.json().catch(() => ({}));
    await route.fulfill({ json: { ...body, testMode: false, ...(paid ? { status: 'PAID', paidAt: new Date().toISOString() } : {}) } });
  });
  return confirmCalls;
}

test.describe('Paying with Razorpay (page behaviour)', () => {
  test('the customer pays in the Razorpay window; the page sends only the three signed values and shows success', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(90_000);
    const invoiceId = await signedInWithUnpaidInvoice(page);
    const confirms = await realProviderMode(page, invoiceId, { customer: 'pays', confirm: 'SUCCEEDED' });
    await page.goto(`/portal/invoices/${invoiceId}`);

    await expect(page.getByText('Ciril Info never sees your card or bank details.')).toBeVisible();
    await expect(page.getByText('Test mode.')).toHaveCount(0);
    await page.getByRole('button', { name: /^Pay ₹/ }).click();
    await expect(page.getByText('Payment received. Your service is being set up.')).toBeVisible();

    expect(confirms).toEqual([{ providerOrderId: 'order_ui1', providerPaymentId: 'pay_stub1', signature: 'signature_from_razorpay_stub' }]);
    const opened = await page.evaluate(() => (window as unknown as { __rzp: { opened: { key: string; order_id: string; amount: number; currency: string } } }).__rzp.opened);
    expect(opened).toMatchObject({ key: 'rzp_test_ui', order_id: 'order_ui1', amount: 144000, currency: 'INR' });
    // The page never held a secret: nothing in what it was given looks like one.
    expect(JSON.stringify(opened)).not.toMatch(/secret/i);
  });

  test('closing the window without paying says so plainly and does not call the server to confirm', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(90_000);
    const invoiceId = await signedInWithUnpaidInvoice(page);
    const confirms = await realProviderMode(page, invoiceId, { customer: 'closes', confirm: 'SUCCEEDED' });
    await page.goto(`/portal/invoices/${invoiceId}`);
    await page.getByRole('button', { name: /^Pay ₹/ }).click();
    await expect(page.getByText('The payment window was closed.')).toBeVisible();
    expect(confirms).toHaveLength(0);
    await expect(page.getByRole('button', { name: /^Pay ₹/ })).toBeEnabled(); // can try again
  });

  test('a payment the bank has not confirmed yet is shown as pending, then paid by itself', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(90_000);
    const invoiceId = await signedInWithUnpaidInvoice(page);
    await realProviderMode(page, invoiceId, { customer: 'pays', confirm: 'PENDING' });
    await page.goto(`/portal/invoices/${invoiceId}`);
    await page.getByRole('button', { name: /^Pay ₹/ }).click();
    await expect(page.getByText('We are waiting for your bank to confirm it.')).toBeVisible();
    await expect(page.locator('.cf-badge', { hasText: 'Paid' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Payment received. Your service is being set up.')).toBeVisible();
  });

  test('a declined payment shows the reason', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(90_000);
    const invoiceId = await signedInWithUnpaidInvoice(page);
    await realProviderMode(page, invoiceId, { customer: 'pays', confirm: 'FAILED' });
    await page.goto(`/portal/invoices/${invoiceId}`);
    await page.getByRole('button', { name: /^Pay ₹/ }).click();
    await expect(page.getByRole('alert')).toContainText('Card declined by the bank');
  });
});
