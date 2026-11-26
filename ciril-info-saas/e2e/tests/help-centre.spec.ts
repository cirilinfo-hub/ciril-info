import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixture, linkFromEmail, totp, uniqueEmail } from './support/helpers';

const CUSTOMER_PASSWORD = 'Correct-Horse-42!';
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

async function registerAndSignIn(page: Page, email: string) {
  await page.goto('/portal/register');
  await page.getByLabel('First name').fill('Hema');
  await page.getByLabel('Last name').fill('Kumar');
  await page.getByLabel('Business name').fill('Hema Kumar Co');
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
  await expect(page.getByRole('heading', { name: 'Welcome, Hema' })).toBeVisible();
}

/** A support agent writes and publishes a help article; a visitor finds it; a customer is offered it while writing a ticket. */
test.describe('Help centre', () => {
  test('write, publish, find and suggest an article', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 6);
    const word = `zephyr${tag}`; // a word no other article contains
    const staffEmail = uniqueEmail('kbagent');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPPORT_AGENT') as { secret: string };

    // --- Support agent: a category, then an article (draft first)
    await staffSignIn(page, staffEmail, secret);
    await page.getByRole('complementary').getByRole('link', { name: 'Help centre' }).click();
    await expect(page.getByRole('heading', { name: 'Help centre', level: 1 })).toBeVisible();
    await page.getByRole('tab', { name: /Categories/ }).click();
    await page.getByRole('button', { name: 'New category' }).click();
    let dialog = page.getByRole('dialog', { name: 'New category' });
    await dialog.getByLabel(/^Name\b/).fill(`PW Email ${tag}`);
    await dialog.getByLabel('Short name for links').fill(`pw-email-${tag}`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Category saved.')).toBeVisible();

    await page.getByRole('tab', { name: 'Articles' }).click();
    await page.getByRole('button', { name: 'New article' }).click();
    dialog = page.getByRole('dialog', { name: 'New article' });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText('Enter a title.')).toBeVisible();
    await dialog.getByLabel(/^Title\b/).fill(`Fix ${word} mail sending`);
    await expect(dialog.getByLabel('Web address')).toHaveValue(`fix-${word}-mail-sending`);
    await dialog.getByLabel('Web address').fill(`pw-fix-${word}`);
    await dialog.getByLabel(/^Category\b/).selectOption({ label: `PW Email ${tag}` });
    await dialog.getByLabel(/^Summary\b/).fill('What to check when email will not send.');
    await dialog.getByLabel(/^Article\b/).fill(`## Check these first\n1. Open Email.\n2. Check the ${word} setting.\n\n- Never share your password.\n\n<script>alert(1)</script>`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Article saved.')).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(word) });
    await expect(row.getByText('Draft')).toBeVisible();

    // A draft is not public.
    const visitor = await browser.newPage();
    await visitor.goto(`/help/pw-fix-${word}`);
    await expect(visitor.getByRole('heading', { name: 'Article Not Found' })).toBeVisible();

    await row.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Article published.')).toBeVisible();
    await expect(row.getByText('Published')).toBeVisible();

    // --- Visitor: search the help centre and read the article
    await visitor.goto('/help');
    await expect(visitor.getByRole('heading', { name: /How Can We/ })).toBeVisible();
    await visitor.getByLabel('Search help articles').fill(word);
    await visitor.getByRole('link', { name: new RegExp(`Fix ${word}`) }).click();
    await expect(visitor.getByRole('heading', { name: `Fix ${word} mail sending`, level: 1 })).toBeVisible();
    await expect(visitor.getByRole('heading', { name: 'Check these first' })).toBeVisible();
    await expect(visitor.getByRole('listitem').filter({ hasText: `Check the ${word} setting.` })).toBeVisible();
    // Typed markup is shown as text, never run.
    await expect(visitor.getByText('<script>alert(1)</script>')).toBeVisible();
    await visitor.close();

    // --- Customer: the article is suggested while writing a ticket
    const customer = await browser.newPage();
    await registerAndSignIn(customer, uniqueEmail('kbcust'));
    await customer.getByRole('complementary').getByRole('link', { name: 'Support' }).click();
    await customer.getByRole('button', { name: 'New ticket' }).click();
    const tk = customer.getByRole('dialog', { name: 'New support ticket' });
    await tk.getByLabel('Subject').fill(`My ${word} mail will not send`);
    const tip = tk.getByRole('status').filter({ hasText: 'These help articles might answer your question' });
    await expect(tip).toBeVisible();
    await expect(tip.getByRole('link', { name: `Fix ${word} mail sending` })).toHaveAttribute('href', new RegExp(`/help/pw-fix-${word}$`));
    await customer.close();
  });
});
