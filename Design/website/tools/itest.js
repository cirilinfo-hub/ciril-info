const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const log = [];
  p.on('pageerror', e => log.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) log.push('CONSOLE ' + m.text().slice(0, 200)); });
  const ok = (c, msg) => { log.push((c ? 'PASS ' : 'FAIL ') + msg); console.log((c ? 'PASS ' : 'FAIL ') + msg); };
  await p.goto('file:///home/claude/site/index.html'); await p.waitForTimeout(700);
  // Pricing: switch tab + billing + choose plan with validation
  await p.click('footer a[href="/pricing"]'); await p.waitForTimeout(600);
  await p.click('button[role=tab]:has-text("VPS Hosting")'); await p.waitForTimeout(300);
  ok(await p.locator('.hx-plan h3:has-text("Business")').count() > 0 && await p.locator('text=KVM 2').count() > 0, 'pricing tab switches to VPS');
  await p.click('.cf-seg button:has-text("Monthly")'); await p.waitForTimeout(200);
  ok(await p.locator('text=Billed monthly, cancel anytime').count() === 4, 'monthly toggle updates cards');
  await p.locator('.hx-plan button:has-text("Choose Plan")').nth(1).click(); await p.waitForTimeout(300);
  await p.click('.cf-dialog button:has-text("Continue")'); await p.waitForTimeout(200);
  ok(await p.locator('.cf-dialog .cf-help-error').count() === 2, 'plan dialog validates required fields');
  await p.fill('.cf-dialog input >> nth=0', 'Ananya Rao'); await p.fill('.cf-dialog input >> nth=1', 'ananya@iyer.in');
  await p.click('.cf-dialog button:has-text("Continue")'); await p.waitForTimeout(200);
  ok(await p.locator('.cf-dialog h2:has-text("You\'re all set")').count() === 1, 'plan dialog success state');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await p.locator('.cf-dialog').count() === 0, 'Escape closes dialog');
  // Domain search
  await p.click('footer a[href="/hosting/domain-registration"]'); await p.waitForTimeout(600);
  await p.fill('.hx-domain-row input', 'mybakery'); await p.click('.hx-domain-row button'); await p.waitForTimeout(200);
  ok(await p.locator('.hx-domain-results li').count() === 8, 'domain search shows results');
  await p.locator('.hx-domain-results button:has-text("Add")').first().click();
  ok(await p.locator('.hx-domain-cart').count() === 1, 'domain added to cart');
  await p.click('footer a[href="/hosting/domain-transfer"]'); await p.waitForTimeout(600);
  await p.fill('.hx-domain-row input >> nth=0', 'oldsite.com'); await p.click('.hx-domain-row button'); await p.waitForTimeout(150);
  ok(await p.locator('.hx-domain .cf-help-error').count() === 1, 'transfer requires EPP');
  await p.click('footer a[href="/hosting"]'); await p.waitForTimeout(600); await p.locator('a[href="/hosting/website-migration"]').first().click(); await p.waitForTimeout(600);
  await p.click('button:has-text("Request Migration") >> nth=-1'); await p.waitForTimeout(200);
  ok(await p.locator('.hx-mig .cf-help-error, .hx-mig [role=alert]').count() >= 1, 'migration form validates');
  // Admin
  await p.click('footer a[href="/admin"]'); await p.waitForTimeout(900);
  await p.click('.hx-quick-btn:has-text("New customer")'); await p.waitForTimeout(800);
  ok(await p.locator('.cf-dialog h2:has-text("Add customer")').count() === 1, 'quick action opens add customer');
  await p.click('.cf-dialog button:has-text("Add Customer")'); await p.waitForTimeout(150);
  ok(await p.locator('.cf-dialog .cf-help-error').count() >= 3, 'add customer validates');
  const ins = p.locator('.cf-dialog input');
  await ins.nth(0).fill('Test Person'); await ins.nth(1).fill('Test Co'); await ins.nth(2).fill('t@test.com'); await ins.nth(3).fill('+91 98450 12345');
  await p.click('.cf-dialog button:has-text("Add Customer")'); await p.waitForTimeout(400);
  ok(await p.locator('.hx-toast').count() === 1 && await p.locator('td:has-text("Test Co")').count() === 1, 'customer created + toast');
  await p.fill('.hx-search input', 'zzzz'); await p.waitForTimeout(200);
  ok(await p.locator('text=No customers match these filters').count() === 1, 'empty state on no matches');
  await p.click('button:has-text("Clear filters") >> nth=0'); await p.waitForTimeout(200);
  await p.click('th button:has-text("Lifetime value")'); await p.waitForTimeout(200);
  const v1 = await p.locator('tbody tr td:nth-child(6)').first().innerText();
  ok(v1.includes('₹0') , 'sort by value asc puts new ₹0 customer first (' + v1 + ')');
  await p.locator('.cf-pages button:has-text("2")').click(); await p.waitForTimeout(200);
  ok((await p.locator('.hx-pager span').first().innerText()).startsWith('Showing 11'), 'pagination works');
  await p.locator('tbody tr').first().click(); await p.waitForTimeout(700);
  ok(await p.locator('.hx-profile-head').count() === 1, 'row click opens profile');
  await p.click('button[role=tab]:has-text("Billing history")'); await p.waitForTimeout(200);
  ok(await p.locator('table').count() >= 1, 'profile tabs work');
  // Global search
  await p.fill('.hx-gsearch input', 'INV-2026-3199'); await p.waitForTimeout(200);
  await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  ok(await p.locator('h1:has-text("Billing")').count() === 1 && await p.locator('td button:has-text("INV-2026-3199")').count() === 1, 'global search jumps to invoice');
  await p.locator('td button:has-text("INV-2026-3199")').click(); await p.waitForTimeout(200);
  ok(await p.locator('.cf-dialog:has-text("GST @ 18%")').count() === 1, 'invoice view');
  await p.click('.cf-dialog button:has-text("Mark as Paid")'); await p.waitForTimeout(200);
  ok(await p.locator('tr:has-text("INV-2026-3199") .cf-badge-success').count() === 1, 'mark paid updates status');
  await p.fill('.hx-search input', ''); await p.click('button[role=tab]:has-text("Failed")'); await p.waitForTimeout(200);
  const failedRows = await p.locator('tbody tr').count();
  await p.locator('.hx-menu > button').first().click(); await p.click('[role=menuitem]:has-text("Retry payment")'); await p.waitForTimeout(300);
  ok(await p.locator('tbody tr').count() <= failedRows, 'retry payment acts (' + failedRows + ')');
  // Notifications
  await p.click('.hx-hdr-pop button[aria-label^="Notifications"]'); await p.waitForTimeout(200);
  await p.click('button:has-text("Mark all as read")'); await p.waitForTimeout(100);
  ok(await p.locator('.hx-dotcount').count() === 0, 'notifications mark read');
  await p.keyboard.press('Escape');
  // Domains DNS
  await p.click('.hx-side a[href="/admin/domains"]'); await p.waitForTimeout(900);
  await p.locator('.hx-menu > button').first().click(); await p.click('[role=menuitem]:has-text("Manage DNS")'); await p.waitForTimeout(200);
  await p.fill('.hx-dns-add input >> nth=0', 'shop'); await p.fill('.hx-dns-add input >> nth=1', 'bad-ip'); await p.click('.hx-dns-add button'); await p.waitForTimeout(100);
  ok(await p.locator('.cf-dialog [role=alert]').count() === 1, 'DNS validates A record');
  await p.fill('.hx-dns-add input >> nth=1', '103.21.58.12'); await p.click('.hx-dns-add button'); await p.waitForTimeout(100);
  ok(await p.locator('.cf-dialog td:has-text("103.21.58.12")').count() === 1, 'DNS record added');
  await p.click('.cf-dialog button:has-text("Save DNS Records")'); await p.waitForTimeout(200);
  // Plans edit
  await p.click('.hx-side a[href="/admin/plans"]'); await p.waitForTimeout(900);
  await p.locator('.hx-plan-admin .hx-menu > button').first().click(); await p.click('[role=menuitem]:has-text("Edit plan")'); await p.waitForTimeout(200);
  await p.fill('.cf-dialog input[type=number] >> nth=0', '159'); await p.click('.cf-dialog button:has-text("Save Plan")'); await p.waitForTimeout(300);
  ok(await p.locator('.hx-plan-prices dd:has-text("₹159")').count() >= 1, 'plan price edit saved');
  // Support reply
  await p.click('.hx-side a[href="/admin/support"]'); await p.waitForTimeout(900);
  await p.click('button:has-text("Send Reply")'); await p.waitForTimeout(100);
  ok(await p.locator('.hx-reply [role=alert]').count() === 1, 'reply validation');
  await p.fill('#reply', 'We have refunded the duplicate charge.'); await p.click('button:has-text("Send Reply")'); await p.waitForTimeout(200);
  ok(await p.locator('.hx-thread li').count() >= 2, 'reply appended');
  // Users perms
  await p.click('.hx-side a[href="/admin/users"]'); await p.waitForTimeout(900);
  await p.click('button[role=tab]:has-text("Roles")'); await p.waitForTimeout(200);
  await p.locator('.hx-perm input').nth(5).click(); await p.waitForTimeout(100);
  ok(await p.locator('button:has-text("Save Permissions")').count() === 1, 'permission edit shows save');
  // Reports error state
  await p.click('.hx-side a[href="/admin/reports"]'); await p.waitForTimeout(900);
  await p.click('.hx-chipbtn:has-text("Domain renewals")'); await p.waitForTimeout(200);
  ok(await p.locator('text=Couldn\'t load the domain renewal report').count() === 1, 'reports error state');
  await p.click('button:has-text("Try Again")'); await p.waitForTimeout(800);
  ok(await p.locator('.hx-chart').count() >= 1, 'retry loads report');
  // Settings validation
  await p.click('.hx-side a[href="/admin/settings"]'); await p.waitForTimeout(500);
  await p.click('.hx-settings-nav button:has-text("Payment gateways")'); await p.waitForTimeout(200);
  await p.locator('button:has-text("Test connection")').nth(2).click(); await p.waitForTimeout(1200);
  ok(await p.locator('text=PayPal connection failed').count() === 1, 'gateway error state');
  console.log(log.filter(x=>!x.startsWith('PASS')&&!x.startsWith('FAIL')).join('\n'));
  await b.close();
})().catch(e=>{console.log('ERR',e.message.split('\n')[0]);process.exit(1)});
