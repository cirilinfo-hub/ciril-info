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
 * Saving a card while paying, and managing it afterwards. The test API runs in test mode, where the saved card is a
 * pretend Visa ending 4242 and no money moves. Charging renewals to the card is covered by the API tests.
 */
test.describe('Saved cards', () => {
  test('a customer saves their card while paying, switches automatic payments off, and removes the card', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(90_000);
    const email = uniqueEmail('card');
    await call('POST', 'auth/register', { firstName: 'Kiran', lastName: 'Card', email, password: PASSWORD, organisationName: 'PW Saved Card Org', acceptTerms: true });
    const link = await linkFromEmail(email, 'verify-email');
    await call('POST', 'auth/verify-email', { token: new URL(link).searchParams.get('token') });
    const token = (await call('POST', 'auth/login', { email, password: PASSWORD, portal: 'customer' }))['accessToken'] as string;
    await call('POST', 'organisation/addresses', { line1: '4 Lake View', city: 'Kochi', stateCode: '32', postalCode: '682001' }, token);
    await call('PATCH', 'organisation', { phone: '98470 12345' }, token);
    const order = await call('POST', 'orders', { planRef: 'pw-hosting/pw-starter', billingCycle: 'YEARLY' }, token);
    const invoiceId = (order['invoice'] as { id: string }).id;

    await page.goto('/portal/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome, Kiran' })).toBeVisible();

    await page.goto('/portal/invoices');
    await expect(page.getByRole('heading', { name: 'Automatic payments' })).toBeVisible();
    await expect(page.getByTestId('no-saved-card')).toBeVisible();

    await page.goto(`/portal/invoices/${invoiceId}`);
    await page.getByRole('checkbox', { name: 'Save this card and pay renewals automatically' }).check();
    await expect(page.getByText('We charge it only for renewal invoices, a day before they are due')).toBeVisible();
    await page.getByRole('button', { name: /^Pay ₹.*\(test\)$/ }).click();
    await expect(page.getByText('Payment received, and your card is saved for automatic renewals.')).toBeVisible();
    // Once saved, the option is not offered again.
    await expect(page.getByRole('checkbox', { name: 'Save this card and pay renewals automatically' })).toHaveCount(0);

    await page.goto('/portal/invoices');
    await expect(page.getByTestId('saved-card')).toContainText('Visa ending 4242');
    await expect(page.locator('.cf-badge', { hasText: 'Automatic payments on' })).toBeVisible();

    await page.getByRole('checkbox', { name: 'Pay renewal invoices automatically' }).uncheck();
    await expect(page.getByText('Automatic payments are off. Renewal invoices will wait for you to pay them.').first()).toBeVisible();
    await expect(page.locator('.cf-badge', { hasText: 'Automatic payments off' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove card' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove this card?' });
    await dialog.getByRole('button', { name: 'Remove card' }).click();
    await expect(page.getByText('The card was removed.')).toBeVisible();
    await expect(page.getByTestId('no-saved-card')).toBeVisible();
  });
});
