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

test.describe('Plan change at renewal', () => {
  test('a customer schedules a plan change, sees it on the service, and withdraws it', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');
    test.setTimeout(120_000);
    const email = uniqueEmail('chg');
    await call('POST', 'auth/register', { firstName: 'Chandra', lastName: 'Changer', email, password: PASSWORD, organisationName: 'PW Change Org', acceptTerms: true });
    const link = await linkFromEmail(email, 'verify-email');
    await call('POST', 'auth/verify-email', { token: new URL(link).searchParams.get('token') });
    const token = ((await call('POST', 'auth/login', { email, password: PASSWORD, portal: 'customer' }))['accessToken']) as string;
    await call('POST', 'organisation/addresses', { line1: '3 Park Street', city: 'Kolkata', stateCode: '19', postalCode: '700016' }, token);
    // An active service on the Starter plan.
    const order = await call('POST', 'orders', { planRef: 'pw-hosting/pw-starter', billingCycle: 'YEARLY' }, token);
    await call('POST', `invoices/${(order['invoice'] as { id: string }).id}/pay`, {}, token);

    await page.goto('/portal/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome, Chandra' })).toBeVisible();
    await page.getByRole('complementary').getByRole('link', { name: 'Services' }).click();

    const row = page.getByRole('row', { name: /PW Starter/ });
    await expect(row.locator('.cf-badge', { hasText: 'Active' })).toBeVisible();
    await row.getByRole('button', { name: 'Change plan' }).click();

    const dialog = page.getByRole('dialog', { name: 'Change plan' });
    await expect(dialog.getByText('Nothing is charged now.')).toBeVisible();
    await expect(dialog.getByText('Current plan', { exact: true })).toBeVisible(); // the badge, not "Your current plan stays…"
    await expect(dialog.getByText('₹2,400.00')).toBeVisible(); // PW Pro's yearly renewal price
    await dialog.getByRole('button', { name: 'Switch to PW Pro' }).click();

    await expect(page.getByText('Your plan will change to PW Pro at your next renewal.')).toBeVisible();
    await expect(row.getByText('Changing to PW Pro at renewal')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Change plan' })).toHaveCount(0);
    await page.screenshot({ path: 'screenshots/customer-plan-change.png', fullPage: true });

    // It survives a reload, and can be withdrawn.
    await page.reload();
    await expect(page.getByRole('row', { name: /PW Starter/ }).getByText('Changing to PW Pro at renewal')).toBeVisible();
    await page.getByRole('row', { name: /PW Starter/ }).getByRole('button', { name: 'Keep current plan' }).click();
    await expect(page.getByText('The plan change was cancelled.')).toBeVisible();
    await expect(page.getByRole('row', { name: /PW Starter/ }).getByText('Changing to PW Pro at renewal')).toHaveCount(0);
    await expect(page.getByRole('row', { name: /PW Starter/ }).getByRole('button', { name: 'Change plan' })).toBeVisible();
  });
});
