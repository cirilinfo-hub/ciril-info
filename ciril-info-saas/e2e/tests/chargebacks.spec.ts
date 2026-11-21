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

async function staffSignIn(page: Page, email: string, secret: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('Verification code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, E2E' })).toBeVisible();
}

/**
 * Chargebacks reach us from Razorpay's webhook, which the API tests cover against a pretend Razorpay. Here a chargeback
 * is put straight into the database on a paid test invoice, and staff find it where they would look.
 */
test.describe('Chargebacks', () => {
  test('staff see a chargeback on the dashboard and in the Chargebacks list', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(120_000);
    const email = uniqueEmail('dispute');
    await post('auth/register', { firstName: 'Dev', lastName: 'Dispute', email, password: CUSTOMER_PASSWORD, organisationName: 'PW Dispute Org', acceptTerms: true });
    const link = await linkFromEmail(email, 'verify-email');
    await post('auth/verify-email', { token: new URL(link).searchParams.get('token') });
    const token = (await post('auth/login', { email, password: CUSTOMER_PASSWORD, portal: 'customer' }))['accessToken'] as string;
    await post('organisation/addresses', { line1: '2 Fort Road', city: 'Kochi', stateCode: '32', postalCode: '682001' }, token);
    const order = await post('orders', { planRef: 'pw-hosting/pw-starter', billingCycle: 'YEARLY' }, token);
    const invoice = order['invoice'] as { id: string; number: string };
    await post(`invoices/${invoice.id}/pay`, {}, token);
    const { providerDisputeId } = fixture('add-dispute', email) as { providerDisputeId: string };

    const staffEmail = uniqueEmail('cbadmin');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'FINANCE_ADMIN') as { secret: string };
    await staffSignIn(page, staffEmail, secret);
    await expect(page.getByTestId('open-chargebacks')).toBeVisible();
    await page.getByTestId('open-chargebacks').click();

    await expect(page.getByRole('heading', { name: 'Chargebacks', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Still open' }).click();
    const row = page.getByRole('row', { name: new RegExp(invoice.number) });
    await expect(row.getByText('PW Dispute Org')).toBeVisible();
    await expect(row.getByText('PW customer does not recognise the payment')).toBeVisible();
    await expect(row.locator('.cf-badge', { hasText: 'Open' })).toBeVisible();
    await expect(row.getByText(providerDisputeId)).toBeVisible();
  });
});
