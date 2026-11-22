import { HttpErrorResponse } from '@angular/common/http';

/** Normalised API error (server envelope: { error: { code, message, details, requestId } }). */
export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
  /** Field → message, built from class-validator details when present. */
  fieldErrors: Record<string, string>;
}

const FALLBACK = 'Something went wrong. Please try again.';

export function toApiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return { status: 0, code: 'NETWORK', message: 'We could not reach the server. Check your connection and try again.', fieldErrors: {} };
    }
    const body = (err.error as { error?: Partial<ApiError> } | null)?.error;
    const fieldErrors: Record<string, string> = {};
    if (body?.code === 'VALIDATION_FAILED' && Array.isArray(body.details)) {
      for (const item of body.details as (string | { field?: string; message?: string })[]) {
        if (typeof item === 'string') {
          // class-validator messages start with the property name, unless we wrote a custom message.
          const [field] = item.split(' ');
          if (field) fieldErrors[field] ??= item;
        } else if (item?.field && item.message) {
          fieldErrors[item.field] ??= item.message;
        }
      }
    }
    return {
      status: err.status,
      code: body?.code ?? 'ERROR',
      message: body?.message ?? FALLBACK,
      details: body?.details,
      requestId: body?.requestId,
      fieldErrors,
    };
  }
  return { status: -1, code: 'CLIENT', message: FALLBACK, fieldErrors: {} };
}
