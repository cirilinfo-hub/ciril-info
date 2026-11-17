Calm, violet-led productivity. White and faint-lavender grounds, one confident violet, an orchid call to action, soft geometric type, and small white cards floating over rounded violet bands. Colour is concentrated, not spread; everything is rounded, soft and slightly lifted.

## Principles

- **Calm productivity.** Generous whitespace on `color-bg-page` and `color-bg-subtle` makes dense task UI feel effortless.
- **One violet voice.** Violet carries brand, structure and emphasis. Orchid is reserved for the main call to action.
- **Floating, layered cards.** Small white cards overlap bands and device mockups, suggesting depth without heavy shadow.
- **Soft geometry.** Radii from 4 to 40px, pill buttons and inputs, rounded icon tiles. No sharp corners anywhere.
- **Product as illustration.** Show real UI fragments (task lists, project cards, timers, ratings) instead of abstract art.

## Content

- Headlines are short, confident and in Title Case: “Maximize Your Productivity”, “Comprehensive Feature Set”. Highlight **one phrase per headline** in `color-text-highlight` (violet-500, only at ≥24px); the rest stays `color-text-primary`.
- Body copy speaks to the reader as “you/your”, plainly: “Conquer your tasks and take control with our task manager app.”
- Button labels are short verb phrases in Title Case: “Learn More”, “Get Started”, “View Projects”, “Add Task”.
- Labels and helper text are sentence case: “Give the task a short, clear name.” Errors say what to do: “Enter a valid email address.”
- Numbers are a design element: “29M+”, “64:52:00”, “4.8”. Use real figures only.
- No emoji.

## Colour

Distribution is **60 · 30 · 10**: 60% white and `violet-50` grounds, 30% violet, 10% orchid and green accents.

- Grounds: `color-bg-page` (white) and `color-bg-subtle` (violet-50) alternate between sections. Surfaces are `color-surface`.
- Text: headings `color-text-primary` (ink-900), body `color-text-secondary` (ink-600). `color-text-tertiary` (ink-500, 2.87:1) is for placeholders and disabled text only. No pure black anywhere.
- Violet: `violet-500` for surfaces, bands, icons and large type; `violet-600` for buttons, links and anything text-sized (white on it is 5.41:1). White on `violet-500` is 3.95:1, so on bands keep headings ≥24px and body at 18px+.
- Orchid: the accent button uses `orchid-600` (white 4.8:1). `orchid-400`, the observed CTA colour, fails with white text (2.68:1): use it for decoration only. Orchid appears **once per viewport**: the main marketing CTA or one decorative tile. Never for links, icons or text.
- Green (`success-*`) is for positive change, completion and the rating star only, never a second brand colour.
- Status: pair `-50` backgrounds with `-700` text (all AA), and always add a word or icon; never colour alone.

## Typography

One family: **Urbanist** (Google Fonts, OFL), the open match for the Gilroy-style geometric sans in the reference; swap in Gilroy if licensed. Stack: `--font-sans`.

- Weights: 700 headings, 600 labels and buttons, 500 nav links and captions, 400 body, 800 stat numerals. **At most three weights per screen.**
- Styles: `display-xl` / `display` for the hero, `heading-1` once per page, `heading-2` to open sections (optionally with an `overline`), `heading-3`–`heading-6` below that, `stat` for numerals, `body-lg` for hero and band leads, `body` default, `body-sm` in cards, `label`, `button`, `caption`, `overline`.
- Headings tighten tracking (−0.02em to −0.01em); body is 0. All sizes sit on a 4px grid.
- Body measure max 64ch. Centre only short hero and CTA copy.
- Emphasise with size and colour before weight.
- Responsive: `display` 48 → 40 (<1280) → 32 (<768); `heading-1` 40 → 32 → 28; `heading-2` 32 → 28 → 24; `heading-3` 24 → 20 on mobile.

## Spacing and layout

A 4px base unit drives every gap (`space-*`).

| | Desktop | Tablet | Mobile |
|---|---|---|---|
| Section padding-y (`section-y`) | 120px | 80px | 64px |
| Heading → content | 48px | 40px | 32px |
| Band inner padding (`band-padding`) | 64px | 48px | 32px |
| Page gutter (`page-gutter`) | 120px | 40px | 20px |
| Grid | 12 col · 24 gutter | 8 col · 24 | 4 col · 16 |

- Containers: `container-lg` (1200px) for page content, `container-xl` (1280px) for bands and the app shell, `container-md` for centred marketing copy, `container-sm` for forms and articles.
- Hero is a 6 + 6 split; feature rows 5 + 7, alternating text and visual. On mobile, every row stacks visual-after-text; never alternate.
- Card padding `space-6` (16 compact / 32 large), internal gap 12–16px, task rows 12px apart, 48–64px between hero copy and visuals.
- Component sizes: buttons 36 / 44 / 52, inputs 48, icon tiles 44, nav 72 (64 mobile). Touch targets stay ≥44×44 at every size; CTA groups go full-width on mobile.
- Breakpoints `bp-sm` 640, `bp-md` 768, `bp-lg` 1024, `bp-xl` 1280, `bp-2xl` 1440. Write mobile-first `min-width` queries.

## Shape, borders and elevation

- Radii: `radius-xs` focus marks (checkboxes 6px), `radius-sm` chips, `radius-md` icon tiles and menus, `radius-lg` cards, `radius-xl` large cards and dialogs, `radius-2xl` feature panels, `radius-3xl` violet bands and phone mockups, `radius-pill` buttons, inputs, badges and avatars. Single-line controls are pills; multi-line controls and containers use 12–24.
- Bands keep `radius-3xl` on desktop, `radius-2xl` on tablet, `radius-xl` on mobile, and sit inside the container with the page gutter visible, never edge to edge.
- Elevation comes from blur, tinted violet, never from darkness: `shadow-sm` chips, `shadow-md` floating cards, `shadow-lg` cards over bands, menus and toasts, `shadow-xl` modals and mockups. Hover raises a card one step and lifts it 2px.
- Flat means static; a shadow means floating or clickable. On white use a 1px `color-border-subtle` border **or** a shadow, never both. Floating cards have no border (`border-0`).
- Focus: every interactive element shares one 4px ring, `color-focus-ring` (`box-shadow: 0 0 0 4px`); inputs also switch their border to `color-border-focus`. The ring is translucent as specified; on violet grounds confirm it stays visible.

## Motion

`duration-fast` (120ms) for hover and colour, `duration-base` (200ms) for menus and tooltips, `duration-slow` (320ms) for dialogs (fade + 8px rise), all on `ease-standard`. `ease-emphasis` overshoots; use it sparingly. Under `prefers-reduced-motion`, base and slow drop to 0ms.

## Imagery and iconography

- Imagery: product UI fragments, a phone mockup tilted in 3D, overlapping avatar stacks with white rings and a count chip, a cut-out portrait on an orchid rounded tile, chunky violet quote marks.
- Icons: one outline set, 1.5–2px stroke, round caps, at 16 / 20 / 24px, set inside rounded-square tiles (`violet-50` tile on white, 16% white tile on violet). The brand files ship no icon set, so `Icon` is a small substitute drawn to this spec; replace it with the brand's own when available.
- Logo: no logo file was supplied. Set the name in plain type (the `NavBar` wordmark: 700, −0.02em, one part in `violet-500`) until a real mark is added under `assets/Logos/`.

## Components

Build from the bundle (`window.Cirilinfo`) and compose only from tokens; no one-off hex values.

- Actions: `Button` (accent, primary, secondary, tertiary).
- Forms: `TextField`, `TextArea`, `Select`, `EmailCapture`, `Checkbox`, `Radio`, `Switch`.
- Navigation: `NavBar`, `Sidebar`, `Tabs`, `SegmentedControl`, `Breadcrumbs`, `Pagination`.
- Data display: `Badge`, `Tag`, `RatingChip`, `Avatar`, `AvatarStack`, `Table`.
- Cards: `FeatureCard`, `ProjectCard`, `StatBlock`, `Testimonial`, `BlogCard`, `CTABand`, `TaskList`.
- Overlays and feedback: `Tooltip`, `Modal`, `Alert`, `Toast`.

Hierarchy of attention: headline → orchid CTA → product visual → supporting stats. One primary action per section.

## Do and don't

- **Do** float small white cards over violet bands and mockups with `shadow-lg`. **Don't** stack heavy borders and shadows on the same card, or use grey or black shadows.
- **Do** keep CTAs pill-shaped with a trailing arrow for “next step” actions. **Don't** add gradients, glows or glass blur beyond what is specified.
- **Do** leave 120px between sections and 24px inside cards. **Don't** introduce a third brand hue or use orchid for more than one CTA per view.
- **Do** highlight one headline phrase in violet. **Don't** put small `ink-500` text on white, or small white text on `violet-500`.
