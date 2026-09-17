# ConnectSphere design system

The visual language is modelled on [Fresha](https://www.fresha.com/), chosen as the reference because it
solves the same shape of problem: a two-sided booking product with a consumer side and a staff console.

Tokens below were read from Fresha's own published CSS custom properties, not eyeballed from screenshots.
They are implemented in `frontend/src/app/App.css` under `:root`. **Use a token. Never write a hex value
into a rule** — if you need a colour the scale does not have, add it here first and say what it is for.

## What we take and what we do not

We take the design *language*: palette, type scale, radii, elevation, spacing rhythm and component shapes.

We do not take Fresha's brand. No Fresha logo, wordmark, product screenshots, illustrations, photography
or copy goes anywhere near this repo, and nothing in the UI should suggest the app is Fresha or affiliated
with it. The product name is ours (still unchosen — "ConnectSphere" is the company, not the product).

## Type

Fresha ships **Roobert PRO** with **Aktiv Grotesk** as fallback, and **Tartuffo** for display. All three are
commercially licensed; we have no licence, so we substitute open equivalents with the same feel:

| Role | Ours | Fresha's | Notes |
|---|---|---|---|
| UI / body / headings | **Plus Jakarta Sans** | Roobert PRO | Geometric grotesk, similar warmth and proportions |
| Marketing headlines | **Playfair Display** | Tartuffo | Playfair is already in Fresha's own display fallback stack |
| Code | system monospace | — | unchanged |

Loaded from Google Fonts in `frontend/public/index.html`; the stacks are `--cs-font-body` and `--cs-font-display`.

Headings use the **body** face, not the serif — Fresha sets `--font-header: var(--font-body)`. The serif is
for marketing headlines only (currently just the landing hero) and must never appear inside the workspace.

Weights: 400 body, 500 emphasis, 600 buttons and headings, 700 display. Nothing else — no 650, no 300.
Sizes: **12** (micro-labels only), 13, 14, 16, 19, 22, 24, 28, 34, 40, 48. Pick from that list; no decimals.

Where they land today: 14 is the workspace default and the button/nav size, 16 body copy and card text,
19 card and section sub-headings, 22 the login title, 28 a workspace page title, 34 a marketing section
heading, 48 the landing hero.

## Colour

One accent carries the brand. Everything else is neutral, and colour otherwise only means status.

| Token | Value | Use |
|---|---|---|
| `--cs-accent` | `#6950f3` | Primary buttons, active nav, links, focus, selection |
| `--cs-accent-hover` / `--cs-accent-active` | `#5c4ace` / `#403591` | Interaction states, in that order |
| `--cs-accent-faded` | `#f0f0ff` | Tinted background behind accent content — pills, selected cards |
| `--cs-accent-border` | `#dbddff` | Border on a faded-accent surface |
| `--cs-accent-light` | `#a394f7` | Decorative only — the brand mark gradient |
| `--cs-on-accent` | `#ffffff` | Text and icons sitting on accent or primary |
| `--cs-on-accent-muted` | `rgba(255,255,255,.72)` | Secondary text on a dark or accent ground |
| `--cs-focus-ring` | `rgba(105,80,243,.35)` | The 2px focus outline, nothing else |
| `--cs-primary` / `--cs-primary-hover` | `#0d0d0d` / `#262626` | Near-black button, above accent in emphasis |
| `--cs-ink` | `#0d0d0d` | All body copy and headings |
| `--cs-muted` | `#767676` | Secondary copy, captions, placeholder |
| `--cs-ghost` / `--cs-disabled-ink` | `#bfbfbf` / `#acacac` | Decorative marks / disabled text |
| `--cs-surface` | `#ffffff` | Page and card ground |
| `--cs-surface-hover` | `#f5f5f5` | Hover on a white ground |
| `--cs-surface-alt` | `#f2f2f2` | Recessed ground — sidebar, note panels |
| `--cs-surface-alt-hover` | `#e5e5e5` | Hover on a recessed ground |
| `--cs-line` / `--cs-line-strong` | `#e5e5e5` / `#d3d3d3` | Default border / stronger divider |
| `--cs-danger` + `--cs-danger-faded` | `#d4163a` + `#feeceb` | Errors, rejection, cancellation |
| `--cs-positive` + `--cs-positive-faded` | `#1f8900` + `#edfbe9` | Success, approval, confirmation |
| `--cs-warning` | `#b7570b` | Needs attention, not yet an error |
| `--cs-info` + `--cs-info-faded` | `#2d76ec` + `#eaf1fd` | Neutral information |

Status colour is for **meaning, never decoration**. The nine event statuses should map onto this set rather
than getting nine colours of their own.

Because `--cs-info` is a blue and `--cs-accent` is a violet, never place them adjacent as if they were a
scale — a reader will assume the difference is meaningful.

## Shape

Radii: `--cs-radius-s` 4 · `--cs-radius-m` 8 · `--cs-radius-l` 12 · `--cs-radius` 16 · `--cs-radius-2xl` 24 ·
`--cs-radius-round` 999. Bigger surface, bigger radius: control 8–12, card 16, modal 24, pill/avatar round.

## Elevation

`--cs-elevation-base` for a resting control, `--cs-shadow` for a card, `--cs-elevation-raised` for a menu or
dialog. Shadows are cast in `#131313` at low alpha — **never tint a shadow with the brand colour**, which is
the single most common way a copied palette starts to look wrong.

Prefer a border to a shadow for anything that is not genuinely floating.

## Density

Fresha is roomy. Every padding, margin and gap comes off the 4px rhythm: 4, 8, 12, 16, 20, 24, 32, 40 —
with 48, 56, 64, 72 and 88 available for the space between page sections.

Control heights are fixed, not a by-product of padding: **40px** for a button or a nav row (`min-height`
plus flex centring, so an `<a>` and a `<button>` come out the same height), **44px** for a text input or a
full-width button. A label sits 8px above its input; two fields sit 20px apart.

**20px is the form rhythm, everywhere.** Two fields, a heading and the field under it, one section and the
next, and the last question and the buttons are all 20px apart — `.cs-form-section > * + *` sets it once so a
new block cannot arrive with its own spacing. A section's own padding is 24px.

## Forms

A compulsory question carries a red `*` (`.cs-required`, `--cs-danger`) after its label, and the form opens
with one line saying what the marker means. An optional field says so in words instead (`.cs-optional`), so
nothing is left for the reader to infer from silence.

A question that can be declined opens its section as a Yes/No pair of radios, not a checkbox: an untouched
checkbox and a deliberate "no" look identical, and the detail fields only appear on Yes.

Forms that show their own error list set `noValidate`, so the browser's validation bubble does not fire first
and hide it. The `required` attributes stay on the inputs for assistive technology.

## Checklist before committing UI

1. No hex or `rgba()` outside the `:root` block in `App.css`.
2. Font size and weight come from the lists above.
3. Focus is visible on every interactive element — keyboard users are part of story A4.
4. Contrast: body text on its background is at least 4.5:1, large text 3:1.
5. It still works at 400px wide and with the sidebar collapsed.
