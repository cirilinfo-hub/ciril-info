import { EMPTY_SITE_CLAIMS, readSiteClaims, siteClaimsSchema } from './site-claims.js';

describe('site claims', () => {
  it('starts with nothing claimed', () => {
    expect(EMPTY_SITE_CLAIMS).toEqual({
      uptimePercent: null,
      moneyBackDays: null,
      freeMigrationSites: null,
      freeMigrationPlanSlugs: [],
      dataCentres: [],
      supportHours: null,
      supportResponseTime: null,
      sslWarranty: null,
      domainTransferTime: null,
      freeApps: [],
      freeAppsNote: null,
      stats: [],
    });
  });

  it('keeps free applications as entered, with an optional description', () => {
    const c = siteClaimsSchema.parse({ freeApps: [{ name: ' WordPress ', description: 'Websites and blogs' }, { name: 'Joomla' }], freeAppsNote: 'One click from your control panel.' });
    expect(c.freeApps).toEqual([{ name: 'WordPress', description: 'Websites and blogs' }, { name: 'Joomla', description: null }]);
    expect(c.freeAppsNote).toBe('One click from your control panel.');
    expect(siteClaimsSchema.safeParse({ freeApps: [{ name: '' }] }).success).toBe(false);
    expect(siteClaimsSchema.safeParse({ freeApps: Array.from({ length: 61 }, (_, i) => ({ name: `App ${i}` })) }).success).toBe(false);
  });

  it('still reads claims saved before free applications existed', () => {
    expect(readSiteClaims({ uptimePercent: 99.9 }).freeApps).toEqual([]);
  });

  it('accepts values an admin enters', () => {
    const c = siteClaimsSchema.parse({ uptimePercent: 99.9, moneyBackDays: 30, dataCentres: ['Mumbai'] });
    expect(c.uptimePercent).toBe(99.9);
    expect(c.moneyBackDays).toBe(30);
    expect(c.dataCentres).toEqual(['Mumbai']);
  });

  it('rejects implausible or unknown values', () => {
    expect(siteClaimsSchema.safeParse({ uptimePercent: 150 }).success).toBe(false);
    expect(siteClaimsSchema.safeParse({ moneyBackDays: 0 }).success).toBe(false);
    expect(siteClaimsSchema.safeParse({ madeUpClaim: 'yes' }).success).toBe(false);
  });

  it('reads development sample values (ignoring the _sample marker)', () => {
    expect(readSiteClaims({ uptimePercent: 99.9, _sample: true }).uptimePercent).toBe(99.9);
  });

  it('hides everything rather than failing if stored data is corrupt', () => {
    expect(readSiteClaims({ uptimePercent: 'lots' })).toEqual(EMPTY_SITE_CLAIMS);
    expect(readSiteClaims(null)).toEqual(EMPTY_SITE_CLAIMS);
  });
});
