# Sidebar

App sidebar (inferred in the source for the product app). 280px expanded / 80px rail, padding 20×16, radius 24 when floating (0 when docked).

## Use
- Items 44px, radius 12, gap 12, 20px icons at 1.75 stroke, 14/600 `ink-700`; hover `ink-100`; current `violet-50` + `violet-700` with `aria-current="page"`.
- Section labels 11/700 uppercase +0.08em `ink-600`.
- Promo card on `violet-500` with white heading ≥18px bold.
- ≤1024px collapse to the rail; ≤768px become an off-canvas drawer (`z-modal`, `color-scrim`).

## Props
`sections` `{label?, items:{label,icon?,href?,current?,count?}[]}[]`, `promo` `{title,text,action?}`, `brand`.
