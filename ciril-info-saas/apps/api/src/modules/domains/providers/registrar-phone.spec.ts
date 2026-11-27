import { registrarPhone, splitPhone } from './registrar-phone.js';

describe('registrarPhone', () => {
  it('formats Indian numbers however they were typed', () => {
    for (const raw of ['+91 98765 43210', '+919876543210', '098765 43210', '9876543210', '91 9876543210', '(+91) 98765-43210']) {
      expect(registrarPhone(raw, 'IN')).toBe('+91.9876543210');
    }
  });

  it('keeps a foreign number with its own code, and refuses what it cannot read', () => {
    expect(registrarPhone('+44 20 7946 0958', 'IN')).toBe('+44.2079460958');
    expect(registrarPhone('+1 480 505 8800', 'US')).toBe('+1.4805058800');
    expect(registrarPhone('12', 'IN')).toBeNull();
    expect(registrarPhone('5551234', 'ZZ')).toBeNull();
  });

  it('splits into country code and number', () => {
    expect(splitPhone('098765 43210', 'IN')).toEqual({ cc: '91', number: '9876543210' });
    expect(splitPhone('12', 'IN')).toBeNull();
  });
});
