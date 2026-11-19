import { expect, test } from '@playwright/test';
import { linkFromEmail, uniqueEmail } from './support/helpers';

const PASSWORD = 'Correct-Horse-42!';

/**
 * A plan picked on the website carries through account creation: register → verify → sign in →
 * "continue your order" → review → place order → invoice → pay (test mode) → service is active.
 * Uses the plans seeded by the public-page fixtures (pw-hosting/pw-pro, yearly).
 */
test.describe('Customer ordering', () => {
  test('choose a plan, pay the invoice in test mode and see the active service', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'full journey runs once');
    const email = uniqueEmail('bill');

    await page.goto('/portal/register?plan=pw-hosting%2Fpw-pro&cycle=yearly');
    await page.getByLabel('First name').fill('Anita');
    await page.getByLabel('Last name').fill('Buyer');
    await page.getByLabel('Business name').fill('Anita Buyer Studio');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible();

    const link = await linkFromEmail(email, 'verify-email');
    await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.getByText('Your email is verified')).toBeVisible();
    await page.getByRole('link', { name: 'Sign In' }).click();
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // The remembered plan is offered on the dashboard.
    await expect(page.getByRole('heading', { name: 'Welcome, Anita' })).toBeVisible();
    await page.getByRole('link', { name: 'Continue your order' }).click();

    // Review: the real catalogue price, no invented tax.
    await expect(page.getByRole('heading', { name: 'Review your order' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /PW Pro · Yearly/ })).toBeVisible();
    await expect(page.getByText('₹1,920.00').first()).toBeVisible();

    // A tax invoice needs a billing address, so the order is blocked until one exists.
    await expect(page.getByText('Add a billing address before you order.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
    await page.getByRole('link', { name: 'Add address' }).click();
    await expect(page.getByRole('heading', { name: 'Billing addresses' })).toBeVisible();
    await page.getByRole('button', { name: 'Add address' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add billing address' });
    await dialog.getByRole('button', { name: 'Save address' }).click();
    await expect(dialog.getByText('Enter the street address')).toBeVisible();
    await dialog.getByLabel('Address line 1').fill('12 MG Road');
    await dialog.getByLabel('City').fill('Bengaluru');
    await dialog.getByLabel('PIN code').fill('560001');
    await dialog.getByLabel('State').selectOption({ label: 'Karnataka' });
    await dialog.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('Address saved.')).toBeVisible();
    await expect(page.getByText('GST state code 29')).toBeVisible();
    await expect(page.locator('.cf-badge', { hasText: 'Default' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
    await page.getByRole('button', { name: 'Place order' }).click();

    // Invoice is issued and unpaid; the page says plainly that payments are in test mode.
    await expect(page).toHaveURL(/\/portal\/invoices\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: /^INV-\d{4}-\d{2}-\d{6}$/ })).toBeVisible();
    await expect(page.locator('.cf-badge', { hasText: 'Unpaid' })).toBeVisible();
    await expect(page.getByText('Test mode.')).toBeVisible();
    await expect(page.getByText('Billed to')).toBeVisible();
    await expect(page.getByText(/12 MG Road, Bengaluru, Karnataka 560001/)).toBeVisible();

    await page.getByRole('button', { name: /Pay .* \(test\)/ }).click();
    await expect(page.getByText('Payment received.')).toBeVisible();
    await expect(page.locator('.cf-badge', { hasText: 'Paid' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Pay / })).toHaveCount(0);

    // Services shows it active, and it can be cancelled at period end.
    await page.getByRole('link', { name: 'Services', exact: true }).click();
    await expect(page.locator('.cf-badge', { hasText: 'Active' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Yes, cancel' }).click();
    await expect(page.getByText('ends at period end')).toBeVisible();

    await page.getByRole('link', { name: 'Invoices', exact: true }).click();
    await expect(page.getByRole('cell', { name: /^INV-/ })).toHaveCount(1);
    await page.screenshot({ path: 'screenshots/customer-invoices.png', fullPage: true });
  });

  test('the order page needs a plan and signing in', async ({ page }) => {
    await page.goto('/portal/order?plan=pw-hosting%2Fpw-pro&cycle=yearly');
    await expect(page).toHaveURL(/\/portal\/login\?returnUrl=/);
  });
});
