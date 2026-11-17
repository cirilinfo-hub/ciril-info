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
      stats: [],
    });
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
