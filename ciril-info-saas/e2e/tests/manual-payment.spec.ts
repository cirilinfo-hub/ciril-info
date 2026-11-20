import { expect, test, type Page } from '@playwright/test';
import { API, fixture, linkFromEmail, totp, uniqueEmail } from './support/helpers';

const STAFF_PASSWORD = 'Staff-Strong-Passphrase-9';
const CUSTOMER_PASSWORD = 'Correct-Horse-42!';

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

async function staffSignIn(page: Page, email: string, secret: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('Verification code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, E2E' })).toBeVisible();
}

test.describe('Manual payments', () => {
  test('a customer is shown how to pay by bank transfer, staff record the payment, and the invoice is paid', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(150_000);
    const org = `PW Manual Org ${Math.random().toString(36).slice(2, 8)}`;
    const email = uniqueEmail('manualpay');
    await call('POST', 'auth/register', { firstName: 'Mina', lastName: 'Manual', email, password: CUSTOMER_PASSWORD, organisationName: org, acceptTerms: true });
    await call('POST', 'auth/verify-email', { token: new URL(await linkFromEmail(email, 'verify-email')).searchParams.get('token') });
    const token = (await call('POST', 'auth/login', { email, password: CUSTOMER_PASSWORD, portal: 'customer' }))['accessToken'] as string;
    await call('POST', 'organisation/addresses', { line1: '2 Hill Road', city: 'Pune', stateCode: '27', postalCode: '411001' }, token);

    fixture('set-bank');
    try {
      // The order is placed after the bank details exist, because an invoice keeps the details it was issued with.
      const order = await call('POST', 'orders', { planRef: 'pw-hosting/pw-starter', billingCycle: 'YEARLY' }, token);
      const number = (order['invoice'] as { number: string }).number;
      const invoiceId = (order['invoice'] as { id: string }).id;

      // The customer sees how to pay without the checkout.
      await page.goto('/portal/login');
      await page.getByLabel('Email address').fill(email);
      await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await expect(page.getByRole('heading', { name: 'Welcome, Mina' })).toBeVisible(); // signed in before going anywhere else
      await page.goto(`/portal/invoices/${invoiceId}`);
      const how = page.getByRole('region', { name: 'Pay by bank transfer or UPI' });
      await expect(how).toBeVisible();
      await expect(how).toContainText(number); // quote it as the reference
      await expect(how).toContainText('1234567890');
      await expect(how).toContainText('PWTB0000001');
      await expect(how).toContainText('pwtest@pwbank');

      // Staff record the money that arrived.
      const staffEmail = uniqueEmail('manualadmin');
      const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
      const ctx = await browser.newContext();
      const staff = await ctx.newPage();
      await staffSignIn(staff, staffEmail, secret);
      await staff.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Invoices' }).click();
      await staff.getByRole('searchbox', { name: 'Search invoices' }).fill(org);
      await staff.getByRole('row', { name: new RegExp(number) }).getByRole('button', { name: 'View' }).click();
      const detail = staff.getByRole('dialog', { name: number });
      await detail.getByRole('button', { name: 'Record payment' }).click();
      const pay = staff.getByRole('dialog', { name: `Record a payment for ${number}` });
      await pay.getByRole('button', { name: 'Record payment' }).click();
      await expect(pay.getByText(/bank reference/)).toBeVisible(); // a bank transfer needs its reference
      const utr = `UTRPW${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
      await pay.getByLabel('Reference').fill(utr);
      await pay.getByLabel('Note').fill('HDFC, credited this morning');
      await pay.getByRole('button', { name: 'Record payment' }).click();
      await expect(staff.getByText(`Payment recorded for ${number}.`)).toBeVisible();
      const done = staff.getByRole('dialog', { name: number });
      await expect(done).toContainText('Recorded by hand (Bank transfer)');
      await expect(done).toContainText(utr);
      // Once paid, there is nothing left to record.
      await expect(done.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
      await ctx.close();

      // The customer's invoice is paid, and the "how to pay" box is gone.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Pay by bank transfer or UPI' })).toHaveCount(0);
      await expect(page.locator('body')).toContainText('Paid');
    } finally {
      fixture('clear-bank');
    }
  });
});
