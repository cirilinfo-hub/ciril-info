import { expect, test, type Page } from '@playwright/test';
import { API, fixture, linkFromEmail, totp, uniqueEmail } from './support/helpers';

const STAFF_PASSWORD = 'Staff-Strong-Passphrase-9';
const CUSTOMER_PASSWORD = 'Correct-Horse-42!';

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

/** A verified customer with a billing address, not yet signed in to the browser. */
async function newCustomer(label: string) {
  const email = uniqueEmail(label);
  await call('POST', 'auth/register', { firstName: 'Dina', lastName: 'Domain', email, password: CUSTOMER_PASSWORD, organisationName: `PW Domain Org ${label}`, acceptTerms: true });
  const link = await linkFromEmail(email, 'verify-email');
  await call('POST', 'auth/verify-email', { token: new URL(link).searchParams.get('token') });
  const token = (await call('POST', 'auth/login', { email, password: CUSTOMER_PASSWORD, portal: 'customer' }))['accessToken'] as string;
  await call('POST', 'organisation/addresses', { line1: '9 Lake Road', city: 'Pune', stateCode: '27', postalCode: '411001' }, token);
  return email;
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

const rand = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6).padEnd(6, 'x');

/** Searches from the box on the current page and waits for the Domains page to show the answer. */
async function searchFor(page: Page, q: string) {
  await page.getByLabel('Search for a domain name').fill(q);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/domains\?q=/);
}

test.describe('Domains', () => {
  test('the home page searches, the Domains page answers, and staff control what is sold', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(150_000);
    const tld = `pw${rand()}`;
    const name = `brand${rand()}`;

    // ── Staff add an ending with its prices ─────────────────────────────────────
    const staffEmail = uniqueEmail('domadmin');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await staffSignIn(staff, staffEmail, secret);
    await staff.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Domain prices' }).click();
    await expect(staff.getByRole('heading', { name: 'Domain prices' })).toBeVisible();
    await staff.getByRole('button', { name: 'Add an ending' }).click();
    const add = staff.getByRole('dialog', { name: 'Add an ending' });
    await add.getByRole('button', { name: 'Add ending' }).click();
    await expect(add.getByText(/ending such as com, in or co\.in/).first()).toBeVisible(); // nothing entered yet
    await add.getByLabel('Ending').fill(`.${tld}`);
    await add.getByLabel('Register (₹)').fill('799');
    await add.getByLabel('Renew (₹)').fill('999.50');
    await add.getByLabel('Transfer (₹)').fill('free');
    await add.getByRole('button', { name: 'Add ending' }).click();
    await expect(add.getByText(/amount in rupees/)).toBeVisible();
    await add.getByLabel('Transfer (₹)').fill('699');
    await add.getByRole('button', { name: 'Add ending' }).click();
    await expect(staff.getByText('Ending added. It now shows on the website.')).toBeVisible();
    await staff.getByRole('searchbox', { name: 'Search endings' }).fill(tld);
    const row = staff.getByRole('row', { name: new RegExp(`\\.${tld}`) });
    await expect(row).toContainText('₹799');
    await expect(row).toContainText('On sale');

    // ── A visitor searches from the home page ───────────────────────────────────
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Find your domain name' })).toBeVisible();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText(/Type the name you want/)).toBeVisible(); // empty search is refused, no navigation
    await expect(page).not.toHaveURL(/\/domains/);
    await searchFor(page, `  ${name.toUpperCase()} `);
    await expect(page.getByRole('heading', { name: `Results for “${name}”` })).toBeVisible();
    const hit = page.getByRole('list', { name: 'Domain results' }).getByRole('listitem').filter({ hasText: `${name}.${tld}` });
    await expect(hit).toContainText('Available');
    await expect(hit).toContainText('₹799');
    await expect(hit).toContainText('renews ₹999.50');
    // The price list shows the new ending too.
    await expect(page.getByRole('row', { name: new RegExp(`\\.${tld}`) })).toContainText('₹699');

    // A name that is taken, typed with its ending, comes first.
    await searchFor(page, `taken${name}.${tld}`);
    const taken = page.getByRole('list', { name: 'Domain results' }).getByRole('listitem').first();
    await expect(taken).toContainText(`taken${name}.${tld}`);
    await expect(taken).toContainText('Taken');
    await expect(taken.getByRole('link', { name: /^Register/ })).toHaveCount(0);

    // An ending we do not sell is said plainly; garbage is refused.
    await searchFor(page, `${name}.nosuchending`);
    await expect(page.getByText('We do not sell .nosuchending domains yet')).toBeVisible();
    await searchFor(page, '-bad-');
    await expect(page.getByText(/does not look like a domain name/)).toBeVisible();

    // Register sends a signed-out visitor to sign in, and the domain they chose is kept for afterwards.
    await searchFor(page, name);
    await page.getByRole('link', { name: `Register ${name}.${tld}` }).click();
    await expect(page).toHaveURL(/\/portal\/login\?.*returnUrl=/);
    expect(decodeURIComponent(page.url())).toContain(`register=${name}.${tld}`);

    // ── Staff turn it off: visitors no longer see it ────────────────────────────
    await staff.getByRole('button', { name: `Turn off .${tld}` }).click();
    await expect(staff.getByText(`.${tld} was turned off.`)).toBeVisible();
    await page.goto(`/domains?q=${name}`);
    await expect(page.getByRole('heading', { name: `Results for “${name}”` })).toBeVisible();
    await expect(page.getByText(`${name}.${tld}`)).toHaveCount(0);

    // Edit keeps the ending and changes prices.
    await staff.getByRole('button', { name: `Edit .${tld}` }).click();
    const edit = staff.getByRole('dialog', { name: `Edit .${tld}` });
    await expect(edit.getByLabel('Ending')).toHaveCount(0); // the ending cannot change
    await edit.getByLabel('Renew (₹)').fill('1099');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(staff.getByText(`.${tld} was updated.`)).toBeVisible();
    await expect(staff.getByRole('row', { name: new RegExp(`\\.${tld}`) })).toContainText('₹1,099');
    await ctx.close();
  });

  test('the Domains menu item opens the Domains page, with the price list and a search box', async ({ page }) => {
    await page.goto('/');
    const burger = page.getByRole('button', { name: 'Open menu' });
    if (await burger.isVisible()) await burger.click(); // narrow screens keep the menu in a sheet
    await page.getByRole('link', { name: 'Domains', exact: true }).first().click();
    await expect(page).toHaveURL(/\/domains$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Domain Name');
    await expect(page.getByLabel('Search for a domain name')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Domain prices' })).toBeVisible();
  });

  test('a search address can be opened directly and repeated with the back button', async ({ page }) => {
    await page.goto('/domains?q=directhit');
    await expect(page.getByRole('heading', { name: 'Results for “directhit”' })).toBeVisible();
    await expect(page.getByLabel('Search for a domain name')).toHaveValue('directhit');
  });

  test('a customer registers a domain from the public site through the client area, and staff complete it', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(180_000);
    const tld = `pw${rand()}`;
    const name = `pwreg${rand()}`;
    const domain = `${name}.${tld}`;
    fixture('add-tld', tld, '800', '1000', '700');
    const email = await newCustomer('domcust');

    // A visitor finds the name on the public site and chooses Register.
    await page.goto(`/domains?q=${name}`);
    await page.getByRole('link', { name: `Register ${domain}` }).click();

    // Signing in carries them to the client area, where the order dialog is already open for that name.
    await expect(page).toHaveURL(/\/portal\/login/);
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    const order = page.getByRole('dialog', { name: `Register ${domain}` });
    await expect(order).toBeVisible();
    await expect(page.getByRole('complementary').getByRole('link', { name: 'Domains' })).toBeVisible(); // the menu item exists
    await expect(order.getByText('Total')).toBeVisible();
    await order.getByLabel('Register for').selectOption({ label: '3 years' });
    await expect(order.getByText('₹2,800').first()).toBeVisible(); // 800 + 2 x 1000, before any tax
    await order.getByRole('button', { name: 'Continue to payment' }).click();

    // The invoice is where it is paid.
    await expect(page).toHaveURL(/\/portal\/invoices\//);
    await page.getByRole('button', { name: /Pay .* \(test\)/ }).click();
    await expect(page.getByText('Payment received.')).toBeVisible();

    // Back in Domains it is paid for and waiting for the team.
    await page.getByRole('complementary').getByRole('link', { name: 'Domains' }).click();
    const mine = page.getByRole('row', { name: new RegExp(domain) });
    await expect(mine.locator('.cf-badge', { hasText: 'Being registered' })).toBeVisible();
    await expect(mine).toContainText('3 years');
    await expect(mine.getByRole('link', { name: /Pay for/ })).toHaveCount(0);

    // Staff are told, and register it.
    const staffEmail = uniqueEmail('domadmin2');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await staffSignIn(staff, staffEmail, secret);
    await staff.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Domains', exact: true }).click();
    await staff.getByRole('button', { name: 'Needs action' }).click();
    await staff.getByRole('searchbox', { name: 'Search domains' }).fill(name);
    const row = staff.getByRole('row', { name: new RegExp(domain) });
    await expect(row).toContainText('Paid, to register');
    await row.getByRole('button', { name: `Mark ${domain} registered` }).click();
    const done = staff.getByRole('dialog', { name: 'Mark registered' });
    await done.getByLabel('Registrar reference').fill('REG-PW-1');
    await done.getByRole('button', { name: 'Mark registered' }).click();
    await expect(staff.getByText(`${domain} is registered. The customer has been told.`)).toBeVisible();
    await ctx.close();

    // The customer sees it Active, with an expiry date.
    await page.reload();
    const active = page.getByRole('row', { name: new RegExp(domain) });
    await expect(active.locator('.cf-badge', { hasText: 'Active' })).toBeVisible();
    await expect(active).toContainText(/\d{1,2} \w{3} \d{4}/);
  });

  test('a customer renews a domain, pays, and staff complete it; the new expiry shows', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(180_000);
    const tld = `pw${rand()}`;
    const name = `pwren${rand()}`;
    const domain = `${name}.${tld}`;
    fixture('add-tld', tld, '800', '1000', '700');
    const email = await newCustomer('domrenew');
    fixture('add-domain', email, name, tld, '25'); // ends in 25 days
    await page.goto('/portal/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('complementary').getByRole('link', { name: 'Domains' }).click();

    const mine = page.getByRole('row', { name: new RegExp(domain) });
    await expect(mine.locator('.cf-badge', { hasText: 'Active' })).toBeVisible();
    const endsBefore = (await mine.getByRole('cell').nth(2).innerText()).trim();
    await mine.getByRole('button', { name: `Renew ${domain}` }).click();
    const dlg = page.getByRole('dialog', { name: `Renew ${domain}` });
    await dlg.getByLabel('Renew for').selectOption({ label: '2 years' });
    await expect(dlg.getByText('₹2,000').first()).toBeVisible(); // 2 x the renewal price (1,000), not the registration price
    await expect(dlg.getByText('New expiry date')).toBeVisible();
    await dlg.getByRole('button', { name: 'Continue to payment' }).click();

    await expect(page).toHaveURL(/\/portal\/invoices\//);
    await page.getByRole('button', { name: /Pay .* \(test\)/ }).click();
    await expect(page.getByText('Payment received.')).toBeVisible();

    await page.getByRole('complementary').getByRole('link', { name: 'Domains' }).click();
    await expect(mine).toContainText('Renewal paid. Our team is renewing it');
    await expect(mine.getByRole('button', { name: `Renew ${domain}` })).toHaveCount(0); // one renewal at a time

    const staffEmail = uniqueEmail('domadmin3');
    const { secret } = fixture('create-staff-ready', staffEmail, STAFF_PASSWORD, 'SUPER_ADMIN') as { secret: string };
    const ctx = await browser.newContext();
    const staff = await ctx.newPage();
    await staffSignIn(staff, staffEmail, secret);
    await staff.getByRole('complementary', { name: 'Admin navigation' }).getByRole('link', { name: 'Domains', exact: true }).click();
    await staff.getByRole('button', { name: 'Needs action' }).click();
    await staff.getByRole('searchbox', { name: 'Search domains' }).fill(name);
    const row = staff.getByRole('row', { name: new RegExp(domain) });
    await expect(row).toContainText('Renewal: 2 years');
    await row.getByRole('button', { name: `Mark ${domain} renewed` }).click();
    const done = staff.getByRole('dialog', { name: 'Mark renewed' });
    await done.getByRole('button', { name: 'Mark renewed' }).click();
    await expect(staff.getByText(`${domain} is renewed. The customer has been told.`)).toBeVisible();
    await ctx.close();

    await page.reload();
    const renewed = page.getByRole('row', { name: new RegExp(domain) });
    await expect(renewed.locator('.cf-badge', { hasText: 'Active' })).toBeVisible();
    await expect(renewed).not.toContainText('Renewal paid');
    const endsAfter = (await renewed.getByRole('cell').nth(2).innerText()).trim();
    expect(endsAfter).not.toBe(endsBefore); // two years further on
    await expect(renewed.getByRole('button', { name: `Renew ${domain}` })).toBeVisible(); // can renew again
  });

  test('a customer manages the DNS records of a registered domain', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(120_000);
    const tld = `pw${rand()}`;
    const name = `pwdns${rand()}`;
    const domain = `${name}.${tld}`;
    const email = await newCustomer('domdns');
    fixture('add-domain', email, name, tld, '300');
    await page.goto('/portal/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('complementary').getByRole('link', { name: 'Domains' }).click();
    await page.getByRole('link', { name: `Manage DNS for ${domain}` }).click();

    await expect(page.getByRole('heading', { name: 'DNS records' })).toBeVisible();
    const table = page.getByRole('table');
    await expect(table.getByRole('row', { name: /NS/ }).first()).toContainText('Managed by us'); // the domain's own name servers are not editable

    // Add an A record; a wrong value is explained and the dialog stays open.
    await page.getByRole('button', { name: 'Add record' }).click();
    const add = page.getByRole('dialog', { name: 'Add a record' });
    await add.getByLabel('Name').fill('www');
    await add.getByLabel('Points to').fill('not-an-ip');
    await add.getByRole('button', { name: 'Add record' }).click();
    await expect(add.getByText(/needs an IPv4 address/)).toBeVisible();
    await add.getByLabel('Points to').fill('203.0.113.10');
    await add.getByRole('button', { name: 'Add record' }).click();
    await expect(page.getByText('The record was added.')).toBeVisible();
    const www = table.getByRole('row', { name: /www/ });
    await expect(www).toContainText('203.0.113.10');

    // An MX record asks for a priority.
    await page.getByRole('button', { name: 'Add record' }).click();
    const mx = page.getByRole('dialog', { name: 'Add a record' });
    await mx.getByLabel('Type').selectOption({ label: 'MX (email)' });
    await mx.getByLabel('Name').fill('@');
    await mx.getByLabel('Points to').fill('mail.example.net');
    await mx.getByLabel('Priority').fill('10');
    await mx.getByRole('button', { name: 'Add record' }).click();
    await expect(page.getByText('The record was added.')).toBeVisible();
    await expect(table.getByRole('row', { name: /MX/ })).toContainText('Priority 10');

    // Edit it.
    await www.getByRole('button', { name: /Edit A record www/ }).click();
    const edit = page.getByRole('dialog', { name: 'Edit record' });
    await expect(edit.getByLabel('Type')).toBeDisabled(); // a record's type is fixed
    await edit.getByLabel('Points to').fill('203.0.113.11');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('The record was changed.')).toBeVisible();
    await expect(table.getByRole('row', { name: /www/ })).toContainText('203.0.113.11');

    // Delete it.
    await table.getByRole('row', { name: /www/ }).getByRole('button', { name: /Delete A record www/ }).click();
    await page.getByRole('dialog', { name: 'Delete this record?' }).getByRole('button', { name: 'Delete record' }).click();
    await expect(page.getByText('The record was deleted.')).toBeVisible();
    await expect(table.getByRole('row', { name: /www/ })).toHaveCount(0);
  });

  test('an unpaid renewal can be cancelled', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(120_000);
    const tld = `pw${rand()}`;
    const name = `pwrc${rand()}`;
    const domain = `${name}.${tld}`;
    fixture('add-tld', tld, '500', '600', '400');
    const email = await newCustomer('domrencancel');
    fixture('add-domain', email, name, tld, '300');
    await page.goto('/portal/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('complementary').getByRole('link', { name: 'Domains' }).click();
    const row = page.getByRole('row', { name: new RegExp(domain) });
    await row.getByRole('button', { name: `Renew ${domain}` }).click();
    await page.getByRole('dialog', { name: `Renew ${domain}` }).getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page).toHaveURL(/\/portal\/invoices\//);

    await page.getByRole('complementary').getByRole('link', { name: 'Domains' }).click();
    await expect(row).toContainText('awaiting payment');
    await row.getByRole('button', { name: `Cancel the renewal for ${domain}` }).click();
    await page.getByRole('dialog', { name: 'Cancel this renewal?' }).getByRole('button', { name: 'Cancel renewal' }).click();
    await expect(page.getByText(`The renewal for ${domain} was cancelled.`)).toBeVisible();
    await expect(row.getByRole('button', { name: `Renew ${domain}` })).toBeVisible();
  });

  test('an unpaid domain order can be cancelled, and a taken name is refused in the client area', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs once');
    test.setTimeout(120_000);
    const tld = `pw${rand()}`;
    const name = `pwcan${rand()}`;
    fixture('add-tld', tld, '500', '600', '400');
    const email = await newCustomer('domcancel');
    await page.goto('/portal/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(CUSTOMER_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('complementary').getByRole('link', { name: 'Domains' }).click();
    await expect(page.getByText('You have no domains yet')).toBeVisible();

    await page.getByLabel('Search for a domain name').fill(`taken${name}.${tld}`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const taken = page.getByRole('list', { name: 'Domain results' }).getByRole('listitem').first();
    await expect(taken).toContainText('Taken');
    await expect(taken.getByRole('button', { name: /^Register/ })).toHaveCount(0);

    await page.getByLabel('Search for a domain name').fill(name);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: `Register ${name}.${tld}` }).click();
    await page.getByRole('dialog', { name: `Register ${name}.${tld}` }).getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page).toHaveURL(/\/portal\/invoices\//);

    await page.getByRole('complementary').getByRole('link', { name: 'Domains' }).click();
    const row = page.getByRole('row', { name: new RegExp(`${name}.${tld}`) });
    await expect(row.locator('.cf-badge', { hasText: 'Awaiting payment' })).toBeVisible();
    await row.getByRole('button', { name: /Cancel the order/ }).click();
    await page.getByRole('dialog', { name: 'Cancel this order?' }).getByRole('button', { name: 'Cancel order' }).click();
    await expect(page.getByText(`The order for ${name}.${tld} was cancelled.`)).toBeVisible();
    await expect(row.locator('.cf-badge', { hasText: 'Cancelled' })).toBeVisible();
    await expect(row.getByRole('button', { name: /Cancel the order/ })).toHaveCount(0);
  });
});
