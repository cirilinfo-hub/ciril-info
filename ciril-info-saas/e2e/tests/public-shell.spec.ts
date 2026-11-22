import { expect, test } from '@playwright/test';

test.describe('Public website shell', () => {
  test('home renders the hero and primary calls to action', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Ciril Info/);
    // Words must stay separated for wrapping and screen readers.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Build Your Digital Presence. Accelerate Your Growth.',
    );
    await expect(page.getByRole('link', { name: /Let’s Get Started/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Explore Our Services' })).toBeVisible();
  });

  test('never scrolls horizontally and no element overflows the viewport', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // body has overflow-x:hidden (design), so also check that content isn't silently clipped.
    const widest = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      // The services marquee is deliberately wider than the screen, clipped by its own container.
      const contained = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= vw + 1) return true;
        }
        return false;
      };
      return Array.from(document.querySelectorAll('main *')).filter((el) => el.getBoundingClientRect().right > vw + 1 && !contained(el)).length;
    });
    expect(widest).toBe(0);
  });

  test('skip link moves focus to main content', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
  });

  test('desktop shows main navigation with Home marked current', async ({ page, isMobile }, info) => {
    test.skip(isMobile || info.project.name !== 'desktop', 'desktop only');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Get a Quote/ }).first()).toBeVisible();
  });

  test('mobile menu opens, traps focus and closes on Escape', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'mobile only');
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Open menu' });
    await toggle.click();
    const sheet = page.getByRole('navigation', { name: 'Mobile' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: /Home/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });

  test('footer shows placeholders instead of invented contact details', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer.getByText('Email address to be added')).toBeVisible();
    await expect(footer.getByText(`© ${new Date().getFullYear()} Ciril Info`)).toBeVisible();
  });

  test('visual snapshot for design comparison', async ({ page }, info) => {
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500); // let the headline line-reveal animation finish
    await page.screenshot({ path: `test-results/home-${info.project.name}.png`, fullPage: false });
  });

  test('visitors can reach the customer and admin sign-in pages', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Wide screens show the header menu; narrow ones the hamburger sheet.
    if (await page.getByRole('button', { name: 'Sign In' }).isVisible()) {
      await page.getByRole('button', { name: 'Sign In' }).click();
      await expect(page.getByRole('menuitem', { name: /Customer Login/ })).toHaveAttribute('href', /\/portal\/login$/);
      await expect(page.getByRole('menuitem', { name: /Admin Login/ })).toHaveAttribute('href', /\/admin\/login$/);
      await page.screenshot({ path: 'screenshots/public-signin-menu.png', clip: { x: 800, y: 0, width: 640, height: 260 } });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitem', { name: /Customer Login/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.getByRole('menuitem', { name: /Customer Login/ }).click();
      await expect(page).toHaveURL(/\/portal\/login/);
      await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Open menu' }).click();
      await expect(page.getByRole('link', { name: 'Customer Login' }).first()).toHaveAttribute('href', /\/portal\/login$/);
      await page.getByRole('link', { name: 'Admin Login' }).first().click();
      await expect(page).toHaveURL(/\/admin\/login/);
    }
  });
});
