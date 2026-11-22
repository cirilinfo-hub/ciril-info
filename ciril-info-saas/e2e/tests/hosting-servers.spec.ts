import { expect, test } from '@playwright/test';
import { fixture, totp, uniqueEmail } from './support/helpers';

const STAFF_PASSWORD = 'Staff-Strong-Passphrase-9';

/**
 * The Hosting servers page. The browser-test API runs in test mode (HOSTING_PROVIDER=mock), so the page says the list is
 * not in use yet; adding a server and testing it still work. The test server does not exist, so its connection test
 * fails with a plain reason. Placement of accounts over servers is covered by the API tests.
 */
test.describe('Hosting servers', () => {
  test('a super admin adds a server, its credentials are never shown, and Test connection reports the result', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(120_000);
    const email = uniqueEmail('srvadmin');
    const { secret } = fixture('create-staff-ready', email, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
    await page.goto('/admin/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(STAFF_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByLabel('Verification code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome, E2E' })).toBeVisible();

    await page.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Hosting servers' }).click();
    await expect(page.getByRole('heading', { name: 'Hosting servers', level: 1 })).toBeVisible();
    await expect(page.getByTestId('not-in-use')).toBeVisible();

    const name = `PW Server ${Date.now()}`;
    await page.getByRole('button', { name: 'Add server' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add server' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Panel').selectOption({ label: 'Plesk' });
    await dialog.getByLabel('Server address').fill(`pw-${Date.now()}.invalid`);
    await dialog.getByLabel('Shared IPv4 address').fill('203.0.113.50');
    await dialog.getByLabel('Plesk API key').fill('pw-test-api-key-123');
    await dialog.getByRole('button', { name: 'Save server' }).click();
    await expect(page.getByText(`${name} was added.`)).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toContainText('Plesk');
    await expect(row).toContainText('0 / 500');
    await expect(row).toContainText('Not tested');
    await expect(page.getByText('pw-test-api-key-123')).toHaveCount(0);

    await row.getByRole('button', { name: `Test the connection to ${name}` }).click();
    await expect(page.getByRole('alert')).toContainText('could not be reached');
    await expect(row.getByTestId('last-check')).toContainText('could not be reached');

    // Editing keeps the saved key unless a new one is typed.
    await row.getByRole('button', { name: `Edit ${name}` }).click();
    const edit = page.getByRole('dialog', { name: `Edit ${name}` });
    await expect(edit.getByLabel('Plesk API key')).toHaveValue('');
    await edit.getByLabel('Status').selectOption({ label: 'Retired' });
    await edit.getByRole('button', { name: 'Save server' }).click();
    await expect(row.locator('.cf-badge', { hasText: 'Retired' })).toBeVisible();
  });
});
