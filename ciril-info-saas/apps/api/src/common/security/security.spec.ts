import { randomBytes } from 'node:crypto';
import { SecretBox, randomToken, safeEqual, sha256Hex } from './crypto.js';
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUrl, totp, verifyTotp } from './totp.js';

describe('crypto', () => {
  it('hashes tokens deterministically and never returns the input', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('generates unique 256-bit URL-safe tokens', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('compares strings in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  describe('SecretBox (AES-256-GCM)', () => {
    const box = new SecretBox(randomBytes(32).toString('base64'));

    it('round-trips and uses a fresh IV each time', () => {
      const a = box.encrypt('JBSWY3DPEHPK3PXP');
      const b = box.encrypt('JBSWY3DPEHPK3PXP');
      expect(a).not.toBe(b);
      expect(a).not.toContain('JBSWY3DPEHPK3PXP');
      expect(box.decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
    });

    it('detects tampering', () => {
      const enc = box.encrypt('secret');
      const parts = enc.split('.');
      parts[3] = Buffer.from('tampered').toString('base64url');
      expect(() => box.decrypt(parts.join('.'))).toThrow();
    });

    it('binds ciphertext to its owner via associated data', () => {
      const enc = box.encrypt('secret', 'user:1');
      expect(box.decrypt(enc, 'user:1')).toBe('secret');
      expect(() => box.decrypt(enc, 'user:2')).toThrow();
    });

    it('fails with a different key', () => {
      const other = new SecretBox(randomBytes(32).toString('base64'));
      expect(() => other.decrypt(box.encrypt('x'))).toThrow();
    });
  });
});

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  const rfcKey = Buffer.from('12345678901234567890', 'ascii');
  const rfcSecret = base32Encode(rfcKey);

  it('matches the RFC 4226 HOTP test vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => expect(hotp(rfcKey, counter)).toBe(code));
  });

  it('matches the RFC 6238 SHA-1 TOTP vectors (8 digits)', () => {
    expect(totp(rfcSecret, 59_000, 8)).toBe('94287082');
    expect(totp(rfcSecret, 1_111_111_109_000, 8)).toBe('07081804');
    expect(totp(rfcSecret, 1_234_567_890_000, 8)).toBe('89005924');
    expect(totp(rfcSecret, 20_000_000_000_000, 8)).toBe('65353130');
  });

  it('round-trips base32', () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts the current code and ±30s drift, rejects older ones', () => {
    const s = generateTotpSecret();
    const now = 1_800_000_000_000;
    expect(verifyTotp(s, totp(s, now), now)).not.toBeNull();
    expect(verifyTotp(s, totp(s, now - 30_000), now)).not.toBeNull();
    expect(verifyTotp(s, totp(s, now + 30_000), now)).not.toBeNull();
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBeNull();
  });

  it('rejects malformed codes', () => {
    const s = generateTotpSecret();
    expect(verifyTotp(s, '12345')).toBeNull();
    expect(verifyTotp(s, 'abcdef')).toBeNull();
  });

  it('builds an otpauth URL for authenticator apps', () => {
    const url = otpauthUrl('JBSWY3DPEHPK3PXP', 'admin@cirilinfo.com');
    expect(url).toMatch(/^otpauth:\/\/totp\/CirilInfo%3Aadmin%40cirilinfo\.com\?/);
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
  });
});
