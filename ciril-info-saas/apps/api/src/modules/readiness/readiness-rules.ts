/**
 * The launch checklist: what is still in test mode, empty or missing before real customers use the site. Pure rules over
 * plain facts, so every message is tested. Nothing here ever holds a secret, only whether one is set.
 */

export type CheckStatus = 'ok' | 'todo' | 'info';
export type CheckGroup = 'Connections' | 'Business details' | 'Catalogue and content' | 'Security';

export interface Check {
  key: string;
  group: CheckGroup;
  label: string;
  status: CheckStatus;
  /** What it means for you, in plain words. */
  detail: string;
  /** An admin-portal page where it can be fixed, such as "/company". */
  link?: string;
}

export interface ReadinessFacts {
  production: boolean;
  payment: { provider: string; keyIdSet: boolean; keySecretSet: boolean; webhookSecretSet: boolean; liveKey: boolean };
  hosting: { provider: string };
  dns: { provider: string };
  registrar: { provider: string };
  cpanel: { hostSet: boolean; userSet: boolean; tokenSet: boolean; tls: string };
  email: { provider: string };
  storage: { driver: string };
  errorTrackingSet: boolean;
  company: { legalName: boolean; gstin: boolean; address: boolean; stateCode: boolean; email: boolean; phone: boolean; bank: boolean };
  tax: { defaultRate: number | null; defaultName: string | null };
  catalogue: { publishedPlans: number; activeDomainEndings: number; sampleRecords: number };
  legal: { published: number; total: number; missing: string[] };
  security: { staff: number; staffWithoutMfa: number };
}

const list = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function evaluateReadiness(f: ReadinessFacts): Check[] {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // ── Connections ──
  {
    const p = f.payment;
    if (p.provider === 'mock') add({ key: 'payments', group: 'Connections', label: 'Payments', status: 'todo', detail: 'Test mode: no real money moves. Connect Razorpay (see PAYMENTS.md) before taking real orders.' });
    else if (p.provider === 'razorpay') {
      const missing = [!p.keyIdSet && 'the key id', !p.keySecretSet && 'the key secret', !p.webhookSecretSet && 'the webhook secret'].filter(Boolean) as string[];
      if (missing.length) add({ key: 'payments', group: 'Connections', label: 'Payments', status: 'todo', detail: `Razorpay is selected but ${list(missing)} ${missing.length === 1 ? 'is' : 'are'} not set in the server settings.` });
      else if (f.production && !p.liveKey) add({ key: 'payments', group: 'Connections', label: 'Payments', status: 'todo', detail: 'Production is using a Razorpay test key. Use the live key (rzp_live_...) so real payments work.' });
      else if (!f.production) add({ key: 'payments', group: 'Connections', label: 'Payments', status: 'info', detail: p.liveKey ? 'A live Razorpay key is set outside production. Use a test key while developing.' : 'Razorpay test mode: the real checkout opens but no real money moves.' });
      else add({ key: 'payments', group: 'Connections', label: 'Payments', status: 'ok', detail: 'Razorpay is connected with a live key.' });
    } else add({ key: 'payments', group: 'Connections', label: 'Payments', status: 'todo', detail: `The payment provider "${p.provider}" is not available.` });
  }
  {
    const c = f.cpanel;
    const cpanelMissing = [!c.hostSet && 'the server', !c.userSet && 'the user', !c.tokenSet && 'the API token'].filter(Boolean) as string[];
    const h = f.hosting.provider;
    if (h === 'mock') add({ key: 'hosting', group: 'Connections', label: 'Hosting accounts', status: 'todo', detail: 'Test mode: accounts are pretend and nothing is created on a server. Choose cpanel (see HOSTING.md) or manual.' });
    else if (h === 'manual') add({ key: 'hosting', group: 'Connections', label: 'Hosting accounts', status: 'info', detail: 'Manual: your team creates each account in the hosting panel and marks the task done in Admin > Hosting.' });
    else if (h === 'cpanel') {
      if (cpanelMissing.length) add({ key: 'hosting', group: 'Connections', label: 'Hosting accounts', status: 'todo', detail: `cPanel is selected but ${list(cpanelMissing)} ${cpanelMissing.length === 1 ? 'is' : 'are'} not set.` });
      else if (c.tls === 'skip') add({ key: 'hosting', group: 'Connections', label: 'Hosting accounts', status: 'todo', detail: 'cPanel is connected but its security certificate is not being checked. Install a valid certificate on the server and set CPANEL_TLS=verify.' });
      else add({ key: 'hosting', group: 'Connections', label: 'Hosting accounts', status: 'ok', detail: 'Accounts are created on your cPanel/WHM server.' });
    } else add({ key: 'hosting', group: 'Connections', label: 'Hosting accounts', status: 'todo', detail: `The hosting provider "${h}" is not available.` });

    const d = f.dns.provider;
    if (d === 'none') add({ key: 'dns', group: 'Connections', label: 'DNS records', status: 'info', detail: 'Switched off: customers are told DNS is not set up yet and asked to contact you. Choose cpanel once your WHM server is connected.' });
    else if (d === 'mock') add({ key: 'dns', group: 'Connections', label: 'DNS records', status: 'todo', detail: 'Test mode: DNS changes are kept in memory and reach no real server. Choose cpanel to edit your WHM zones.' });
    else if (d === 'cpanel') add({ key: 'dns', group: 'Connections', label: 'DNS records', status: cpanelMissing.length ? 'todo' : 'ok', detail: cpanelMissing.length ? `DNS uses cPanel but ${list(cpanelMissing)} ${cpanelMissing.length === 1 ? 'is' : 'are'} not set.` : 'Customers edit the DNS zones on your WHM server.' });
    else add({ key: 'dns', group: 'Connections', label: 'DNS records', status: 'todo', detail: `The DNS provider "${d}" is not available.` });
  }
  add(
    f.registrar.provider === 'mock'
      ? { key: 'registrar', group: 'Connections', label: 'Domain registrar', status: 'info', detail: 'Test mode: name searches give pretend answers, and your team does each registration, renewal and transfer by hand at your registrar.' }
      : f.registrar.provider === 'rdap'
        ? { key: 'registrar', group: 'Connections', label: 'Domain registrar', status: 'info', detail: 'Names are checked against the public registry, so searches are real. No registrar is connected, so your team does each registration, renewal and transfer by hand at your registrar.' }
        : { key: 'registrar', group: 'Connections', label: 'Domain registrar', status: 'ok', detail: `Connected: ${f.registrar.provider}.` },
  );
  add(
    f.email.provider === 'mailpit'
      ? { key: 'email', group: 'Connections', label: 'Email', status: 'todo', detail: 'Emails go to a local test inbox (Mailpit). Customers will not receive sign-in links or invoices. Set up Resend.' }
      : f.email.provider === 'resend'
        ? { key: 'email', group: 'Connections', label: 'Email', status: 'ok', detail: 'Emails are sent through Resend.' }
        : { key: 'email', group: 'Connections', label: 'Email', status: 'todo', detail: `The email provider "${f.email.provider}" is not available yet. Use Resend.` },
  );
  add(
    f.storage.driver === 'local'
      ? { key: 'storage', group: 'Connections', label: 'File storage', status: 'info', detail: 'Uploaded files are kept on the server’s disk. Make sure that disk is backed up.' }
      : { key: 'storage', group: 'Connections', label: 'File storage', status: 'ok', detail: 'Uploaded files go to cloud storage.' },
  );
  add(
    f.errorTrackingSet
      ? { key: 'errors', group: 'Connections', label: 'Error tracking', status: 'ok', detail: 'Errors are reported to you.' }
      : { key: 'errors', group: 'Connections', label: 'Error tracking', status: 'info', detail: 'Not set up. You would only find out about errors from the server logs.' },
  );

  // ── Business details ──
  {
    const c = f.company;
    const missing = [!c.legalName && 'legal name', !c.gstin && 'GSTIN', !c.address && 'address', !c.stateCode && 'GST state', !c.email && 'email', !c.phone && 'phone'].filter(Boolean) as string[];
    add(missing.length
      ? { key: 'company', group: 'Business details', label: 'Company profile', status: 'todo', detail: `Missing: ${list(missing)}. Invoices and the website show these.`, link: '/company' }
      : { key: 'company', group: 'Business details', label: 'Company profile', status: 'ok', detail: 'Legal name, GSTIN, address and contact details are filled in.', link: '/company' });
  }
  add(
    f.company.bank
      ? { key: 'bank', group: 'Business details', label: 'Bank details for transfers', status: 'ok', detail: 'Customers see your bank and UPI details on an unpaid invoice, and can pay by transfer.', link: '/company' }
      : { key: 'bank', group: 'Business details', label: 'Bank details for transfers', status: 'info', detail: 'Not filled in, so customers can only pay online. Add them if you accept bank transfer or UPI, and record those payments on the invoice.', link: '/company' },
  );
  add(
    f.tax.defaultRate === null
      ? { key: 'tax', group: 'Business details', label: 'GST rate', status: 'todo', detail: 'No default GST rate is set, so invoices carry no tax. Add one in Tax rates.', link: '/tax' }
      : { key: 'tax', group: 'Business details', label: 'GST rate', status: 'ok', detail: `${f.tax.defaultName ?? 'GST'} at ${f.tax.defaultRate}% is added to new invoices. Have your accountant confirm the invoice format.`, link: '/tax' },
  );

  // ── Catalogue and content ──
  add(
    f.catalogue.publishedPlans > 0
      ? { key: 'plans', group: 'Catalogue and content', label: 'Plans and prices', status: 'ok', detail: `${f.catalogue.publishedPlans} published ${f.catalogue.publishedPlans === 1 ? 'plan' : 'plans'}.`, link: '/products' }
      : { key: 'plans', group: 'Catalogue and content', label: 'Plans and prices', status: 'todo', detail: 'No real plan is published yet, so there is nothing to buy. Add plans with prices in Products & Pricing.', link: '/products' },
  );
  add(
    f.catalogue.activeDomainEndings > 0
      ? { key: 'tlds', group: 'Catalogue and content', label: 'Domain prices', status: 'ok', detail: `${f.catalogue.activeDomainEndings} ${f.catalogue.activeDomainEndings === 1 ? 'ending' : 'endings'} on sale.`, link: '/domain-prices' }
      : { key: 'tlds', group: 'Catalogue and content', label: 'Domain prices', status: 'todo', detail: 'No domain ending is on sale, so the Domains page has no prices. Add them in Domain prices.', link: '/domain-prices' },
  );
  add(
    f.legal.published === f.legal.total
      ? { key: 'legal', group: 'Catalogue and content', label: 'Legal pages', status: 'ok', detail: 'All legal pages are published. Have them reviewed by a lawyer.', link: '/legal' }
      : { key: 'legal', group: 'Catalogue and content', label: 'Legal pages', status: 'todo', detail: `Not published yet: ${list(f.legal.missing)}. The website says these are being prepared.`, link: '/legal' },
  );
  add(
    f.catalogue.sampleRecords > 0
      ? { key: 'samples', group: 'Catalogue and content', label: 'Development samples', status: 'todo', detail: `${f.catalogue.sampleRecords} sample ${f.catalogue.sampleRecords === 1 ? 'record' : 'records'} (plans, testimonials, FAQs, projects, domain prices) are still in the database. Remove them with db:purge-samples before launch.` }
      : { key: 'samples', group: 'Catalogue and content', label: 'Development samples', status: 'ok', detail: 'No sample data in the database.' },
  );

  // ── Security ──
  add(
    f.security.staffWithoutMfa > 0
      ? { key: 'mfa', group: 'Security', label: 'Staff two-step sign-in', status: 'todo', detail: `${f.security.staffWithoutMfa} of ${f.security.staff} staff ${f.security.staffWithoutMfa === 1 ? 'has' : 'have'} not turned on two-step verification.`, link: '/staff' }
      : { key: 'mfa', group: 'Security', label: 'Staff two-step sign-in', status: 'ok', detail: 'Every staff member uses two-step verification.', link: '/staff' },
  );

  return checks;
}

export function summarise(checks: readonly Check[]) {
  return { todo: checks.filter((c) => c.status === 'todo').length, ok: checks.filter((c) => c.status === 'ok').length, info: checks.filter((c) => c.status === 'info').length };
}
