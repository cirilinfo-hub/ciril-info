import { expect, test } from '@playwright/test';
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
 * Regression: a customer who is already signed in must be able to add another product. "Choose Plan" on the website
 * used to point at the sign-up page, which sends signed-in people to the dashboard and drops the plan they picked.
 */
test.describe('An existing customer adds another product', () => {
  test('Choose Plan on the website leads a signed-in customer to the order review for that plan', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(120_000);
    const email = uniqueEmail('addprod');
    await call('POST', 'auth/register', { firstName: 'Ada', lastName: 'Adder', email, password: PASSWORD, organisationName: 'PW Add Product Org', acceptTerms: true });
    const link = await linkFromEmail(email, 'verify-email');
    await call('POST', 'auth/verify-email', { token: new URL(link).searchParams.get('token') });
    const token = ((await call('POST', 'auth/login', { email, password: PASSWORD, portal: 'customer' }))['accessToken']) as string;
    await call('POST', 'organisation/addresses', { line1: '2 Mill Road', city: 'Surat', stateCode: '24', postalCode: '395003' }, token);
    // Already a customer: one active service.
    const first = await call('POST', 'orders', { planRef: 'pw-hosting/pw-starter', billingCycle: 'YEARLY' }, token);
    await call('POST', `invoices/${(first['invoice'] as { id: string }).id}/pay`, {}, token);

    await page.goto('/portal/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome, Ada' })).toBeVisible();

    // From the client area there is an obvious way to add a product.
    await page.getByRole('complementary').getByRole('link', { name: 'Services' }).click();
    await expect(page.getByRole('link', { name: 'Order a new service' })).toBeVisible();

    // On the website the customer picks a different plan.
    await page.goto('/hosting/pw-hosting');
    await page.getByRole('article', { name: 'PW Pro plan' }).getByRole('link', { name: /Choose Plan/ }).click();

    // They land on the review of THAT plan, not on the dashboard.
    await expect(page.getByRole('heading', { name: 'Review your order' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /PW Pro · Yearly/ })).toBeVisible();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page).toHaveURL(/\/portal\/invoices\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: /Pay .* \(test\)/ }).click();
    await expect(page.getByText('Payment received.')).toBeVisible();

    // Both products are now on the account.
    await page.getByRole('complementary').getByRole('link', { name: 'Services' }).click();
    await expect(page.getByRole('row', { name: /PW Starter/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /PW Pro/ })).toBeVisible();
  });

  test('a visitor who is not signed in still gets the sign-up page with the plan attached', async ({ page }) => {
    await page.goto('/portal/register?plan=pw-hosting%2Fpw-pro&cycle=yearly');
    await expect(page.getByRole('heading', { name: 'Create Your Account' })).toBeVisible();
  });
});
