import { signal } from '@angular/core';
import { toApiError } from '../../../core/api/api-error';

/** Shared state for admin pages: a busy flag plus success and error notices. Pages extend this. */
export abstract class AdminPage {
  protected readonly busy = signal(false);
  protected readonly toast = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Runs an action, showing its error (or `onError`) and clearing old notices first. Returns true on success. */
  protected async run(fn: () => Promise<void>, onError?: (message: string, fields: Record<string, string>) => void): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    this.toast.set(null);
    try {
      await fn();
      return true;
    } catch (e) {
      const err = toApiError(e);
      if (onError) onError(err.message, err.fieldErrors);
      else this.error.set(err.message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}

/** Splits a textarea into trimmed non-empty lines. */
export const lines = (s: string): string[] => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
