import { expect, test, type Page } from '@playwright/test';
import { API, fixture, linkFromEmail, totp, uniqueEmail } from './support/helpers';

const CUSTOMER_PASSWORD = 'Correct-Horse-42!';
const STAFF_PASSWORD = 'Staff-Strong-Passphrase-9';

const post = async (path: string, body: unknown, token?: string) => {
  const res = await fetch(`${API}/api/v1/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
};

/** A customer with a verified account, an address and one unpaid order, all created through the API. */
async function customerWithUnpaidOrder(email: string, org: string) {
  await post('auth/register', { firstName: 'Bill', lastName: 'Payer', email, password: CUSTOMER_PASSWORD, organisationName: org, acceptTerms: true });
  const link = await linkFromEmail(email, 'verify-email');
  await post('auth/verify-email', { token: new URL(link).searchParams.get('token') });
  const login = await post('auth/login', { email, password: CUSTOMER_PASSWORD, portal: 'customer' });
  const token = login['accessToken'] as string;
  await post('organisation/addresses', { line1: '5 Lake Road', city: 'Pune', stateCode: '27', postalCode: '411001' }, token);
  const order = await post('orders', { planRef: 'pw-hosting/pw-pro', billingCycle: 'YEARLY' }, token);
  const invoice = order['invoice'] as { id: string; number: string };
  return { invoiceNumber: invoice.number, invoiceId: invoice.id, token };
}

async function staffSignIn(page: Page, email: string, secret: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('Verification code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, E2E' })).toBeVisible();
}

test.describe('Admin billing', () => {
  test('finance finds a customer order, sees it on the dashboard, and voids it', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');
    test.setTimeout(120_000);
    const org = `PW Bill Org ${Date.now()}`;
    const { invoiceNumber } = await customerWithUnpaidOrder(uniqueEmail('adminbill'), org);

    const staffEmail = uniqueEmail('finance');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'FINANCE_ADMIN') as { secret: string };
    await staffSignIn(page, staffEmail, secret);

    // Dashboard: billing figures are shown to a role that may read billing, with the test-mode caveat.
    await expect(page.getByText('Unpaid invoices')).toBeVisible();
    await expect(page.getByText('Active subscriptions')).toBeVisible();
    await expect(page.getByText(/test-mode payments/).or(page.getByText('paid invoice').first())).toBeVisible();

    const nav = page.getByRole('complementary', { name: 'Admin navigation' });
    await nav.getByRole('link', { name: 'Invoices' }).click();
    await page.getByRole('searchbox', { name: 'Search invoices' }).fill(org);
    const row = page.getByRole('row', { name: new RegExp(invoiceNumber) });
    await expect(row).toBeVisible();
    await expect(row.locator('.cf-badge', { hasText: 'Unpaid' })).toBeVisible();
    await row.getByRole('button', { name: 'View' }).click();

    const detail = page.getByRole('dialog', { name: invoiceNumber });
    await expect(detail.getByText('5 Lake Road, Pune, Maharashtra 411001')).toBeVisible();
    await detail.getByRole('button', { name: 'Void invoice' }).click();
    const confirm = page.getByRole('dialog', { name: `Void ${invoiceNumber}?` });
    await confirm.getByRole('button', { name: 'Void invoice' }).click();
    await expect(confirm.getByText('Enter')).toBeVisible();
    await confirm.getByLabel('Reason').fill('PW customer asked to cancel');
    await confirm.getByRole('button', { name: 'Void invoice' }).click();
    await expect(page.getByText(`${invoiceNumber} was voided.`)).toBeVisible();
    await page.getByRole('dialog', { name: invoiceNumber }).getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(row.locator('.cf-badge', { hasText: 'Cancelled' })).toBeVisible();

    // The order was cancelled with it.
    await nav.getByRole('link', { name: 'Subscriptions' }).click();
    await page.getByRole('searchbox', { name: 'Search subscriptions' }).fill(org);
    const sub = page.getByRole('row', { name: new RegExp(org) });
    await expect(sub.locator('.cf-badge', { hasText: 'Cancelled' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-subscriptions.png', fullPage: true });
  });

  test('finance refunds a paid invoice in two steps and the customer sees it', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');
    test.setTimeout(120_000);
    const org = `PW Refund Org ${Date.now()}`;
    const { invoiceNumber, invoiceId, token } = await customerWithUnpaidOrder(uniqueEmail('refund'), org);
    await post(`invoices/${invoiceId}/pay`, {}, token);

    // Finance can refund; a Support Agent has no Refund button.
    const staffEmail = uniqueEmail('finref');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'FINANCE_ADMIN') as { secret: string };
    await staffSignIn(page, staffEmail, secret);
    await page.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Invoices' }).click();
    await page.getByRole('searchbox', { name: 'Search invoices' }).fill(org);
    const row = page.getByRole('row', { name: new RegExp(invoiceNumber) });
    await expect(row.locator('.cf-badge', { hasText: 'Paid' })).toBeVisible();
    await row.getByRole('button', { name: 'View' }).click();
    await page.getByRole('dialog', { name: invoiceNumber }).getByRole('button', { name: 'Refund' }).click();

    // First: a partial refund of 100, with validation along the way.
    const refund = page.getByRole('dialog', { name: `Refund ${invoiceNumber}` });
    await expect(refund.getByText('Test-mode payment', { exact: false }).or(refund.getByText('test-mode payment'))).toBeVisible();
    await refund.getByRole('button', { name: 'Issue refund' }).click();
    await expect(refund.getByText('Enter')).toBeVisible();
    await refund.getByLabel('Amount (₹)').fill('99999');
    await refund.getByLabel('Reason').fill('PW too much');
    await refund.getByRole('button', { name: 'Issue refund' }).click();
    await expect(refund.getByRole('alert')).toContainText('At most');
    await refund.getByLabel('Amount (₹)').fill('100');
    await refund.getByLabel('Reason').fill('PW goodwill credit');
    await refund.getByRole('button', { name: 'Issue refund' }).click();
    await expect(page.getByText(`Refund issued for ${invoiceNumber}.`)).toBeVisible();
    const detail = page.getByRole('dialog', { name: invoiceNumber });
    await expect(detail.getByText('PW goodwill credit')).toBeVisible();
    await expect(row.locator('.cf-badge', { hasText: 'Paid' })).toBeVisible(); // still paid: only partly refunded

    // The customer sees it on their invoice.
    const mine = await fetch(`${API}/api/v1/invoices/${invoiceId}`, { headers: { authorization: `Bearer ${token}` } });
    const body = (await mine.json()) as { refunds: { amount: string }[] };
    expect(body.refunds.map((r) => Number(r.amount))).toEqual([100]);

    // Then the rest, cancelling the service.
    await detail.getByRole('button', { name: 'Refund' }).click();
    const rest = page.getByRole('dialog', { name: `Refund ${invoiceNumber}` });
    await rest.getByLabel('Reason').fill('PW customer left');
    await rest.getByLabel('Also cancel the service').check();
    await rest.getByRole('button', { name: 'Issue refund' }).click();
    await expect(page.getByText(`Refund issued for ${invoiceNumber}.`)).toBeVisible();
    await expect(page.getByRole('dialog', { name: invoiceNumber }).getByRole('button', { name: 'Refund' })).toHaveCount(0); // nothing left
    await page.getByRole('dialog', { name: invoiceNumber }).getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(row.locator('.cf-badge', { hasText: 'Refunded' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-refunded-invoice.png', fullPage: true });

    await page.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Subscriptions' }).click();
    await page.getByRole('searchbox', { name: 'Search subscriptions' }).fill(org);
    await expect(page.getByRole('row', { name: new RegExp(org) }).locator('.cf-badge', { hasText: 'Cancelled' })).toBeVisible();
  });

  test('a support agent sees invoices but no Refund button', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');
    test.setTimeout(120_000);
    const org = `PW NoRefund Org ${Date.now()}`;
    const { invoiceNumber, invoiceId, token } = await customerWithUnpaidOrder(uniqueEmail('norefund'), org);
    await post(`invoices/${invoiceId}/pay`, {}, token);
    const staffEmail = uniqueEmail('agentref');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPPORT_AGENT') as { secret: string };
    await staffSignIn(page, staffEmail, secret);
    await page.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Invoices' }).click();
    await page.getByRole('searchbox', { name: 'Search invoices' }).fill(org);
    await page.getByRole('row', { name: new RegExp(invoiceNumber) }).getByRole('button', { name: 'View' }).click();
    const detail = page.getByRole('dialog', { name: invoiceNumber });
    await expect(detail.getByText('Payments')).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Refund' })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Void invoice' })).toHaveCount(0);
  });

  test('billing pages need a staff sign-in', async ({ page }) => {
    await page.goto('/admin/invoices');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
