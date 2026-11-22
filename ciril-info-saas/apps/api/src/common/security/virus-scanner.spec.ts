import { randomBytes } from 'node:crypto';
import { EICAR, FakeClamd } from '../../../test/support/fake-clamd.js';
import { ScannerUnavailable, clamdScan } from './virus-scanner.js';

const PORT = 43926;

describe('asking ClamAV about a file (INSTREAM)', () => {
  const clamd = new FakeClamd(PORT);
  beforeAll(() => clamd.start());
  afterAll(() => clamd.stop());
  afterEach(() => {
    clamd.reply = null;
    clamd.hang = false;
  });

  it('streams the whole file in chunks and reports a clean one', async () => {
    const body = randomBytes(200 * 1024 + 17); // more than one chunk
    expect(await clamdScan('127.0.0.1', PORT, body, 5000)).toEqual({ clean: true });
    expect(Buffer.compare(clamd.received.at(-1)!, body)).toBe(0);
  });

  it('reports the signature of an infected file', async () => {
    expect(await clamdScan('127.0.0.1', PORT, Buffer.from(`hello ${EICAR}`), 5000)).toEqual({ clean: false, signature: 'Eicar-Test-Signature' });
  });

  it('treats an odd answer, no answer, or no daemon as "cannot check"', async () => {
    clamd.reply = 'INSTREAM size limit exceeded. ERROR';
    await expect(clamdScan('127.0.0.1', PORT, Buffer.from('x'), 5000)).rejects.toBeInstanceOf(ScannerUnavailable);
    clamd.reply = null;
    clamd.hang = true;
    await expect(clamdScan('127.0.0.1', PORT, Buffer.from('x'), 300)).rejects.toThrow(/did not answer/);
    await expect(clamdScan('127.0.0.1', PORT + 1, Buffer.from('x'), 2000)).rejects.toThrow(/could not be reached/);
  });
});
