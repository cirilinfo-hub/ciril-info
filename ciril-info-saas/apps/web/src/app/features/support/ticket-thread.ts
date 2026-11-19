import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { TicketMessage } from './support.models';

/** The conversation on a ticket. Used by both portals; staff-only notes are labelled and shaded. */
@Component({
  selector: 'ci-ticket-thread',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    ol { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); }
    li { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md, 8px); padding: var(--space-4); background: var(--color-surface, #fff); }
    li.staff { border-left: 3px solid var(--color-border-brand, #1f4fd8); }
    li.note { background: var(--color-surface-sunken, #fff8e1); border-style: dashed; }
    header { display: flex; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; font-size: 13px; color: var(--color-text-secondary); margin-bottom: var(--space-2); }
    header strong { color: var(--ink-900); }
    p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; line-height: 24px; }
    .tag { font-weight: 600; color: var(--color-text-brand); }
  `,
  template: `
    <ol aria-label="Conversation">
      @for (m of messages(); track m.id) {
        <li [class.staff]="m.fromStaff" [class.note]="m.isInternal">
          <header>
            <span><strong>{{ m.authorName }}</strong>@if (m.isYou) { (you) }@if (m.isInternal) { <span class="tag"> · Internal note, not visible to the customer</span> }</span>
            <time [attr.datetime]="m.createdAt">{{ m.createdAt | date: 'd MMM y, h:mm a' }}</time>
          </header>
          <p>{{ m.body }}</p>
        </li>
      }
    </ol>
  `,
})
export class TicketThread {
  readonly messages = input.required<TicketMessage[]>();
}
