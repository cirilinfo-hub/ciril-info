import { expect, test, type Page } from '@playwright/test';
import { fixture, totp, uniqueEmail } from './support/helpers';

const STAFF_PASSWORD = 'Staff-Strong-Passphrase-9';

async function staffSignIn(page: Page, email: string, secret: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('Verification code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, E2E' })).toBeVisible();
}

const letters = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6).toUpperCase().padEnd(6, 'X');

test.describe('Launch checklist and tax rates', () => {
  test('staff see what is still in test mode, follow a link to fix it, and manage GST rates', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(120_000);
    const email = uniqueEmail('launchadmin');
    const { secret } = fixture('create-staff-ready', email, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
    await staffSignIn(page, email, secret);
    const nav = page.getByRole('complementary', { name: 'Admin navigation' });

    // ── The checklist ───────────────────────────────────────────────────────────
    await nav.getByRole('link', { name: 'Launch checklist' }).click();
    await expect(page.getByRole('heading', { name: 'Launch checklist' })).toBeVisible();
    await expect(page.getByText(/things? to do/).first()).toBeVisible();
    // The browser-test environment runs on the pretend payment gateway and the local test inbox.
    const payments = page.locator('[data-check="payments"]');
    await expect(payments).toContainText('To do');
    await expect(payments).toContainText('Test mode');
    await expect(page.locator('[data-check="email"]')).toContainText('Mailpit');
    await expect(page.locator('[data-check="registrar"]')).toContainText('by hand');
    // Never a secret.
    await expect(page.locator('body')).not.toContainText(/rzp_(test|live)_/);
    // A check that can be fixed links to where.
    await page.locator('[data-check="company"]').getByRole('link', { name: 'Open Company profile' }).click();
    await expect(page).toHaveURL(/\/admin\/company$/);

    // ── Tax rates ───────────────────────────────────────────────────────────────
    await nav.getByRole('link', { name: 'Tax rates' }).click();
    await expect(page.getByRole('heading', { name: 'Tax rates' })).toBeVisible();
    await page.getByRole('button', { name: 'Add a rate' }).click();
    const add = page.getByRole('dialog', { name: 'Add a tax rate' });
    await add.getByLabel('Code').fill('pw');
    await add.getByLabel('Rate (%)').fill('150');
    await add.getByRole('button', { name: 'Add rate' }).click();
    await expect(add.getByText(/percentage from 0 to 100/)).toBeVisible();
    const code = `PW${letters()}`;
    await add.getByLabel('Code').fill(code);
    await add.getByLabel('Rate (%)').fill('5');
    await add.getByRole('button', { name: 'Add rate' }).click();
    await expect(page.getByText('Rate added.')).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toContainText('5%');
    await expect(row.locator('.cf-badge')).not.toContainText('Default'); // there is already a default, so a new rate is not one

    await row.getByRole('button', { name: new RegExp(`Edit ${code}`) }).click();
    const edit = page.getByRole('dialog', { name: `Edit ${code}` });
    await expect(edit.getByLabel('Code')).toHaveCount(0); // the code cannot change
    await edit.getByLabel('Rate (%)').fill('7.5');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(`${code} was updated.`)).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText('7.5%');

    await page.getByRole('row', { name: new RegExp(code) }).getByRole('button', { name: new RegExp(`Turn off ${code}`) }).click();
    await expect(page.getByRole('row', { name: new RegExp(code) }).locator('.cf-badge')).toContainText('Off');
  });
});
