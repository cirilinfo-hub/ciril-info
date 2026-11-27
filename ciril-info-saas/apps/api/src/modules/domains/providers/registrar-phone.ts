const CALLING_CODES: Record<string, string> = { IN: '91', US: '1', CA: '1', GB: '44', AE: '971', SG: '65', AU: '61', NZ: '64', DE: '49', FR: '33', MY: '60', SA: '966', QA: '974', LK: '94', NP: '977', BD: '880' };

/** "+91 98765 43210", "098765 43210" or "9876543210" (in India) become "+91.9876543210", the form registrars expect. */
export function registrarPhone(raw: string, country: string): string | null {
  const plus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  const cc = CALLING_CODES[country.toUpperCase()];
  if (plus) {
    const code = cc && digits.startsWith(cc) ? cc : Object.values(CALLING_CODES).find((c) => digits.startsWith(c));
    if (!code) return null;
    digits = digits.slice(code.length);
    return digits.length >= 4 && digits.length <= 14 ? `+${code}.${digits}` : null;
  }
  if (!cc) return null;
  if (digits.startsWith(cc) && digits.length > 10) digits = digits.slice(cc.length);
  digits = digits.replace(/^0+/, '');
  return digits.length >= 4 && digits.length <= 14 ? `+${cc}.${digits}` : null;
}

/** The same number split the way some registrars take it: country code and the rest ("91", "9876543210"). */
export function splitPhone(raw: string, country: string): { cc: string; number: string } | null {
  const p = registrarPhone(raw, country);
  if (!p) return null;
  const [cc, number] = p.slice(1).split('.');
  return { cc: cc!, number: number! };
}
