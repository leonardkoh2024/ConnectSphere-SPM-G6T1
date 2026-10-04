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
| `--cs-canvas` | `#f7f7f8` | The signed-in panel's ground; cards sit on it in `--cs-surface` |
| `--cs-surface-hover` | `#f5f5f5` | Hover on a white ground |
| `--cs-surface-alt` | `#f2f2f2` | Recessed ground — pill and chip fills, landing alt band |
| `--cs-surface-alt-hover` | `#e5e5e5` | Hover on a recessed ground |
| `--cs-line` / `--cs-line-strong` | `#e5e5e5` / `#d3d3d3` | Default border / stronger divider |
| `--cs-danger` + `--cs-danger-faded` | `#d4163a` + `#feeceb` | Errors, rejection, cancellation |
| `--cs-positive` + `--cs-positive-faded` | `#1f8900` + `#edfbe9` | Success, approval, confirmation |
| `--cs-warning` | `#b7570b` | Needs attention, not yet an error |
| `--cs-info` + `--cs-info-faded` | `#2d76ec` + `#eaf1fd` | Neutral information |
| `--cs-warning-faded` | `#fdf1e7` | Background of a suitability warning box |
| `--cs-scrim` | `rgba(19,19,19,.45)` | Behind a modal |

Status colour is for **meaning, never decoration**. The nine event statuses should map onto this set rather
than getting nine colours of their own.

**Where colour goes.** Violet is the brand; the four status tones carry meaning; everything else is neutral.

- Every status-like badge (`.cs-pill-{tone}`, availability, suitability and verdict badges) is built one
  way: the tone's `-faded` tint behind and the tone for the label.
  A variant sets only `--cs-tone` and `--cs-tone-faded`; add a new badge by naming its tone.
- The accent fills the primary action, the page-header icon tile, the landing step discs and the closing
  banner. It tints (as `--cs-accent-faded`) the current nav item, row lead tiles, feature icons and selected
  toggles. Nothing else is filled with it.
- Row actions are outlined buttons (`.cs-btn-ghost`, `.cs-btn-update`), never a filled colour.
- `--cs-info` is a status tone only — never a button or a banner.

Because `--cs-info` is a blue and `--cs-accent` is a violet, never place them adjacent as if they were a
scale — a reader will assume the difference is meaningful.

## Shape

Radii: `--cs-radius-s` 4 · `--cs-radius-m` 8 · `--cs-radius-l` 12 · `--cs-radius` 16 · `--cs-radius-2xl` 24 ·
`--cs-radius-round` 999. Bigger surface, bigger radius: control 8–12, card 16, modal 24, pill/avatar round.

## Elevation

`--cs-elevation-base` for a resting control, `--cs-shadow` for a card, `--cs-elevation-raised` for a menu or
dialog. Shadows are cast in `#131313` at low alpha — **never tint a shadow with the brand colour**, which is
the single most common way a copied palette starts to look wrong.

Prefer a border to a shadow for anything that is not genuinely floating. The one exception is
`--cs-elevation-card`, a 1px hairline shadow that cards on the `--cs-canvas` ground carry alongside their border.

## Workspace layout

White sidebar, `--cs-canvas` panel, white cards. Each page header carries the screen's own nav icon in a
48px accent tile (`.cs-panel-icon`). Event rows open with a 44px lead tile (`components/RecordLead.js`): a
calendar leaf showing month and day, or a calendar icon on the accent tint while the event has no date.
Venue rows have no lead tile. Rows and landing cards lift to `--cs-shadow` on hover.

The page title sits straight on the canvas with a single short line under it — **one sentence of eight
words or fewer**. A screen's description is a label, not instructions; anything longer belongs in the screen
itself, next to the control it explains.

## Navigation

**Back buttons have one place, one look and one wording.** There is at most one per page, it is the first
line of the page header above the title, and it reads `‹ Back to {page}` with the page name in lower case
("Back to my events", "Back to venue catalogue"). It is a quiet text button (`.cs-back`): no border, muted
13px label, a chevron, and the hover ground of a ghost button.

`Workspace.js` owns it. A screen never draws its own back button inside its content; when it opens a detail
view of its own it reports how to close it through `onBackChange`, and the header shows it. The innermost
step wins:

1. a detail view inside the screen (an event opened from a list, the new-booking form) → back to that list;
2. the venue calendar → back to the catalogue;
3. a screen opened from a button on another screen (`goTo`) → back to that screen;
4. the organiser's request form → back to My events.

Screens opened from the sidebar are top level and show no back button.

## Buttons

- One primary (filled accent) button per view: the action the page exists for.
- A button that creates or adds something — new request, new booking, add a line, add a period — leads
  with the `plus` icon. Every icon comes from `app/Icon.js` and is `aria-hidden`, so the button's accessible
  name is only its words.
- Row actions are outlined (`.cs-btn-ghost`, 32px `.cs-record-btn`); a destructive one adds
  `.cs-record-danger` for a red label, never a red fill.

## Density

Fresha is roomy. Every padding, margin and gap comes off the 4px rhythm: 4, 8, 12, 16, 20, 24, 32, 40 —
with 48, 56, 64, 72 and 88 available for the space between page sections.

Control heights are fixed, not a by-product of padding: **40px** for a button or a nav row (`min-height`
plus flex centring, so an `<a>` and a `<button>` come out the same height), **44px** for a text input or a
full-width button. A label sits 8px above its input; two fields sit 20px apart.

**20px is the form rhythm, everywhere.** Two fields, a heading and the field under it, one section and the
next, and the last question and the buttons are all 20px apart — `.cs-form-section > * + *` sets it once so a
new block cannot arrive with its own spacing. A section's own padding is 24px.

## Spacing and positioning

Every value below is what `App.css` sets today. Reuse the class rather than restating the numbers; if a new
component needs a value that is not here, take it from the 4px rhythm and add a row.

### Workspace shell

| Element | Position | Size and spacing |
|---|---|---|
| Sidebar (`.cs-sidebar`) | left column, full height | 250px wide (72px collapsed); padding 16px top/bottom, 12px sides; items 4px apart |
| Sidebar head | top of sidebar | padding 4px 8px 16px, rule underneath; screen list starts 12px below it |
| Nav item (`.cs-sidebar-item`) | stacked | 40px tall; padding 8px 12px; icon to label 12px; radius 12px |
| Signed-in user block | pinned to sidebar foot | 16px above it and a rule; avatar 36px; avatar to text 10px |
| Panel (`.cs-panel`) | right column, scrolls | padding 40px all round |
| Page header (`.cs-panel-head`) | sticky at the top of the panel | 20px below its content, then 24px to the first block of the screen |
| Back button (`.cs-back`) | first line of the header, above the title | 32px tall; padding 0 12px 0 8px; pulled 12px left so the chevron lines up with the title; 12px above the title row |
| Header icon tile (`.cs-panel-icon`) | left of the title, vertically centred | 48px square, radius 12px, glyph 22px; 16px to the title |
| Title / description | right of the icon | title 28px with 4px under it; description 14px, at most 640px wide |
| Header action (e.g. View calendar) | right end of the title row | 16px minimum gap to the title |
| Toasts | fixed, top right of the window | 20px from the top and right edges; 380px wide; 12px apart |

### Lists and rows

| Element | Position | Size and spacing |
|---|---|---|
| List action bar (`.cs-list-actions`) | above the list, right-aligned | 24px above it |
| Record list (`.cs-record-list`) | under the action bar | 16px above it; rows 8px apart |
| Record row (`.cs-record`) | full panel width | padding 16px top/bottom, 20px sides; columns 20px apart; radius 16px |
| Row lead tile (`RecordLead`) | first thing in the row, vertically centred | 44px square, radius 12px; 16px to the row title |
| Row title / sub-line | after the lead tile | title 16px with 2px under it; sub-line 14px muted |
| Row actions (`.cs-record-actions`) | last column, right-aligned | buttons 32px tall, padding 0 14px, 13px label, 8px apart |
| Expanded row content (`.cs-record-expanded`) | spans every column under the row | starts with a rule and 20px above its content |
| Result count (`.cs-result-count`) | above a filtered list | 20px above it; 13px |
| Empty state (`.cs-empty`) | in place of the list | 24px above it; padding 48px 24px; content centred, 16px apart |
| Note (`.cs-panel-note`) | inline in the flow | 24px above it; padding 16px; radius 12px |

Below 900px a row stacks into one column and its actions move to the left.

### Forms and sections

| Element | Position | Size and spacing |
|---|---|---|
| Form section (`.cs-form-section`) | full panel width | padding 24px; radius 16px; sections 20px apart |
| Section heading | top of the section | 16px; accent bar 4×16px, 10px before the text; 20px under it |
| Blocks inside a section | stacked | 20px apart; 32px before a Yes/No question or a choice group |
| Field (`.cs-field`) | — | label 8px above the control |
| Text input / select | — | 44px tall; padding 10px 16px; radius 12px |
| Two-column field grid (`.cs-form-grid`) | — | columns and rows 20px apart; one column below 900px |
| Choice chip (`.cs-check`) | wrapped in a row | padding 8px 14px; fully round; 8px apart; checkbox to label 8px |
| Detail block after fields (`.cs-detail-grid`) | under the field row | 24px, a rule, then 24px; two columns 20px apart |
| Form actions (`.cs-form-actions`) | bottom of the form, right-aligned | buttons 12px apart; full width each on phones |
| Password eye button | inside the input, right edge, vertically centred | 32px square, 6px from the edge; the input keeps 48px of right padding for it |
| Password checklist | directly under the input | 8px below it (the field gap); lines 4px apart; icon 16px, 8px to the label |

### Overlays and badges

| Element | Size and spacing |
|---|---|
| Modal (`.cs-modal`) | centred on a scrim with 24px clearance; up to 440px wide; padding 24px; content 12px apart; radius 24px; actions right-aligned, 12px apart, 8px extra above them |
| Status badge / pill | padding 4px 10px; 12px label; fully round |
| Filter chip (`.cs-chip`) | padding 4px 10px; 12px label; chips 8px apart |

### Landing page

| Element | Position | Size and spacing |
|---|---|---|
| Top bar (`.cs-nav`) | sticky at the top | padding 16px 40px; actions 12px apart |
| Hero | first section | content column 1080px, centred; padding 72px top, 88px bottom; copy and login card 56px apart |
| Login card (`.cs-login`) | right column of the hero | padding 24px; radius 24px; portal tabs 12px apart, each padding 12px 16px |
| Content section (`.cs-section`) | stacked | padding 72px 40px; same 1080px column as the hero, including the full-width grey band |
| Card grid (`.cs-grid`) | under the section heading | cards at least 280px, 20px apart; card padding 24px |
| Feature icon tile | top of the card | 44px, radius 12px, 16px under it |
| Workflow step disc | top of each step | 40px circle, joined to the next by a 2px rule; title 16px below |

### Breakpoints

| Width | What changes |
|---|---|
| ≤ 900px | Panel side padding 24px. Sidebar becomes a top bar: brand, a horizontally scrolling row of screens, then the user block. Hero and grids go to one column; row and detail grids stack. |
| ≤ 560px | Panel padding 24px top, 16px sides; title 24px; form sections padding 16px; header icon tile 40px; landing sections 16px sides and 48px top and bottom; form buttons full width. |

## Forms

A compulsory question carries a red `*` (`.cs-required`, `--cs-danger`) after its label, and the form opens
with one line saying what the marker means. An optional field says so in words instead (`.cs-optional`), so
nothing is left for the reader to infer from silence.

A question that can be declined opens its section as a Yes/No pair of radios, not a checkbox: an untouched
checkbox and a deliberate "no" look identical, and the detail fields only appear on Yes.

Forms that show their own error list set `noValidate`, so the browser's validation bubble does not fire first
and hide it. The `required` attributes stay on the inputs for assistive technology.

A read-only detail block (`.cs-detail-grid`) that follows a row of fields in the same section — the event's
details under the event picker on Venue bookings — sits 24px below it, behind a 1px `--cs-line` rule, and
another 24px above its first item, so the answers read apart from the question.

**Passwords.** Every password input is a `PasswordField` (`features/auth/components/PasswordField.js`): the
eye button inside its right edge shows and hides the value, is a real button with `aria-pressed`, and keeps
the field at the standard 44px. Where a password is being *set*, the rules from `PASSWORD_RULES` in
`domain/accounts.js` are listed under the field and update as the user types, each in one of three states:

| State | When | Look |
|---|---|---|
| Not started | nothing typed yet | `--cs-muted`, hollow circle |
| Unmet | typing, rule not satisfied | `--cs-danger`, circled cross |
| Met | rule satisfied | `--cs-positive`, circled tick |

The icon changes with the colour, so the state never rests on colour alone. The same list drives the submit
check, so the checklist and the form can never disagree. Signing in shows no rules.

## Checklist before committing UI

1. No hex or `rgba()` outside the `:root` block in `App.css`, and no new filled colour (see *Where colour goes*).
2. No back button inside a screen's content, and no "new"/"add" button without the plus icon.
3. Font size and weight come from the lists above.
4. Focus is visible on every interactive element — keyboard users are part of story A4.
5. Contrast: body text on its background is at least 4.5:1, large text 3:1.
6. It still works at 400px wide and with the sidebar collapsed.
