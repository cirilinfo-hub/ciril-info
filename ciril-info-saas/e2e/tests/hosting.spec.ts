import { expect, test, type Page } from '@playwright/test';
import { API, fixture, linkFromEmail, totp, uniqueEmail } from './support/helpers';

const CUSTOMER_PASSWORD = 'Correct-Horse-42!';
const STAFF_PASSWORD = 'Staff-Strong-Passphrase-9';

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

/** A customer with a paid hosting plan, signed in to the portal in `page`. */
async function paidHostingCustomer(page: Page, label: string) {
  const email = uniqueEmail(label);
  await call('POST', 'auth/register', { firstName: 'Hana', lastName: 'Host', email, password: CUSTOMER_PASSWORD, organisationName: `PW Hosting Org ${label}`, acceptTerms: true });
  const link = await linkFromEmail(email, 'verify-email');
  await call('POST', 'auth/verify-email', { token: new URL(link).searchParams.get('token') });
  const token = ((await call('POST', 'auth/login', { email, password: CUSTOMER_PASSWORD, portal: 'customer' }))['accessToken']) as string;
  await call('POST', 'organisation/addresses', { line1: '4 River Road', city: 'Pune', stateCode: '27', postalCode: '411001' }, token);
  const order = await call('POST', 'orders', { planRef: 'pw-hosting/pw-starter', billingCycle: 'YEARLY' }, token);
  await call('POST', `invoices/${(order['invoice'] as { id: string }).id}/pay`, {}, token);
  await page.goto('/portal/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Hana' })).toBeVisible();
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

test.describe('Hosting', () => {
  test('a customer sets up hosting, it comes online by itself, and staff can suspend and restore it', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');
    test.setTimeout(180_000);
    const domain = `pw-site-${Date.now()}.example.com`;
    await paidHostingCustomer(page, 'host');

    // --- Customer: the paid plan is waiting for a domain
    await page.getByRole('complementary').getByRole('link', { name: 'Hosting' }).click();
    await expect(page.getByRole('heading', { name: 'Hosting', level: 1 })).toBeVisible();
    await expect(page.getByText('Ready to set up')).toBeVisible();
    await page.getByRole('button', { name: 'Set up hosting' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set up hosting' });
    await dialog.getByRole('button', { name: 'Set up hosting' }).click();
    await expect(dialog.getByText('Enter a domain such as example.com')).toBeVisible();
    await dialog.getByLabel('Domain name').fill('not a domain');
    await dialog.getByRole('button', { name: 'Set up hosting' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Enter a domain name such as example.com.');
    await dialog.getByLabel('Domain name').fill(`https://WWW.${domain.toUpperCase()}/`);
    await dialog.getByRole('button', { name: 'Set up hosting' }).click();

    // --- It appears as "Setting up" and turns Active without a reload (the worker does the job)
    const row = page.getByRole('row', { name: new RegExp(domain) });
    await expect(row).toBeVisible();
    await expect(row.locator('.cf-badge', { hasText: 'Active' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Ready to set up')).toHaveCount(0);
    await expect(row).not.toContainText(/pkg|mock-server|panel/i); // no panel details for the customer

    // --- Staff see it, suspend it with a reason, and restore it
    const staffEmail = uniqueEmail('hostadmin');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await staffSignIn(staff, staffEmail, secret);
    await staff.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Hosting' }).click();
    await staff.getByRole('searchbox', { name: 'Search hosting' }).fill(domain);
    const srow = staff.getByRole('row', { name: new RegExp(domain) });
    await expect(srow.locator('.cf-badge', { hasText: 'Active' })).toBeVisible();
    await srow.getByRole('button', { name: 'View' }).click();
    const detail = staff.getByRole('dialog', { name: domain });
    await expect(detail.getByText('Work done on this account')).toBeVisible();
    await expect(detail.getByRole('row', { name: /CREATE/ })).toContainText('SUCCEEDED');
    await detail.getByRole('button', { name: 'Suspend' }).click();
    const confirm = staff.getByRole('dialog', { name: `Suspend ${domain}?` });
    await confirm.getByRole('button', { name: 'Suspend' }).click();
    await expect(confirm.getByText('Enter')).toBeVisible();
    await confirm.getByLabel('Reason').fill('PW abuse report under review');
    await confirm.getByRole('button', { name: 'Suspend' }).click();
    await expect(staff.getByText(`Suspending ${domain}.`)).toBeVisible();

    // The customer's page follows, with the reason.
    // The worker acts within a few seconds; reload until the page shows it.
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole('row', { name: new RegExp(domain) }).locator('.cf-badge', { hasText: 'Suspended' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 40_000 });
    await expect(page.getByText('Suspended: PW abuse report under review')).toBeVisible();

    await staff.reload();
    await staff.getByRole('searchbox', { name: 'Search hosting' }).fill(domain);
    await expect(staff.getByRole('row', { name: new RegExp(domain) }).locator('.cf-badge', { hasText: 'Suspended' })).toBeVisible({ timeout: 10_000 });
    await staff.getByRole('row', { name: new RegExp(domain) }).getByRole('button', { name: 'View' }).click();
    await staff.getByRole('dialog', { name: domain }).getByRole('button', { name: 'Restore' }).click();
    await expect(staff.getByText(`Restoring ${domain}.`)).toBeVisible();
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole('row', { name: new RegExp(domain) }).locator('.cf-badge', { hasText: 'Active' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 40_000 });
    await page.screenshot({ path: 'screenshots/customer-hosting.png', fullPage: true });
    await ctx.close();
  });

  test('when the panel refuses, the customer is reassured and staff see the reason', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(150_000);
    const domain = `pw-bad-${Date.now()}.fail.test`;
    await paidHostingCustomer(page, 'hostfail');
    await page.getByRole('complementary').getByRole('link', { name: 'Hosting' }).click();
    await page.getByRole('button', { name: 'Set up hosting' }).click();
    await page.getByRole('dialog', { name: 'Set up hosting' }).getByLabel('Domain name').fill(domain);
    await page.getByRole('dialog', { name: 'Set up hosting' }).getByRole('button', { name: 'Set up hosting' }).click();
    const row = page.getByRole('row', { name: new RegExp(domain) });
    await expect(row.locator('.cf-badge', { hasText: 'Needs attention' })).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText('Our team has been told');
    await expect(row).not.toContainText('refused'); // no panel wording for the customer

    const staffEmail = uniqueEmail('hostadmin2');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await staffSignIn(staff, staffEmail, secret);
    await staff.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Hosting' }).click();
    await staff.getByRole('searchbox', { name: 'Search hosting' }).fill(domain);
    const srow = staff.getByRole('row', { name: new RegExp(domain) });
    await expect(srow.locator('.cf-badge', { hasText: 'Failed' })).toBeVisible();
    await expect(srow).toContainText('The panel refused this domain.');
    await ctx.close();
  });

  test('hosting pages need a sign-in', async ({ page }) => {
    await page.goto('/portal/hosting');
    await expect(page).toHaveURL(/\/portal\/login/);
    await page.goto('/admin/hosting');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
