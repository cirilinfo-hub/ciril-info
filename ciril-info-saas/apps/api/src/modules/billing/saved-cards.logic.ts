const DAY = 86_400_000;

/** How many times one renewal invoice is charged automatically before it is left to the customer. */
export const AUTO_CHARGE_ATTEMPTS = 3;

/**
 * When a renewal invoice is charged to the saved card: a day before it is due, but never sooner than a day after the
 * customer was emailed the invoice (which names the card, the amount and this date). That email is the advance notice
 * card standing instructions need.
 */
export function autoChargeDate(issuedAt: Date, dueAt: Date): Date {
  return new Date(Math.max(dueAt.getTime() - DAY, issuedAt.getTime() + DAY));
}

/** A retry waits a day after the previous attempt. */
export function nextAttemptDue(lastAt: Date | null, now: Date): boolean {
  return !lastAt || now.getTime() - lastAt.getTime() >= DAY;
}

/**
 * The phone number in the form card standing instructions need: "+91" and ten digits for an Indian number written
 * without a country code, otherwise "+" and the digits given. Null when it cannot be a phone number.
 */
export function cardContact(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (/^0?\d{10}$/.test(digits) && !trimmed.startsWith('+')) return `+91${digits.slice(-10)}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** "Visa ending 4242", for emails and notices. */
export function cardLabel(c: { network: string | null; last4: string | null }): string {
  return `${c.network ?? 'Card'}${c.last4 ? ` ending ${c.last4}` : ''}`;
}
