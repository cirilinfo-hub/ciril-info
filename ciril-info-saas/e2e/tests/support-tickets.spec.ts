import { expect, test, type Page } from '@playwright/test';
import { fixture, linkFromEmail, totp, uniqueEmail } from './support/helpers';

const CUSTOMER_PASSWORD = 'Correct-Horse-42!';
const STAFF_PASSWORD = 'Staff-Strong-Passphrase-9';

async function registerAndSignIn(page: Page, email: string) {
  await page.goto('/portal/register');
  await page.getByLabel('First name').fill('Sana');
  await page.getByLabel('Last name').fill('Asker');
  await page.getByLabel('Business name').fill('Sana Asker Co');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible();
  const link = await linkFromEmail(email, 'verify-email');
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(page.getByText('Your email is verified')).toBeVisible();
  await page.getByRole('link', { name: 'Sign In' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Sana' })).toBeVisible();
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

/** A customer asks for help; a support agent answers (with a private note); the customer replies and closes it. */
test.describe('Support tickets', () => {
  test('customer and support agent talk through a ticket', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');
    test.setTimeout(120_000);
    const customerEmail = uniqueEmail('tkt');
    await registerAndSignIn(page, customerEmail);

    // --- Customer opens a ticket
    await page.getByRole('complementary').getByRole('link', { name: 'Support' }).click();
    await expect(page.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'New ticket' }).click();
    const dialog = page.getByRole('dialog', { name: 'New support ticket' });
    await dialog.getByRole('button', { name: 'Send ticket' }).click();
    await expect(dialog.getByText('Enter a subject')).toBeVisible();
    await dialog.getByLabel('Subject').fill('PW My email stopped working');
    await dialog.getByLabel('Topic').selectOption('EMAIL');
    await dialog.getByLabel('Message').fill('I cannot send email since this morning. Please help.');
    await dialog.getByRole('button', { name: 'Send ticket' }).click();
    await expect(page.getByRole('heading', { name: 'PW My email stopped working', level: 1 })).toBeVisible();
    await expect(page.getByText(/^TKT-\d+$/).first()).toBeVisible();
    const ticketUrl = page.url();

    // --- Support agent answers, with a private note first
    const staffEmail = uniqueEmail('agent');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPPORT_AGENT') as { secret: string };
    const staffCtx = await browser.newContext();
    const staff = await staffCtx.newPage();
    await staffSignIn(staff, staffEmail, secret);
    await staff.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Support inbox' }).click();
    await staff.getByRole('searchbox', { name: 'Search tickets' }).fill('PW My email stopped');
    await staff.getByRole('link', { name: 'PW My email stopped working' }).click();
    await expect(staff.getByText('I cannot send email since this morning.')).toBeVisible();

    await staff.getByLabel('Reply').fill('PW private: check the mail server logs');
    await staff.getByLabel('Internal note').check();
    await staff.getByRole('button', { name: 'Add note' }).click();
    await expect(staff.getByText('Internal note, not visible to the customer')).toBeVisible();

    await staff.getByLabel('Reply').fill('We found the problem and fixed your mailbox. Please try again.');
    await staff.getByRole('button', { name: 'Send reply' }).click();
    await expect(staff.getByText('Reply sent. The customer has been notified.')).toBeVisible();
    // Replying assigns the ticket to the agent; they can still change its priority.
    await expect(staff.getByRole('complementary', { name: 'Ticket details' }).getByText('E2E Staff')).toBeVisible();
    await staff.getByLabel('Priority').selectOption('HIGH');
    await expect(staff.getByText('Ticket updated.')).toBeVisible();

    // --- The bell tells the customer, and clicking the notice opens the ticket and clears the badge
    await page.goto('/portal/');
    const bell = page.getByRole('button', { name: /^Notifications, 1 unread$/ });
    await expect(bell).toBeVisible();
    await bell.click();
    await page.getByRole('button', { name: /New reply on TKT-\d+/ }).click();
    await expect(page).toHaveURL(/\/portal\/support\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();

    // --- Customer sees the reply (not the private note), is told it is waiting on them, replies, then closes
    await page.goto(ticketUrl.replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.getByText('We found the problem and fixed your mailbox.')).toBeVisible();
    await expect(page.getByText('(Ciril Info Support)')).toBeVisible();
    await expect(page.getByText('private: check the mail server logs')).toHaveCount(0);
    await expect(page.locator('.cf-badge', { hasText: 'Waiting for you' })).toBeVisible();

    await page.getByLabel('Reply to our team').fill('Works again, thank you!');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByText('Works again, thank you!')).toBeVisible();
    await expect(page.locator('.cf-badge', { hasText: 'Open' })).toBeVisible();

    await page.getByRole('button', { name: 'Close ticket' }).click();
    await expect(page.getByText('This ticket is closed.')).toBeVisible();
    await expect(page.getByLabel('Reply to our team')).toHaveCount(0);
    await page.screenshot({ path: 'screenshots/customer-ticket.png', fullPage: true });

    await staffCtx.close();
  });

  test('support pages need a signed-in customer', async ({ page }) => {
    await page.goto('/portal/support');
    await expect(page).toHaveURL(/\/portal\/login\?returnUrl=/);
    await page.goto('/admin/support');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
