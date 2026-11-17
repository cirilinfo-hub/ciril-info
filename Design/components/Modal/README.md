# Modal

Dialog (inferred): scrim `color-scrim`, white, radius 24, padding 28, `shadow-xl`, max-width 440 / 560 / 720. Header icon tile + 20/28 title, close button top-right, footer right-aligned with the primary action last.

## Use
Trap focus, close on Esc, return focus to the trigger. Enter with fade + 8px rise over `duration-slow`. On mobile, present as a bottom sheet (radius 24 24 0 0, full width).

## Props
`title`, `subtitle`, `icon`, `size` `'sm' | 'md' | 'lg'`, `footer` (buttons), `open`, `onClose`, `inline` (render in flow, for docs), children.
