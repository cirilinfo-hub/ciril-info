import { ChangeDetectionStrategy, Component, input, model, signal } from '@angular/core';
import { Icon } from '../../design-system/icon/icon';

export const MAX_FILES = 5;
export const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['png', 'jpg', 'jpeg', 'webp', 'pdf', 'txt', 'log', 'csv'];
export const ACCEPT = ALLOWED.map((e) => `.${e}`).join(',');

export const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Picks files for a ticket message and checks them before upload. The server checks again by file content. */
@Component({
  selector: 'ci-file-picker',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
    ul { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: grid; gap: var(--space-2); }
    li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md, 8px); padding: var(--space-2) var(--space-3); font-size: 14px; }
    li span { overflow-wrap: anywhere; }
    li small { color: var(--color-text-secondary); margin-left: var(--space-2); }
    .hint { color: var(--color-text-secondary); font-size: 13px; }
  `,
  template: `
    <div class="row">
      <label class="cf-btn cf-btn-secondary cf-btn-sm" [for]="inputId()"><ci-icon name="plus" [size]="16" />Attach files</label>
      <input [id]="inputId()" class="cx-sr" type="file" multiple [attr.accept]="accept" [disabled]="disabled()" (change)="onPick($event)" />
      <span class="hint">Up to 5 files, 5 MB each: images, PDF, .txt, .log or .csv.</span>
    </div>
    @if (error(); as e) { <span class="cf-help cf-help-error" role="alert">{{ e }}</span> }
    @if (files().length) {
      <ul aria-label="Files to send">
        @for (f of files(); track $index) {
          <li><span>{{ f.name }}<small>{{ size(f.size) }}</small></span><button type="button" class="cf-btn cf-btn-tertiary cf-btn-sm" [attr.aria-label]="'Remove ' + f.name" (click)="remove($index)">Remove</button></li>
        }
      </ul>
    }
  `,
})
export class FilePicker {
  readonly inputId = input('attach');
  readonly disabled = input(false);
  readonly files = model<File[]>([]);
  protected readonly accept = ACCEPT;
  protected readonly error = signal<string | null>(null);
  protected size = formatSize;

  protected onPick(e: Event) {
    const el = e.target as HTMLInputElement;
    const next = [...this.files()];
    let problem: string | null = null;
    for (const f of Array.from(el.files ?? [])) {
      const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
      if (!ALLOWED.includes(ext)) problem = `“${f.name}” is not a supported file. Use an image, PDF, .txt, .log or .csv.`;
      else if (f.size === 0) problem = `“${f.name}” is empty.`;
      else if (f.size > MAX_BYTES) problem = `“${f.name}” is larger than 5 MB.`;
      else if (next.length >= MAX_FILES) problem = 'You can attach at most 5 files to one message.';
      else next.push(f);
    }
    this.error.set(problem);
    this.files.set(next);
    el.value = ''; // so the same file can be chosen again after removing it
  }

  protected remove(i: number) {
    this.files.set(this.files().filter((_, idx) => idx !== i));
    this.error.set(null);
  }

  /** Called by the parent after a successful send. */
  clear() {
    this.files.set([]);
    this.error.set(null);
  }
}
