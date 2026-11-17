# Button

Pill buttons in four variants: **accent** (orchid-600, the marketing CTA, “Learn More”), **primary** (violet-600, the product action, “Get Started”), **secondary** (violet-50 fill, violet-700 text) and **tertiary** (transparent, violet-600 text).

## Use
- One primary or accent action per section; everything else is secondary or tertiary.
- Accent appears **once per viewport**. It shows a trailing arrow by default (observed); pass `trailingIcon={null}` to drop it.
- Sizes `sm` 36px / `md` 44px / `lg` 52px; padding-x 16 / 24 / 28; label in `button` (13px on `sm`).
- States: hover → `-hover` token, pressed → `-active` token, focus → the shared 4px `color-focus-ring`, disabled → `ink-200` fill + `ink-500` text.
- Mobile CTA groups: pass `block` for full width.

## Props
`variant` `'accent' | 'primary' | 'secondary' | 'tertiary'` · `size` `'sm' | 'md' | 'lg'` · `leadingIcon` / `trailingIcon` (an `Icon` name) · `block` · any `<button>` attribute. Children: the label, title case as in the source (“View Projects”).

## Don't
- Don't put white text on `orchid-400` (#EC6FD9, 2.68:1): that colour is decoration only.
- Don't add gradients or glows; `shadow-brand` is the only allowed glow, optional, on primary.
