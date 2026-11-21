import type { EmailMessage } from './mail.types.js';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Only http(s) links may be rendered as buttons. */
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : '#');

/** Brand-consistent, table-free layout (design tokens: violet-600 button, ink-900 text, Urbanist with system fallback). */
function layout(title: string, paragraphs: string[], button?: { label: string; url: string }, footnote?: string): string {
  const btn = button
    ? `<p style="margin:28px 0"><a href="${esc(safeUrl(button.url))}" style="display:inline-block;background:#6352E6;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px">${esc(button.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F5F3FF;padding:32px 16px;font-family:Urbanist,-apple-system,Segoe UI,Roboto,sans-serif;color:#1C1A33">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
<p style="margin:0 0 24px;font-size:22px;font-weight:700;letter-spacing:-.02em">ciril<span style="color:#7B6CF6">info</span></p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:16px;line-height:26px;color:#46445E">${esc(p)}</p>`).join('')}
${btn}
${footnote ? `<p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#6E6B86">${esc(footnote)}</p>` : ''}
</div></body></html>`;
}

function text(title: string, paragraphs: string[], button?: { label: string; url: string }, footnote?: string) {
  return [title, '', ...paragraphs, ...(button ? ['', `${button.label}: ${button.url}`] : []), ...(footnote ? ['', footnote] : [])].join('\n');
}

function build(subject: string, title: string, paragraphs: string[], button?: { label: string; url: string }, footnote?: string): RenderedEmail {
  return { subject, html: layout(title, paragraphs, button, footnote), text: text(title, paragraphs, button, footnote) };
}

const IGNORE = 'If you did not request this, you can ignore this email.';

export function renderEmail(m: EmailMessage): RenderedEmail {
  switch (m.template) {
    case 'verify-email':
      return build('Verify your email address', `Welcome, ${m.data.firstName}`, ['Confirm your email address to finish setting up your Ciril Info account. The link expires in 48 hours.'], { label: 'Verify Email', url: m.data.link }, IGNORE);
    case 'password-reset':
      return build('Reset your password', 'Reset your password', [`Hi ${m.data.firstName}, we received a request to reset your password. The link expires in 1 hour and can be used once.`], { label: 'Choose New Password', url: m.data.link }, IGNORE);
    case 'password-changed':
      return build('Your password was changed', 'Your password was changed', [`Hi ${m.data.firstName}, the password for your Ciril Info account was just changed and other devices were signed out.`, 'If this wasn’t you, reset your password immediately and contact support.']);
    case 'account-exists':
      return build('You already have an account', 'You already have an account', [`Hi ${m.data.firstName}, someone tried to sign up with this email address, which already has a Ciril Info account.`, 'If it was you, sign in instead. Forgot your password? You can reset it.'], { label: 'Sign In', url: m.data.loginLink }, `Reset password: ${m.data.resetLink}`);
    case 'invitation':
      return build(`Join ${m.data.organisation} on Ciril Info`, `You’re invited to ${m.data.organisation}`, [`${m.data.inviterName} invited you to join ${m.data.organisation} as ${m.data.roleName}. The invitation expires in 7 days.`], { label: 'Accept Invitation', url: m.data.link }, IGNORE);
    case 'staff-invitation':
      return build('You’re invited to the Ciril Info admin portal', 'Join the Ciril Info team', [`${m.data.inviterName} invited you to the admin portal as ${m.data.roleName}. You will set a password and two-step verification. The invitation expires in 7 days.`], { label: 'Accept Invitation', url: m.data.link }, IGNORE);
    case 'mfa-enabled':
      return build('Two-step verification is on', 'Two-step verification is on', [`Hi ${m.data.firstName}, two-step verification is now protecting your account. Keep your recovery codes somewhere safe.`]);
    case 'hosting-ready':
      return build(`Your hosting for ${m.data.domain} is ready`, 'Your hosting is ready', [`We have set up hosting for ${m.data.domain}. You can see its status in your client area.`], { label: 'Open Hosting', url: m.data.link });
    case 'domain-registered':
      return build(`${m.data.domain} is registered`, 'Your domain is registered', [`${m.data.domain} is now registered in your name. You can see its details and expiry date in your client area.`], { label: 'Open Domains', url: m.data.link });
    case 'domain-transferred':
      return build(`${m.data.domain} has been transferred to us`, 'Your domain has been transferred', [`${m.data.domain} is now with us. It is registered until ${m.data.expiresOn}, and you can manage its DNS records in your client area.`], { label: 'Open Domains', url: m.data.link });
    case 'domain-transfer-code':
      return build(`The transfer code for ${m.data.domain} is ready`, 'Your transfer code is ready', [`${m.data.domain} is unlocked and its authorisation code is ready. Sign in to see it, then give it to your new registrar to start the transfer.`, 'For your security the code is shown in your client area, not in this email. If you did not ask for this, withdraw the transfer there.'], { label: 'Open Domains', url: m.data.link });
    case 'domain-transferred-out':
      return build(`${m.data.domain} has moved to its new registrar`, 'Your domain has moved', [`${m.data.domain} has been transferred to your new registrar, who now manages it. It no longer appears in your client area as active.`], { label: 'Open Domains', url: m.data.link });
    case 'domain-renewed':
      return build(`${m.data.domain} is renewed`, 'Your domain is renewed', [`${m.data.domain} has been renewed. It is now registered until ${m.data.expiresOn}.`], { label: 'Open Domains', url: m.data.link });
    case 'domain-expiring':
      return build(`${m.data.domain} ${m.data.when}`, `Your domain ${m.data.when}`, [`${m.data.domain} ${m.data.when}.`, 'Renew it to keep your website and email working. If a domain is not renewed in time, you can lose the name.'], { label: 'Renew Domain', url: m.data.link });
    case 'renewal-invoice':
      return build(`Renewal invoice ${m.data.number}`, 'Your renewal invoice is ready', [`Invoice ${m.data.number} for ${m.data.total} is due on ${m.data.dueDate}.`, 'Pay it before the due date so your service continues without interruption.'], { label: 'View Invoice', url: m.data.link });
    case 'ticket-reply':
      return build(`New reply on ${m.data.ref}`, `We replied to ${m.data.ref}`, [`Hi ${m.data.firstName}, our support team replied to your ticket “${m.data.subject}”.`, 'For your security the reply is shown in your client area, not in this email.'], { label: 'View Reply', url: m.data.link });
    case 'new-sign-in':
      return build('New sign-in to your account', 'New sign-in', [`Hi ${m.data.firstName}, your account was signed in to on ${m.data.when} from ${m.data.device} (IP ${m.data.ip}).`, 'If this wasn’t you, reset your password now.']);
  }
}
