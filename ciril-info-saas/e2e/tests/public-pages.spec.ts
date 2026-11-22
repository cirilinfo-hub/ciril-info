import { expect, test } from '@playwright/test';
import { uniqueEmail } from './support/helpers';

/**
 * The public website against the real API and database. Website content (plans, projects,
 * testimonials, FAQs, a published legal page) comes from fixtures prefixed "PW"/"pw-"
 * (see apps/api/scripts/e2e-fixtures.ts), so the tests do not depend on sample data.
 */

const PAGES: { path: string; h1: RegExp }[] = [
  { path: '/', h1: /Build Your Digital Presence/ },
  { path: '/about', h1: /Your Digital Growth Partner/ },
  { path: '/services', h1: /Complete Digital Solutions Under One Roof/ },
  { path: '/services/web-design', h1: /^Website Design$/ },
  { path: '/services/domain-services', h1: /^Domain Services$/ },
  { path: '/our-work', h1: /Projects That Show How We Work/ },
  { path: '/contact', h1: /Build Something Great Together/ },
  { path: '/pricing', h1: /Simple Pricing, No Surprises/ },
  { path: '/hosting', h1: /Fast, Secure Hosting for Every Website/ },
  { path: '/hosting/pw-hosting', h1: /^PW Hosting$/ },
  { path: '/refund-policy', h1: /^PW Refund Policy$/ },
  { path: '/sla', h1: /^Service Level Agreement$/ },
  { path: '/no-such-page', h1: /^Page Not Found$/ },
];

test.describe('Every public page', () => {
  for (const { path, h1 } of PAGES) {
    test(`${path} renders, has one H1 and does not overflow`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(h1);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls horizontally`).toBeLessThanOrEqual(0);
      // Content wider than the screen is only acceptable inside a deliberate scroll/clip container
      // (comparison table, category tabs, the services marquee).
      const clipped = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const contained = (el: Element) => {
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (['auto', 'scroll', 'hidden', 'clip'].includes(ox) && p.getBoundingClientRect().right <= vw + 1) return true;
          }
          return false;
        };
        return Array.from(document.querySelectorAll('main *')).filter((el) => el.getBoundingClientRect().right > vw + 1 && !contained(el)).length;
      });
      expect(clipped, `${path} has content outside the viewport`).toBe(0);
    });
  }
});

test.describe('Services', () => {
  test('home lists the five services and links to each one', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop only');
    await page.goto('/');
    await expect(page.locator('.cx-index-row')).toHaveCount(5);
    await page.getByRole('link', { name: /Explore Development/ }).click();
    await expect(page).toHaveURL(/\/services\/web-development$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Website Development');
    await expect(page).toHaveTitle(/Web Development — Ciril Info/);
    await page.screenshot({ path: 'screenshots/public-service-detail.png', fullPage: true });
  });

  test('FAQ accordion opens one answer at a time with correct ARIA state', async ({ page }) => {
    await page.goto('/services/web-design');
    const q = page.getByRole('button', { name: 'Do you redesign existing websites?' });
    await expect(q).toHaveAttribute('aria-expanded', 'false');
    await q.click();
    await expect(q).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'What do I need to provide?' })).toHaveAttribute('aria-expanded', 'false');
    await q.click();
    await expect(q).toHaveAttribute('aria-expanded', 'false');
  });

  test('"Request a quote" pre-selects the service on the contact form', async ({ page }) => {
    await page.goto('/services/digital-marketing');
    await page.getByRole('link', { name: /Request a Quote/ }).first().click();
    await expect(page).toHaveURL(/\/contact\?service=digital-marketing/);
    await expect(page.getByLabel('Service required *')).toHaveValue('Digital Marketing');
  });
});

test.describe('Our Work', () => {
  test('filters by category and opens a details dialog that returns focus', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop only');
    await page.goto('/our-work');
    await expect(page.getByRole('heading', { name: 'PW Client' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'PW Other Client' })).toBeVisible();

    await page.getByRole('button', { name: 'PW Marketing', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'PW Other Client' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'PW Client', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'All', exact: true }).click();

    const opener = page.getByRole('button', { name: /View project details for PW Client/ });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'PW Client' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Overview text for the test project.')).toBeVisible();
    await expect(dialog.getByText('Scope item one')).toBeVisible();
    await expect(dialog.getByText('Alpha')).toBeVisible();
    await expect(dialog.getByText(/Sample project · concept demonstration/)).toBeVisible();
    await page.screenshot({ path: 'screenshots/public-project-dialog.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe('Pricing and hosting come from the published catalogue', () => {
  test('plan cards show intro, list, saving and renewal prices and switch billing period', async ({ page }) => {
    await page.goto('/pricing');
    await page.getByRole('tab', { name: 'PW Hosting' }).click();
    const starter = page.getByRole('article', { name: 'PW Starter plan' });
    // Yearly is the default: 960 / 12 = ₹80 a month, was ₹100, 20% off, renews at 1440 / 12 = ₹120.
    await expect(starter.locator('.hx-plan-amount strong')).toHaveText('₹80');
    await expect(starter.getByText('Save 20%')).toBeVisible();
    await expect(starter.getByText('₹960 billed for the first year')).toBeVisible();
    await expect(starter.getByText('Renews at ₹120/mo')).toBeVisible();

    await page.getByRole('button', { name: 'Monthly', exact: true }).click();
    await expect(starter.locator('.hx-plan-amount strong')).toHaveText('₹100');
    await expect(starter.getByText('₹100 billed monthly')).toBeVisible();

    await expect(page.getByRole('article', { name: 'PW Pro plan' }).getByText('Recommended')).toBeVisible();
    await page.screenshot({ path: 'screenshots/public-pricing.png', fullPage: true });
  });

  test('comparison table lines features up across plans', async ({ page }) => {
    await page.goto('/hosting/pw-hosting');
    const table = page.getByRole('table', { name: 'PW Hosting plan comparison' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('row', { name: /Websites 1 10/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /Storage 10 GB 50 GB/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /Daily backups/ }).getByRole('img', { name: 'Not included' })).toHaveCount(1);
  });

  test('"Choose Plan" starts real sign-up in the customer portal with the plan attached', async ({ page }) => {
    await page.goto('/hosting/pw-hosting');
    const href = await page.getByRole('article', { name: 'PW Pro plan' }).getByRole('link', { name: /Choose Plan/ }).getAttribute('href');
    expect(href).toMatch(/\/portal\/register\?plan=pw-hosting%2Fpw-pro&cycle=yearly$/);
  });

  test('hosting page lists the hosting plans; published testimonial and FAQ render', async ({ page }) => {
    await page.goto('/hosting');
    await expect(page.getByRole('article', { name: 'PW Pro plan' })).toBeVisible();
    await page.goto('/pricing');
    await expect(page.getByText('PW pricing question?')).toBeVisible();
    await expect(page.getByText('PW testimonial quote')).toBeVisible();
    // Fixtures are flagged as samples, and the page says so.
    await expect(page.getByText('Sample content').first()).toBeVisible();
  });

  test('a product with no published plans says so instead of inventing any', async ({ page }) => {
    await page.goto('/hosting/definitely-not-published');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Definitely Not Published');
    await expect(page.getByText('Plans for this product are not published yet.')).toBeVisible();
    await expect(page.locator('.hx-plan')).toHaveCount(0);
  });
});

test.describe('Contact form', () => {
  test('validates required fields, the email format and consent', async ({ page }) => {
    await page.goto('/contact');
    await page.getByRole('button', { name: 'Send Enquiry' }).click();
    await expect(page.getByText('Enter name.')).toBeVisible();
    await expect(page.getByText('Enter email.')).toBeVisible();
    await expect(page.getByText('Enter a service.')).toBeVisible();
    await expect(page.getByText('Enter project description.')).toBeVisible();
    await expect(page.getByText('Please agree to be contacted so we can reply.')).toBeVisible();

    await page.getByLabel('Email *').fill('not-an-email');
    await page.getByLabel('Email *').blur();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  });

  // The API allows 5 enquiries per IP per 10 minutes, so only one browser project submits.
  test('sends the enquiry to the API and confirms', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'one real submission per run (rate limit)');
    await page.goto('/contact');
    await page.getByLabel('Name *').fill('Playwright Tester');
    await page.getByLabel('Email *').fill(uniqueEmail('contact'));
    await page.getByLabel('Service required *').selectOption('Web Design');
    await page.getByLabel('Project description *').fill('We need a new website for our studio, please get in touch.');
    await expect(page.getByText(/\d+ \/ 1000 characters/)).toBeVisible();
    await page.getByRole('checkbox').check();
    await page.screenshot({ path: 'screenshots/public-contact.png', fullPage: true });
    await page.getByRole('button', { name: 'Send Enquiry' }).click();
    await expect(page.getByRole('heading', { name: 'Thank you, we have your enquiry' })).toBeVisible();
  });

  test('contact details show "to be added" until configured, and WhatsApp stays disabled', async ({ page }) => {
    await page.goto('/contact');
    // Unless an admin has set them, nothing is invented.
    const email = page.locator('.cx-info li').filter({ hasText: 'Email' });
    await expect(email).toContainText(/to be added|@/);
    const wa = page.getByRole('button', { name: 'Chat on WhatsApp' });
    if (await wa.count()) await expect(wa).toBeDisabled();
  });
});

test.describe('Legal pages', () => {
  test('a published page shows its sections; an unpublished one says it is being prepared', async ({ page }) => {
    await page.goto('/refund-policy');
    await expect(page.getByRole('heading', { level: 2, name: 'PW heading' })).toBeVisible();
    await expect(page.getByText('PW body paragraph.')).toBeVisible();
    await expect(page.getByText('PW bullet')).toBeVisible();

    await page.goto('/sla');
    await expect(page.getByText('This page is being prepared and will be published here soon.')).toBeVisible();
  });

  test('the footer links only to legal pages that are published', async ({ page }) => {
    await page.goto('/about');
    const footer = page.locator('footer');
    await expect(footer.getByRole('link', { name: 'Refund Policy' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Service Level Agreement' })).toHaveCount(0);
  });
});

test.describe('Navigation', () => {
  test('main navigation reaches every top-level page on desktop', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop only');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const [label, url] of [['About Us', '/about'], ['Services', '/services'], ['Hosting', '/hosting'], ['Pricing', '/pricing'], ['Our Work', '/our-work'], ['Contact', '/contact']]) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${url}$`));
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });
});
