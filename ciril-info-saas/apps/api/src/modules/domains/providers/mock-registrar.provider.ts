import type { Availability, RegistrarProvider } from './registrar-provider.js';

const FAMOUS = new Set(['google', 'facebook', 'amazon', 'microsoft', 'apple', 'youtube', 'example', 'cirilinfo', 'wikipedia', 'twitter']);

/**
 * Test-mode registrar. Answers are predictable so tests and demos can show every case:
 * a name that is famous or contains "taken" is taken, one containing "registrarfail" simulates an unreachable registrar,
 * and everything else is available. It never talks to anyone.
 */
export class MockRegistrarProvider implements RegistrarProvider {
  readonly id = 'MOCK';

  async checkAvailability(domains: string[]): Promise<Record<string, Availability>> {
    const out: Record<string, Availability> = {};
    for (const d of domains) {
      const label = d.split('.')[0]!;
      if (label.includes('registrarfail')) throw new Error('The mock registrar is unreachable.');
      out[d] = FAMOUS.has(label) || label.includes('taken') ? 'TAKEN' : 'AVAILABLE';
    }
    return out;
  }
}
