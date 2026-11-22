/**
 * One Angular build serves three hostnames. The site "mode" decides which
 * route tree is mounted at "/":
 *
 *   cirilinfo.com, www.cirilinfo.com → public website
 *   app.cirilinfo.com                → customer portal
 *   admin.cirilinfo.com              → admin portal
 *
 * Locally (localhost) everything runs on one origin with path prefixes:
 *   /            public website
 *   /portal/...  customer portal
 *   /admin/...   admin portal
 */
export type SiteMode = 'public' | 'customer' | 'admin';

export interface RuntimeConfig {
  mode: SiteMode | 'local';
  apiBaseUrl: string;
  publicUrl: string;
  customerPortalUrl: string;
  adminPortalUrl: string;
}

const PROD_ROOT = 'cirilinfo.com';

export function resolveRuntimeConfig(location: Pick<Location, 'hostname' | 'protocol' | 'port'>): RuntimeConfig {
  const host = location.hostname.toLowerCase();

  if (host === PROD_ROOT || host.endsWith(`.${PROD_ROOT}`)) {
    const sub = host === PROD_ROOT ? '' : host.slice(0, -(PROD_ROOT.length + 1));
    const mode: SiteMode = sub === 'app' ? 'customer' : sub === 'admin' ? 'admin' : 'public';
    return {
      mode,
      apiBaseUrl: `https://api.${PROD_ROOT}`,
      publicUrl: `https://${PROD_ROOT}`,
      customerPortalUrl: `https://app.${PROD_ROOT}`,
      adminPortalUrl: `https://admin.${PROD_ROOT}`,
    };
  }

  // Local development / staging on another host: path-prefixed portals.
  const origin = `${location.protocol}//${location.hostname}${location.port ? ':' + location.port : ''}`;
  return {
    mode: 'local',
    apiBaseUrl: `${location.protocol}//${location.hostname}:3000`,
    publicUrl: origin,
    customerPortalUrl: `${origin}/portal`,
    adminPortalUrl: `${origin}/admin`,
  };
}

export const RUNTIME_CONFIG = resolveRuntimeConfig(
  typeof window !== 'undefined' ? window.location : { hostname: 'localhost', protocol: 'http:', port: '4200' },
);
