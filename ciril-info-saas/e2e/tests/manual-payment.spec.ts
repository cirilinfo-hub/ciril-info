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

  test('a payment with TDS deducted settles the invoice, the customer is asked for the certificate, and staff record it', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(150_000);
    const org = `PW TDS Org ${Math.random().toString(36).slice(2, 8)}`;
    const email = uniqueEmail('tdspay');
    await call('POST', 'auth/register', { firstName: 'Tara', lastName: 'Tds', email, password: CUSTOMER_PASSWORD, organisationName: org, acceptTerms: true });
    await call('POST', 'auth/verify-email', { token: new URL(await linkFromEmail(email, 'verify-email')).searchParams.get('token') });
    const token = (await call('POST', 'auth/login', { email, password: CUSTOMER_PASSWORD, portal: 'customer' }))['accessToken'] as string;
    await call('POST', 'organisation/addresses', { line1: '3 Lake Road', city: 'Pune', stateCode: '27', postalCode: '411001' }, token);
    const order = await call('POST', 'orders', { planRef: 'pw-hosting/pw-starter', billingCycle: 'YEARLY' }, token);
    const number = (order['invoice'] as { number: string }).number;
    const invoiceId = (order['invoice'] as { id: string }).id;

    const staffEmail = uniqueEmail('tdsadmin');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await staffSignIn(staff, staffEmail, secret);
    const nav = staff.getByRole('complementary', { name: 'Admin navigation' });
    await nav.getByRole('link', { name: 'Invoices' }).click();
    await staff.getByRole('searchbox', { name: 'Search invoices' }).fill(org);
    await staff.getByRole('row', { name: new RegExp(number) }).getByRole('button', { name: 'View' }).click();
    await staff.getByRole('dialog', { name: number }).getByRole('button', { name: 'Record payment' }).click();
    const pay = staff.getByRole('dialog', { name: `Record a payment for ${number}` });
    await pay.getByLabel('Reference').fill(`UTRTDS${Math.random().toString(36).slice(2, 9).toUpperCase()}`);
    await pay.getByLabel('TDS deducted (₹)').fill('100');
    await pay.getByLabel('TDS section').fill('194j');
    await expect(pay.getByTestId('received')).toContainText('Amount received'); // the total less the TDS
    await pay.getByRole('button', { name: 'Record payment' }).click();
    await expect(staff.getByText(`Payment recorded for ${number}.`)).toBeVisible();
    const tds = staff.getByRole('dialog', { name: number }).getByTestId('tds');
    await expect(tds).toContainText('TDS deducted by the customer: ₹100');
    await expect(tds).toContainText('section 194J');
    await expect(tds).toContainText('has not arrived yet');

    // The customer sees the TDS and is asked for the certificate.
    await page.goto('/portal/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome, Tara' })).toBeVisible();
    await page.goto(`/portal/invoices/${invoiceId}`);
    const mine = page.getByRole('region', { name: 'TDS' });
    await expect(mine).toContainText('₹100');
    await expect(mine).toContainText('Please send us the TDS certificate');

    // Staff record the certificate from the list of missing ones.
    await staff.getByRole('dialog', { name: number }).getByRole('button', { name: 'Close', exact: true }).last().click();
    await nav.getByRole('link', { name: 'TDS certificates' }).click();
    await staff.getByRole('searchbox', { name: 'Search TDS' }).fill(number);
    const row = staff.getByRole('row', { name: new RegExp(number) });
    await expect(row).toContainText('Missing');
    await row.getByRole('button', { name: `Record the certificate for ${number}` }).click();
    await staff.getByRole('dialog', { name: `TDS certificate for ${number}` }).getByLabel('Certificate number').fill('PWCERT1234Q2');
    await staff.getByRole('dialog', { name: `TDS certificate for ${number}` }).getByRole('button', { name: 'Record certificate' }).click();
    await expect(staff.getByText(`Certificate recorded for ${number}.`)).toBeVisible();
    await expect(staff.getByRole('row', { name: new RegExp(number) })).toHaveCount(0); // no longer missing
    await staff.getByRole('button', { name: 'Certificate missing' }).click(); // show all
    await expect(staff.getByRole('row', { name: new RegExp(number) })).toContainText('PWCERT1234Q2');
    await ctx.close();

    await page.reload();
    await expect(page.getByRole('region', { name: 'TDS' })).toContainText('We have received your TDS certificate');
  });

  test('a part payment leaves the rest due, and the customer pays just the rest online', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(150_000);
    const org = `PW Part Org ${Math.random().toString(36).slice(2, 8)}`;
    const email = uniqueEmail('partpay');
    await call('POST', 'auth/register', { firstName: 'Pia', lastName: 'Part', email, password: CUSTOMER_PASSWORD, organisationName: org, acceptTerms: true });
    await call('POST', 'auth/verify-email', { token: new URL(await linkFromEmail(email, 'verify-email')).searchParams.get('token') });
    const token = (await call('POST', 'auth/login', { email, password: CUSTOMER_PASSWORD, portal: 'customer' }))['accessToken'] as string;
    await call('POST', 'organisation/addresses', { line1: '4 River Road', city: 'Pune', stateCode: '27', postalCode: '411001' }, token);
    const order = await call('POST', 'orders', { planRef: 'pw-hosting/pw-starter', billingCycle: 'YEARLY' }, token);
    const inv = order['invoice'] as { id: string; number: string; total: string };
    const rest = (Number(inv.total) - 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const staffEmail = uniqueEmail('partadmin');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await staffSignIn(staff, staffEmail, secret);
    await staff.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Invoices' }).click();
    await staff.getByRole('searchbox', { name: 'Search invoices' }).fill(org);
    await staff.getByRole('row', { name: new RegExp(inv.number) }).getByRole('button', { name: 'View' }).click();
    await staff.getByRole('dialog', { name: inv.number }).getByRole('button', { name: 'Record payment' }).click();
    const pay = staff.getByRole('dialog', { name: `Record a payment for ${inv.number}` });
    await pay.getByLabel('Reference').fill(`UTRPART${Math.random().toString(36).slice(2, 9).toUpperCase()}`);
    await pay.getByLabel('Amount received (₹)').fill('100');
    await expect(pay.getByTestId('left-after')).toContainText(rest);
    await pay.getByRole('button', { name: 'Record payment' }).click();
    await expect(staff.getByText(`Payment recorded for ${inv.number}.`)).toBeVisible();
    // Still open: more can be recorded.
    await expect(staff.getByRole('dialog', { name: inv.number }).getByRole('button', { name: 'Record payment' })).toBeVisible();
    await ctx.close();

    await page.goto('/portal/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome, Pia' })).toBeVisible();
    await page.goto(`/portal/invoices/${inv.id}`);
    await expect(page.getByTestId('paid-so-far')).toContainText('100.00');
    await expect(page.getByTestId('still-due')).toContainText(rest);
    await page.getByRole('button', { name: new RegExp(`^Pay ₹${rest.replace(/[.,]/g, '\\$&')}`) }).click();
    await expect(page.getByText('Payment received. Your service is being set up.')).toBeVisible();
    await expect(page.getByTestId('still-due')).toHaveCount(0);
  });
});
