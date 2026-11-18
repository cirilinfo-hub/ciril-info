import { expect, test, type Page } from '@playwright/test';
import { API, fixture, totp, uniqueEmail } from './support/helpers';

const PASSWORD = 'Staff-Strong-Passphrase-9';

async function signIn(page: Page, email: string, secret: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await page.getByLabel('Verification code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, E2E' })).toBeVisible();
}

const publicJson = async <T>(path: string): Promise<T> => (await fetch(`${API}/api/v1/public/${path}`)).json() as Promise<T>;

/** Staff edit the website content and see it go live. Data uses "PW " / "pw-" prefixes and is removed by the global teardown. */
test.describe('Admin website content', () => {
  test('a Super Admin manages testimonials, FAQs and products; the website follows', async ({ page }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail('content');
    const { secret } = fixture('create-staff-ready', email, PASSWORD, 'SUPER_ADMIN') as { secret: string };
    await signIn(page, email, secret);

    // The sidebar offers the website sections this role may use.
    const nav = page.getByRole('complementary', { name: 'Admin navigation' });
    for (const name of ['Products & Pricing', 'Testimonials', 'FAQs', 'Legal pages', 'Enquiries', 'Company profile']) {
      await expect(nav.getByRole('link', { name })).toBeVisible();
    }

    // --- Testimonials: consent gate, then publish
    await nav.getByRole('link', { name: 'Testimonials' }).click();
    await expect(page.getByRole('heading', { name: 'Testimonials', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Add Testimonial' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Testimonial' });
    await dialog.getByRole('textbox', { name: 'Quote' }).fill('PW Browser-test quote.');
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Pat Tester');
    await dialog.getByLabel('Publish on the website').check();
    await expect(dialog.getByText('Tick the consent box to publish this quote.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toContainText('consent');
    await dialog.getByLabel('The customer has agreed to this quote being published').check();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Testimonial saved.')).toBeVisible();
    const row = page.getByRole('row', { name: /PW Browser-test quote/ });
    await expect(row.getByText('Published', { exact: true })).toBeVisible();
    expect(((await publicJson<{ data: { quote: string }[] }>('testimonials')).data).some((t) => t.quote === 'PW Browser-test quote.')).toBe(true);

    await row.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByText('Testimonial unpublished.')).toBeVisible();
    expect(((await publicJson<{ data: { quote: string }[] }>('testimonials')).data).some((t) => t.quote === 'PW Browser-test quote.')).toBe(false);
    await row.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Testimonial deleted.')).toBeVisible();
    await expect(page.getByRole('row', { name: /PW Browser-test quote/ })).toHaveCount(0);

    // --- FAQs
    await nav.getByRole('link', { name: 'FAQs' }).click();
    await page.getByRole('button', { name: 'Add FAQ' }).click();
    const faq = page.getByRole('dialog', { name: 'Add FAQ' });
    await faq.getByLabel('Topic').fill('pw-topic');
    await faq.getByLabel('Question').fill('PW Is this a test?');
    await faq.getByLabel('Answer').fill('Yes, it is.');
    await faq.getByLabel('Publish on the website').check();
    await faq.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('FAQ saved.')).toBeVisible();
    expect((await publicJson<{ data: { question: string }[] }>('faqs?topic=pw-topic')).data.map((f) => f.question)).toEqual(['PW Is this a test?']);
    await page.getByRole('row', { name: /PW Is this a test/ }).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('FAQ deleted.')).toBeVisible();

    // --- Products: add product, plan, features and a price; the plan cannot be published before it has a price
    await nav.getByRole('link', { name: 'Products & Pricing' }).click();
    await page.getByRole('button', { name: 'Add Product' }).click();
    const prod = page.getByRole('dialog', { name: 'Add Product' });
    await prod.getByRole('textbox', { name: 'Name' }).fill('PW Admin Hosting');
    await prod.getByRole('textbox', { name: 'Name' }).blur();
    await expect(prod.getByLabel('Web address slug')).toHaveValue('pw-admin-hosting');
    await prod.getByLabel('Status').selectOption('PUBLISHED');
    await prod.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Product saved.')).toBeVisible();

    const section = page.getByRole('region', { name: /PW Admin Hosting/ });
    await section.getByRole('button', { name: 'Add plan' }).click();
    const plan = page.getByRole('dialog', { name: 'Add Plan' });
    await plan.getByLabel('Plan name').fill('PW Starter');
    await plan.getByLabel('Plan name').blur();
    await expect(plan.getByLabel('Web address slug')).toHaveValue('pw-starter');
    await plan.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Plan saved.')).toBeVisible();

    await section.getByRole('button', { name: 'Edit', exact: true }).last().click();
    const edit = page.getByRole('dialog', { name: 'Edit Plan' });
    await edit.getByLabel('Status').selectOption('PUBLISHED');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByRole('alert')).toContainText('current price');
    await edit.getByRole('button', { name: 'Cancel' }).click();

    await section.getByRole('button', { name: 'Features' }).click();
    await page.getByRole('dialog', { name: 'Plan features' }).getByLabel('Features').fill('1 website\n* 25 GB NVMe storage');
    await page.getByRole('dialog', { name: 'Plan features' }).getByRole('button', { name: 'Save Features' }).click();
    await expect(page.getByText('Features saved.')).toBeVisible();

    await section.getByRole('button', { name: 'Set price' }).click();
    const price = page.getByRole('dialog', { name: 'Set price' });
    await price.getByLabel('Price for the first term').fill('1200');
    await price.getByLabel('Renewal price').fill('1800');
    await price.getByLabel('List price').fill('1000'); // lower than the price: refused by the server
    await price.getByRole('button', { name: 'Set Price' }).click();
    await expect(price.getByRole('alert')).toContainText('List price');
    await price.getByLabel('List price').fill('2400');
    await price.getByRole('button', { name: 'Set Price' }).click();
    await expect(page.getByText(/Price set\./)).toBeVisible();

    await section.getByRole('button', { name: 'Edit', exact: true }).last().click();
    await page.getByRole('dialog', { name: 'Edit Plan' }).getByLabel('Status').selectOption('PUBLISHED');
    await page.getByRole('dialog', { name: 'Edit Plan' }).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Plan saved.')).toBeVisible();

    const catalog = await publicJson<{ data: { slug: string; plans: { slug: string; prices: { cycle: string; price: number }[]; features: { label: string; highlight: boolean }[] }[] }[] }>('catalog');
    const mine = catalog.data.find((p) => p.slug === 'pw-admin-hosting');
    expect(mine?.plans[0]).toMatchObject({ slug: 'pw-starter', prices: [{ cycle: 'YEARLY', price: 1200 }] });
    expect(mine?.plans[0]?.features).toEqual([
      { label: '1 website', value: null, highlight: false },
      { label: '25 GB NVMe storage', value: null, highlight: true },
    ]);
    await page.screenshot({ path: 'screenshots/admin-products.png', fullPage: true });
  });

  test('projects: choose an image from this computer, see a preview, and it appears on the website', async ({ page }) => {
    test.setTimeout(90_000);
    const email = uniqueEmail('image');
    const { secret } = fixture('create-staff-ready', email, PASSWORD, 'SUPER_ADMIN') as { secret: string };
    await signIn(page, email, secret);
    await page.goto('/admin/projects');
    await page.getByRole('button', { name: 'Add Project' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add Project' });
    await dlg.getByRole('textbox', { name: 'Client name' }).fill('PW Image Client');
    await dlg.getByRole('textbox', { name: 'Project title' }).fill('PW Image Project');
    await dlg.getByRole('combobox', { name: 'Category' }).fill('Web Design');
    await dlg.getByRole('textbox', { name: 'Summary' }).fill('A project with an uploaded cover.');
    await dlg.getByRole('textbox', { name: 'Web address slug' }).fill('pw-image-project');

    // There is no address box any more: the image comes from a file on this computer.
    await expect(dlg.getByLabel('Image address')).toHaveCount(0);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

    // Wrong kind of file: refused in the browser with a clear message.
    await dlg.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(dlg.getByText('Choose a PNG, JPEG or WebP image.')).toBeVisible();

    await dlg.locator('input[type=file]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
    const preview = dlg.getByRole('img', { name: 'Cover image preview' });
    await expect(preview).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Replace image' })).toBeVisible();
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    await dlg.getByLabel('Publish on the website').check();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Project saved.')).toBeVisible();

    const pub = await publicJson<{ data: { slug: string; imageUrl: string | null }[] }>('projects');
    const mine = pub.data.find((p) => p.slug === 'pw-image-project');
    expect(mine?.imageUrl).toMatch(/\/api\/v1\/uploads\/images\/[0-9a-f-]{36}\.png$/);
    const img = await fetch(mine!.imageUrl!);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');

    // Editing again shows the saved image, and it can be removed.
    await page.getByRole('row', { name: /PW Image Client/ }).getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Project' });
    await expect(edit.getByRole('img', { name: 'Cover image preview' })).toBeVisible();
    await edit.getByRole('button', { name: 'Remove image' }).click();
    await expect(edit.getByRole('img', { name: 'Cover image preview' })).toHaveCount(0);
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Project saved.')).toBeVisible();
    const after = await publicJson<{ data: { slug: string; imageUrl: string | null }[] }>('projects');
    expect(after.data.find((p) => p.slug === 'pw-image-project')?.imageUrl).toBeNull();
    await page.screenshot({ path: 'screenshots/admin-project-upload.png', fullPage: false });
  });

  test('legal pages: a page is public only after it is published', async ({ page }) => {
    test.setTimeout(90_000);
    const email = uniqueEmail('legal');
    const { secret } = fixture('create-staff-ready', email, PASSWORD, 'SUPER_ADMIN') as { secret: string };
    await signIn(page, email, secret);
    await page.goto('/admin/legal');
    await expect(page.getByRole('heading', { name: 'Legal pages', level: 1 })).toBeVisible();
    await expect(page.getByRole('row', { name: /Privacy Policy/ })).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-legal.png', fullPage: true });
  });

  test('a support agent can triage enquiries but cannot edit website content', async ({ page }) => {
    test.setTimeout(90_000);
    const email = uniqueEmail('agent');
    const { secret } = fixture('create-staff-ready', email, PASSWORD, 'SUPPORT_AGENT') as { secret: string };
    await signIn(page, email, secret);
    const nav = page.getByRole('complementary', { name: 'Admin navigation' });
    await expect(nav.getByRole('link', { name: 'Enquiries' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Testimonials' })).toHaveCount(0);
    await page.goto('/admin/testimonials');
    // Not allowed: the app sends them back to the dashboard (wait for it, so the session refresh finishes before the next load).
    await expect(page.getByRole('heading', { name: 'Welcome, E2E' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Testimonials', level: 1 })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Enquiries' }).click();
    await expect(page.getByRole('heading', { name: 'Enquiries', level: 1 })).toBeVisible();
  });
});

/** Day-to-day operations in the admin portal: customers, staff and the audit log. */
test.describe('Admin operations', () => {
  test('a Super Admin adds and suspends a customer, invites staff, and finds it all in the audit log', async ({ page }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail('ops');
    const { secret } = fixture('create-staff-ready', email, PASSWORD, 'SUPER_ADMIN') as { secret: string };
    await signIn(page, email, secret);
    const nav = page.getByRole('complementary', { name: 'Admin navigation' });

    // The dashboard shows real figures for this role.
    await expect(page.getByRole('region', { name: 'Key figures' }).getByText('Customers')).toBeVisible();
    await expect(page.getByText('Active staff')).toBeVisible();

    // --- Customers
    await nav.getByRole('link', { name: 'Customers' }).click();
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Add Customer' }).click();
    const add = page.getByRole('dialog', { name: 'Add Customer' });
    await add.getByRole('button', { name: 'Create Customer' }).click();
    await expect(add.getByText('Enter organisation name.')).toBeVisible(); // validation before any request
    const owner = uniqueEmail('owner');
    await add.getByRole('textbox', { name: 'Organisation name' }).fill('PW Ops Customer');
    await add.getByRole('textbox', { name: /first name/ }).fill('Olive');
    await add.getByRole('textbox', { name: /last name/ }).fill('Owner');
    await add.getByRole('textbox', { name: /email/ }).fill(owner);
    await add.getByRole('button', { name: 'Create Customer' }).click();
    await expect(page.getByText(/PW Ops Customer was created/)).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search customers' }).fill('PW Ops Customer');
    const row = page.getByRole('row', { name: /PW Ops Customer/ });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'View' }).click();
    const detail = page.getByRole('dialog', { name: 'PW Ops Customer' });
    await detail.getByRole('button', { name: 'Suspend' }).click();
    const sus = page.getByRole('dialog', { name: /Suspend PW Ops Customer/ });
    await sus.getByRole('button', { name: 'Suspend', exact: true }).click();
    await expect(sus.getByText('Enter reason.')).toBeVisible();
    await sus.getByLabel('Reason').fill('Browser test');
    await sus.getByRole('button', { name: 'Suspend', exact: true }).click();
    await expect(page.getByText('PW Ops Customer was suspended.')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'PW Ops Customer' }).getByRole('button', { name: 'Reactivate' })).toBeVisible();
    await page.getByRole('dialog', { name: 'PW Ops Customer' }).getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByText('PW Ops Customer was reactivated.')).toBeVisible();
    await page.keyboard.press('Escape'); // closes the dialog

    // --- Staff: invite, change role, disable
    await nav.getByRole('link', { name: 'Staff' }).click();
    await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(email) }).getByText('You')).toBeVisible();
    const invitee = uniqueEmail('invitee');
    await page.getByRole('button', { name: 'Invite Staff' }).click();
    const inv = page.getByRole('dialog', { name: 'Invite Staff' });
    await inv.getByRole('textbox', { name: /First name/ }).fill('Ivy');
    await inv.getByRole('textbox', { name: /Last name/ }).fill('Invitee');
    await inv.getByRole('textbox', { name: /Email address/ }).fill(invitee);
    await inv.getByLabel('Role').selectOption('FINANCE_ADMIN');
    await inv.getByRole('button', { name: 'Send Invitation' }).click();
    await expect(page.getByText(`Invitation sent to ${invitee}.`)).toBeVisible();
    const staffRow = page.getByRole('row', { name: new RegExp(invitee) });
    await expect(staffRow.getByText('Invited')).toBeVisible();
    await staffRow.getByLabel('Role for Ivy').selectOption('SUPPORT_AGENT');
    await expect(page.getByText(/Ivy.s role was updated\./)).toBeVisible();
    await staffRow.getByRole('button', { name: 'Disable' }).click();
    await page.getByRole('dialog', { name: 'Disable Ivy?' }).getByRole('button', { name: 'Disable' }).click();
    await expect(page.getByText(/Ivy was disabled/)).toBeVisible();
    // A Super Admin cannot change their own role or disable themselves from here.
    await expect(page.getByRole('row', { name: new RegExp(email) }).getByRole('button')).toHaveCount(0);

    // --- Audit log shows what was just done
    await nav.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    await page.getByLabel('Area').selectOption('tenant.');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('row', { name: /tenant\.suspend/ }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /tenant\.activate/ }).first()).toBeVisible();
    await page.getByRole('row', { name: /tenant\.suspend/ }).first().getByRole('button', { name: 'Details' }).click();
    await expect(page.getByRole('dialog', { name: 'tenant.suspend' }).getByText('Browser test')).toBeVisible(); // the reason was recorded
    await page.screenshot({ path: 'screenshots/admin-audit.png' });
  });
});
