import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { AbstractControl } from '@angular/forms';
import { EMPTY, map, startWith, switchMap } from 'rxjs';

/** Human messages for built-in validators (sentence case, say what to do). */
export function messageFor(errors: Record<string, unknown>, label: string): string {
  if (errors['server']) return String(errors['server']);
  if (errors['required']) return `Enter ${label.toLowerCase()}.`;
  if (errors['email']) return 'Enter a valid email address.';
  if (errors['minlength']) return `Use at least ${(errors['minlength'] as { requiredLength: number }).requiredLength} characters.`;
  if (errors['maxlength']) return `Use ${(errors['maxlength'] as { requiredLength: number }).requiredLength} characters or fewer.`;
  if (errors['pattern']) return `Check the format of ${label.toLowerCase()}.`;
  if (errors['mismatch']) return 'The passwords do not match.';
  if (errors['requiredTrue']) return 'Please confirm to continue.';
  return `Check ${label.toLowerCase()}.`;
}

/** The error to show for a control right now (after it was touched, or a server error). */
export function visibleError(c: AbstractControl | null, label: string): string | null {
  if (!c || !c.errors || !(c.touched || c.errors['server'])) return null;
  return messageFor(c.errors, label);
}

/**
 * Design-system form field (cf-field): label, projected control, hint and error.
 * Give the projected input `[id]="<for>"` and `[attr.aria-describedby]="describedBy(...)"`.
 */
@Component({
  selector: 'ci-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'cf-field', style: 'min-width:0' },
  template: `
    <label class="cf-label" [attr.for]="for()"
      >{{ label() }}@if (optional()) {<span class="cf-help"> (optional)</span>}</label
    >
    <ng-content />
    @if (error(); as e) {
      <span class="cf-help cf-help-error" [id]="for() + '-err'" role="alert">{{ e }}</span>
    } @else if (hint()) {
      <span class="cf-help" [id]="for() + '-hint'">{{ hint() }}</span>
    }
  `,
})
export class Field {
  readonly label = input.required<string>();
  readonly for = input.required<string>();
  readonly control = input<AbstractControl | null>(null);
  readonly hint = input<string>();
  readonly optional = input(false);

  /** Emits whenever the control's value, status or touched state changes. */
  private readonly version = toSignal(
    toObservable(this.control).pipe(
      switchMap((c) => (c ? c.events.pipe(startWith(null)) : EMPTY)),
      map(() => Symbol()),
    ),
  );

  protected readonly error = computed(() => {
    this.version();
    return visibleError(this.control(), this.label());
  });
}

/** Value for aria-describedby on the input inside a ci-field. */
export function describedBy(id: string, control: AbstractControl | null, hasHint = false): string | null {
  if (control?.invalid && (control.touched || control.errors?.['server'])) return `${id}-err`;
  return hasHint ? `${id}-hint` : null;
}
