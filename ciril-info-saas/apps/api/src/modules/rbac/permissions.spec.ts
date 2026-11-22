import {
  ALL_PLATFORM_PERMISSIONS,
  ALL_TENANT_PERMISSIONS,
  PLATFORM_ROLES,
  TENANT_ROLES,
  resolvePermissions,
} from './permissions.js';

const role = (key: string) => PLATFORM_ROLES.find((r) => r.key === key)!;
const perms = (key: string) => resolvePermissions(role(key), ALL_PLATFORM_PERMISSIONS);

describe('RBAC definitions', () => {
  it('defines the seven roles from the brief', () => {
    expect(PLATFORM_ROLES.map((r) => r.key)).toEqual(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_AGENT']);
    expect(TENANT_ROLES.map((r) => r.key)).toEqual(['TENANT_OWNER', 'TENANT_ADMIN', 'CUSTOMER']);
  });

  it('only references permissions that exist', () => {
    for (const r of PLATFORM_ROLES) for (const p of resolvePermissions(r, ALL_PLATFORM_PERMISSIONS)) expect(ALL_PLATFORM_PERMISSIONS).toContain(p);
    for (const r of TENANT_ROLES) for (const p of resolvePermissions(r, ALL_TENANT_PERMISSIONS)) expect(ALL_TENANT_PERMISSIONS).toContain(p);
  });

  it('reserves staff management and system settings for Super Admin', () => {
    for (const key of ['PLATFORM_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_AGENT']) {
      expect(perms(key)).not.toContain('users:write');
      expect(perms(key)).not.toContain('settings:write');
    }
    expect(perms('SUPER_ADMIN')).toEqual(expect.arrayContaining(['users:write', 'settings:write']));
  });

  it('lets only Finance Admin and Super Admin approve refunds', () => {
    const withRefund = PLATFORM_ROLES.filter((r) => resolvePermissions(r, ALL_PLATFORM_PERMISSIONS).includes('billing:refund')).map((r) => r.key);
    expect(withRefund.sort()).toEqual(['FINANCE_ADMIN', 'SUPER_ADMIN']);
  });

  it('keeps Support Agents out of pricing and billing changes', () => {
    expect(perms('SUPPORT_AGENT')).not.toContain('pricing:write');
    expect(perms('SUPPORT_AGENT')).not.toContain('billing:write');
  });

  it('does not let a plain customer member order services, pay or manage the team', () => {
    const member = resolvePermissions(TENANT_ROLES.find((r) => r.key === 'CUSTOMER')!, ALL_TENANT_PERMISSIONS);
    expect(member).not.toContain('services:order');
    expect(member).not.toContain('billing:pay');
    expect(member).not.toContain('members:write');
  });
});
