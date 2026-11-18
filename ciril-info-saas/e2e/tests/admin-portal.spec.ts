import { expect, test } from '@playwright/test';
import { fixture, totp, uniqueEmail } from './support/helpers';

const FIRST_PASSWORD = 'Temporary-Pass-123';
const NEW_PASSWORD = 'Staff-Strong-Passphrase-9';

/**
 * Staff journey: first sign-in forces a password change, then mandatory
 * two-step verification set-up, then the admin dashboard. Second sign-in
 * requires the authenticator code.
 */
test.describe('Admin portal', () => {
  test('staff first sign-in: password change → two-step setup → dashboard → code required next time', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');
    // Includes up to 30 s waiting for the next TOTP window (codes cannot be replayed).
    test.setTimeout(90_000);
    const email = uniqueEmail('admin');
    fixture('create-staff', email, FIRST_PASSWORD, 'SUPPORT_AGENT');

    // Customers' credentials don't work here, and errors don't reveal which part was wrong.
    await page.goto('/admin/login');
    await expect(page.getByRole('heading', { name: 'Admin Sign In' })).toBeVisible();
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill('Wrong-password-1');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('alert')).toContainText('The email or password is incorrect.');

    await page.getByLabel('Password').fill(FIRST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 1. Forced password change
    await expect(page.getByRole('heading', { name: 'Choose a New Password' })).toBeVisible();
    await expect(page.getByText('For your security')).toBeVisible();
    // Trying to skip ahead is redirected back.
    await page.goto('/admin/');
    await expect(page.getByRole('heading', { name: 'Choose a New Password' })).toBeVisible();
    await page.getByLabel('Current password').fill(FIRST_PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Save Password' }).click();

    // 2. Mandatory two-step setup
    await expect(page.getByRole('heading', { name: 'Set Up Two-Step Verification' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-two-step.png', fullPage: true });
    const secret = (await page.getByLabel('Setup key').textContent())!.replace(/\s/g, '');
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Turn On' }).click();
    await expect(page.getByText('That code is not valid', { exact: false })).toBeVisible();
    await page.getByLabel('6-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Turn On' }).click();

    // 3. Recovery codes shown once; continue only after confirming they're saved
    await expect(page.getByText('Two-step verification is on.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
    const cont = page.getByRole('button', { name: 'Continue' });
    await expect(cont).toBeDisabled();
    await page.getByLabel('I have saved my recovery codes').check();
    await cont.click();

    // 4. Admin dashboard: real counts, limited to what this role may see (a Support Agent has no staff or audit access)
    await expect(page.getByRole('heading', { name: 'Welcome, E2E' })).toBeVisible();
    await expect(page.getByText('Signed in as Support Agent.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Key figures' })).toBeVisible();
    await expect(page.getByText('Latest enquiries')).toBeVisible();
    await expect(page.getByText('Active staff')).toHaveCount(0);
    await expect(page.getByText('Recent activity')).toHaveCount(0);
    await page.screenshot({ path: 'screenshots/admin-dashboard.png', fullPage: true });

    // 5. Sign out, sign in again: authenticator code required (wait for the next 30 s step so the code isn't a replay)
    await page.getByRole('button', { name: /E2E Staff/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
    const waitMs = 30_000 - (Date.now() % 30_000) + 500;
    await page.waitForTimeout(waitMs);
    await page.getByLabel('Verification code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome, E2E' })).toBeVisible();
  });

  test('admin pages require sign-in', async ({ page }) => {
    await page.goto('/admin/security');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
