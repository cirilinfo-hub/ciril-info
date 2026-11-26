import { expect, test } from '@playwright/test';
import { linkFromEmail, uniqueEmail } from './support/helpers';

const PASSWORD = 'Correct-Horse-42!';

/**
 * Customer journey through the real UI, API, worker, database and Mailpit:
 * register → verify email → sign in → dashboard → organisation → team invite → sign out.
 */
test.describe('Customer portal', () => {
  test.describe.configure({ mode: 'serial' });

  const email = uniqueEmail('cust');

  test('register, verify by email, and sign in', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');

    await page.goto('/portal/register');
    await expect(page.getByRole('heading', { name: 'Create Your Account' })).toBeVisible();

    // Client-side validation
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('Enter first name.')).toBeVisible();

    await page.getByLabel('First name').fill('Priya');
    await page.getByLabel('Last name').fill('Tester');
    await page.getByLabel('Business name').fill('Priya Test Studio');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible();

    // Signing in before verification is refused with a clear message.
    await page.goto('/portal/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('alert')).toContainText('verify your email');

    // Open the link from the real email.
    const link = await linkFromEmail(email, 'verify-email');
    await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.getByText('Your email is verified')).toBeVisible();

    await page.getByRole('link', { name: 'Sign In' }).click();
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByRole('heading', { name: 'Welcome, Priya' })).toBeVisible();
    await expect(page.getByText('Priya Test Studio').first()).toBeVisible();
    await expect(page.getByText(/^CI-\d{6}$/)).toBeVisible();
    await expect(page.getByText('Account created')).toBeVisible();
    await page.screenshot({ path: 'screenshots/customer-dashboard.png', fullPage: true });

    // Session survives a reload (silent refresh via httpOnly cookie).
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome, Priya' })).toBeVisible();

    // Organisation details
    await page.getByRole('link', { name: 'Organisation' }).first().click();
    await page.getByLabel('GSTIN').fill('NOTVALID');
    await page.getByLabel('GSTIN').blur();
    await expect(page.getByText('Check the format of gstin.')).toBeVisible();
    await page.getByLabel('GSTIN').fill('29abcde1234f1z5');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Changes saved.')).toBeVisible();

    // Team: invite a member (delivered by email)
    await page.getByRole('link', { name: 'Team' }).first().click();
    await expect(page.getByRole('cell', { name: /Priya Tester/ })).toBeVisible();
    await page.getByRole('button', { name: 'Invite Member' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a Team Member' });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: 'screenshots/customer-invite-dialog.png' });
    const invitee = uniqueEmail('invitee');
    await dialog.getByLabel('Email address').fill(invitee);
    await dialog.getByRole('button', { name: 'Send Invitation' }).click();
    await expect(page.getByText(`Invitation sent to ${invitee}.`)).toBeVisible();
    await expect(page.getByRole('cell', { name: invitee })).toBeVisible();
    expect(await linkFromEmail(invitee, 'invitations/accept')).toContain('token=');
    await page.screenshot({ path: 'screenshots/customer-team.png', fullPage: true });

    // Escape closes dialogs and returns focus
    await page.getByRole('button', { name: 'Invite Member' }).click();
    await expect(page.getByRole('dialog')).toBeVisible(); // it renders on the next tick; Escape before that reaches nothing
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Invite Member' })).toBeFocused();

    // Sign out ends the session
    await page.getByRole('button', { name: /Priya Tester/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await page.goto('/portal/team');
    await expect(page).toHaveURL(/\/portal\/login/);
  });

  test('protected pages redirect to sign-in', async ({ page }) => {
    await page.goto('/portal/team');
    await expect(page).toHaveURL(/\/portal\/login\?returnUrl=%2Fportal%2Fteam/);
  });

  test('sign-in pages fit small screens', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'mobile only');
    for (const path of ['/portal/login', '/portal/register', '/admin/login']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
