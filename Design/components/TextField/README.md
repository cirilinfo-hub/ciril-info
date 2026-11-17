# TextField

Single-line pill input, 48px tall, 20px horizontal padding, `color-border-strong` at rest, `color-border-focus` + the 4px focus ring on focus.

## Use
- Always pass a `label`; helper text goes in `hint`, validation in `error` (renders `error-700`, sets `aria-invalid`).
- `icon` adds an 18px leading icon with a 12px gap.
- Disabled: `ink-100` fill, `ink-500` text.
- Placeholder uses `color-text-tertiary` (2.87:1) – never put information only in the placeholder.

## Props
`label`, `hint`, `error`, `icon` (Icon name), `id`, plus every `<input>` attribute.
