const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export const MIN_NAMESERVERS = 2;
export const MAX_NAMESERVERS = 13;

/**
 * Cleans up a list of nameservers the customer typed (case, spaces, a trailing dot, duplicates) and checks it. Returns the
 * clean list, or the problem in words the customer can act on.
 */
export function checkNameservers(raw: readonly string[], domain: string): { ok: true; nameservers: string[] } | { ok: false; problem: string } {
  const list = [...new Set(raw.map((n) => n.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean))];
  if (list.length < MIN_NAMESERVERS) return { ok: false, problem: `Enter at least ${MIN_NAMESERVERS} different nameservers. Registries require two or more.` };
  if (list.length > MAX_NAMESERVERS) return { ok: false, problem: `Enter at most ${MAX_NAMESERVERS} nameservers.` };
  const bad = list.find((n) => !HOST.test(n));
  if (bad) return { ok: false, problem: `"${bad}" is not a valid nameserver name. Use names such as ns1.example.com.` };
  // A nameserver inside the domain itself needs glue records (its IP address registered at the registry), which this form cannot set.
  const inside = list.find((n) => n === domain || n.endsWith(`.${domain}`));
  if (inside) return { ok: false, problem: `${inside} is inside ${domain} itself, which needs glue records at the registry. Ask our support team to set this up.` };
  return { ok: true, nameservers: list };
}
