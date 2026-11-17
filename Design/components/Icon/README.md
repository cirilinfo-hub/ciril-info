# Icon

Outline icons on a 24px grid, 1.5px stroke, round caps and joins, drawn in `currentColor`; shown at 16 / 20 / 24px.

## Use
- Sit icons inside rounded-square tiles (`icon-tile`, `radius-md`): `violet-50` tile with `violet-600` icon on white, 16% white tile with a white icon on violet.
- Sidebar icons use a 1.75 stroke.
- Pass `title` when the icon carries meaning on its own; otherwise it is hidden from assistive tech.

## Props
`name` (one of the names in the preview), `size` `'sm'` for 16px, `title`, `className`.

The brand PDF describes the icon style but ships no icon files: this set is a small substitute drawn to that spec. Swap in the brand's own set when one exists.
