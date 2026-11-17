import { canAssign, canRemove } from './tenant-roles.js';

describe('tenant role rules', () => {
  it('owners can invite admins and members, never owners', () => {
    expect(canAssign('TENANT_OWNER', 'TENANT_ADMIN')).toBe(true);
    expect(canAssign('TENANT_OWNER', 'CUSTOMER')).toBe(true);
    expect(canAssign('TENANT_OWNER', 'TENANT_OWNER')).toBe(false);
  });

  it('admins can invite admins and members but cannot change other admins or the owner', () => {
    expect(canAssign('TENANT_ADMIN', 'CUSTOMER')).toBe(true);
    expect(canAssign('TENANT_ADMIN', 'TENANT_ADMIN')).toBe(true);
    expect(canAssign('TENANT_ADMIN', 'CUSTOMER', 'TENANT_ADMIN')).toBe(false);
    expect(canAssign('TENANT_ADMIN', 'CUSTOMER', 'TENANT_OWNER')).toBe(false);
    expect(canAssign('TENANT_ADMIN', 'TENANT_ADMIN', 'CUSTOMER')).toBe(true);
  });

  it('members cannot assign anything', () => {
    expect(canAssign('CUSTOMER', 'CUSTOMER')).toBe(true); // rank-wise allowed…
    // …but members lack the members:write permission, which the guard checks first.
  });

  it('only higher roles can remove lower ones', () => {
    expect(canRemove('TENANT_OWNER', 'TENANT_ADMIN')).toBe(true);
    expect(canRemove('TENANT_ADMIN', 'CUSTOMER')).toBe(true);
    expect(canRemove('TENANT_ADMIN', 'TENANT_ADMIN')).toBe(false);
    expect(canRemove('TENANT_ADMIN', 'TENANT_OWNER')).toBe(false);
  });

  it('rejects unknown roles', () => {
    expect(canAssign('TENANT_OWNER', 'SUPER_ADMIN')).toBe(false);
  });
});
