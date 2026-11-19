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

async function verifiedCustomer(email: string) {
  await post('auth/register', { firstName: 'Cora', lastName: 'Coupon', email, password: CUSTOMER_PASSWORD, organisationName: 'PW Coupon Org', acceptTerms: true });
  const link = await linkFromEmail(email, 'verify-email');
  await post('auth/verify-email', { token: new URL(link).searchParams.get('token') });
  const token = (await post('auth/login', { email, password: CUSTOMER_PASSWORD, portal: 'customer' }))['accessToken'] as string;
  await post('organisation/addresses', { line1: '9 Hill Road', city: 'Mumbai', stateCode: '27', postalCode: '400050' }, token);
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

test.describe('Coupons', () => {
  test('an admin creates a coupon and a customer uses it on an order', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');
    test.setTimeout(150_000);
    const customerEmail = uniqueEmail('coupon');
    await verifiedCustomer(customerEmail);

    // --- Admin creates the coupon
    const staffEmail = uniqueEmail('cpadmin');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
    await staffSignIn(page, staffEmail, secret);
    await page.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Coupons' }).click();
    await expect(page.getByRole('heading', { name: 'Coupons', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'New coupon' }).click();
    const dialog = page.getByRole('dialog', { name: 'New coupon' });
    await dialog.getByRole('button', { name: 'Create coupon' }).click();
    await expect(dialog.getByText('Enter a code')).toBeVisible();
    await dialog.getByLabel('Code').fill('pw-save10');
    await dialog.getByLabel('Description').fill('PW test coupon');
    await dialog.getByLabel('Percentage').fill('10');
    await dialog.getByLabel('Maximum uses').fill('5');
    await dialog.getByRole('button', { name: 'Create coupon' }).click();
    await expect(page.getByText('Coupon created.')).toBeVisible();
    const row = page.getByRole('row', { name: /PW-SAVE10/ });
    await expect(row.getByText('10% off')).toBeVisible();
    await expect(row.getByText('0 / 5')).toBeVisible();

    // --- Customer tries a wrong code, then the right one
    const ctx = await browser.newContext();
    const cust = await ctx.newPage();
    await cust.goto('/portal/login');
    await cust.getByLabel('Email address').fill(customerEmail);
    await cust.getByLabel('Password').fill(CUSTOMER_PASSWORD);
    await cust.getByRole('button', { name: 'Sign In' }).click();
    await expect(cust.getByRole('heading', { name: 'Welcome, Cora' })).toBeVisible();
    await cust.goto('/portal/order?plan=pw-hosting%2Fpw-pro&cycle=yearly');
    await expect(cust.getByRole('heading', { name: 'Review your order' })).toBeVisible();
    await expect(cust.getByText('₹1,920.00').first()).toBeVisible();

    await cust.getByLabel('Have a coupon code?').fill('NOT-A-REAL-CODE');
    await cust.getByRole('button', { name: 'Apply' }).click();
    await expect(cust.getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible();
    await expect(cust.getByRole('button', { name: 'Place order' })).toBeEnabled(); // a bad code never blocks the order

    await cust.getByLabel('Have a coupon code?').fill('pw-save10');
    await cust.getByRole('button', { name: 'Apply' }).click();
    await expect(cust.getByText('Discount (PW-SAVE10)')).toBeVisible();
    await expect(cust.getByText('−₹192.00')).toBeVisible();
    await cust.getByRole('button', { name: 'Place order' }).click();

    // --- The invoice shows the discount; the admin list shows one use
    await expect(cust).toHaveURL(/\/portal\/invoices\/[0-9a-f-]{36}$/);
    await expect(cust.getByText('Discount (PW-SAVE10)')).toBeVisible();
    await expect(cust.getByText('−₹192.00')).toBeVisible();
    await cust.screenshot({ path: 'screenshots/customer-invoice-coupon.png', fullPage: true });

    await page.reload();
    await expect(page.getByRole('row', { name: /PW-SAVE10/ }).getByText('1 / 5')).toBeVisible();
    // Turn it off: the customer's next attempt is refused.
    await page.getByRole('row', { name: /PW-SAVE10/ }).getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByText('PW-SAVE10 was turned off.')).toBeVisible();
    await expect(page.getByRole('row', { name: /PW-SAVE10/ }).getByText('Off', { exact: true })).toBeVisible();
    await ctx.close();
  });

  test('coupon pages need a staff sign-in', async ({ page }) => {
    await page.goto('/admin/coupons');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
