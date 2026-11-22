import { cleanContact, isRegistrantChange, plausiblePhone } from './domain-contacts.service.js';

describe('phone numbers for domain contacts', () => {
  it('takes real Indian mobile and other numbers, and refuses short or made-up ones', () => {
    expect(plausiblePhone('+91 98765 43210', 'IN')).toBe(true);
    expect(plausiblePhone('098765 43210', 'IN')).toBe(true);
    expect(plausiblePhone('12-34-56', 'IN')).toBe(false);
    expect(plausiblePhone('+91 12345 67890', 'IN')).toBe(false); // Indian mobiles start with 6 to 9
    expect(plausiblePhone('+44 20 7946 0958', 'GB')).toBe(true);
    expect(plausiblePhone('+44 123', 'GB')).toBe(false);
  });
});

const base = { firstName: 'Asha', lastName: 'Rao', organisation: 'Rao Studio', email: 'asha@example.in', phone: '+91 98765 43210', address1: '1 MG Road', city: 'Pune', state: 'Maharashtra', postalCode: '411001', country: 'IN' };

describe('domain contact details', () => {
  it('are stored trimmed, with the email in lower case, the country in capitals, and empty optional fields left out', () => {
    expect(cleanContact({ ...base, email: ' Asha@Example.IN ', country: 'in', address2: '  ', organisation: ' Rao Studio ' })).toEqual({ ...base });
  });

  it('a change of name, organisation or email is a change of owner; an address or phone change is not', () => {
    expect(isRegistrantChange(base, { ...base, address1: '2 MG Road', phone: '+91 90000 00000' })).toBe(false);
    expect(isRegistrantChange(base, { ...base, lastName: 'Menon' })).toBe(true);
    expect(isRegistrantChange(base, { ...base, organisation: undefined })).toBe(true);
    expect(isRegistrantChange(base, { ...base, email: 'ASHA@example.in' })).toBe(false); // the same address
    expect(isRegistrantChange(null, base)).toBe(true); // nothing on record yet
  });
});
