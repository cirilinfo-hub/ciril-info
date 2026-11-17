const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const vw = parseInt(process.argv[2] || '1440');
  const p = await b.newPage({ viewport: { width: vw, height: 900 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type()==='warning') errs.push(m.type()+': '+m.text().slice(0,300)); });
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto('file:///home/claude/site/index.html');
  await p.waitForTimeout(800);
  const go = async (sel, name) => {
    try { await p.locator(sel).first().click({ timeout: 3000 }); } catch (e) { errs.push('CLICK FAIL ' + sel); return; }
    await p.waitForTimeout(900);
    await p.screenshot({ path: `shots/${vw}-${name}.png`, fullPage: true });
  };
  const steps = (process.argv[3] || 'site').split(',');
  if (steps.includes('site')) {
    await p.screenshot({ path: `shots/${vw}-home.png` });
    await go('footer a[href="/pricing"]', 'pricing');
    await go('footer a[href="/hosting"]', 'hosting');
    await go('footer a[href="/hosting/domain-registration"]', 'domreg');
    await go('footer a[href="/hosting/business-email"]', 'email');
    await go('footer a[href="/hosting/vps-hosting"]', 'vps');
  }
  if (steps.includes('admin')) {
    await go('footer a[href="/admin"]', 'admin-dash');
    for (const [href, n] of [['/admin/customers','customers'],['/admin/hosting','hosting'],['/admin/domains','domains'],['/admin/plans','plans'],['/admin/subscriptions','subs'],['/admin/billing','billing'],['/admin/support','support'],['/admin/users','users'],['/admin/reports','reports'],['/admin/settings','settings']]) {
      if (vw < 1024) { await p.locator('.hx-menu-toggle').click(); await p.waitForTimeout(300); }
      await go(`.hx-side a[href="${href}"]`, 'admin-' + n);
    }
  }
  console.log(errs.join('\n') || 'no console errors');
  await b.close();
})();
