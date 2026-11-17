# Checkbox

20px box, radius 6, 1.5px `color-border-strong` border; checked fills `violet-500` with a white check. Used for task rows.

## Use
- `strikeWhenChecked` greys and strikes the label of a finished task (the task-list pattern).
- Hit area is ≥44px via label padding; the focus ring sits on the box.
- Note: the source's resting border (`ink-400` on white, 1.78:1) is below the 3:1 control-border floor.

## Props
`label`, `strikeWhenChecked`, plus `<input type=checkbox>` attributes (`checked`, `defaultChecked`, `disabled`, `onChange`).
