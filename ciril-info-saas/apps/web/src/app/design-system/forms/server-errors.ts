import type { FormGroup } from '@angular/forms';
import type { ApiError } from '../../core/api/api-error';

/**
 * Put API validation messages onto the matching form controls (as `server` errors)
 * and return whatever could not be attached, for a form-level alert.
 */
export function applyServerErrors(form: FormGroup, err: ApiError): string | null {
  let unattached: string | null = null;
  const entries = Object.entries(err.fieldErrors);
  for (const [field, msg] of entries) {
    const c = form.get(field);
    if (c) {
      c.setErrors({ ...(c.errors ?? {}), server: msg });
      c.markAsTouched();
    } else unattached ??= msg;
  }
  if (!entries.length) return err.message;
  return unattached;
}

/** Clear server errors when the user edits again. */
export function clearServerErrors(form: FormGroup) {
  for (const c of Object.values(form.controls)) {
    if (c.errors?.['server']) {
      const { server: _s, ...rest } = c.errors;
      c.setErrors(Object.keys(rest).length ? rest : null);
    }
  }
}
