# Kullina Design System — Style Guide
**Version:** Alpha  
**Last updated:** August 2026

---

## 1. Typography

### Font Families

| Role | Family | Fallback |
|---|---|---|
| Display & Heading | Cabinet Grotesk | sans-serif |
| Body & Interface | Instrument Sans | sans-serif |

### Scale

| Token | Family | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|---|
| `typography.rating-display` | Cabinet Grotesk | 64px | 700 | 1.1 | −1px | Rating number on detail pages ("4.81") — the loudest type moment in the system |
| `typography.display-xl` | Cabinet Grotesk | 28px | 700 | 1.43 | 0 | Page h1 · Hero title |
| `typography.display-lg` | Cabinet Grotesk | 22px | 500 | 1.18 | −0.44px | Detail page h1 |
| `typography.display-md` | Cabinet Grotesk | 21px | 700 | 1.43 | 0 | Section heads inside detail pages |
| `typography.display-sm` | Cabinet Grotesk | 20px | 600 | 1.20 | −0.18px | Sub-section titles |
| `typography.title-md` | Cabinet Grotesk | 16px | 600 | 1.25 | 0 | Card titles · link block heads |
| `typography.title-sm` | Cabinet Grotesk | 16px | 500 | 1.25 | 0 | Footer column heads |
| `typography.body-md` | Instrument Sans | 16px | 400 | 1.5 | 0 | Default running text · amenity copy |
| `typography.body-sm` | Instrument Sans | 14px | 400 | 1.43 | 0 | Card meta · dates · prices · distance |
| `typography.caption` | Instrument Sans | 14px | 500 | 1.29 | 0 | Search field segment labels |
| `typography.caption-sm` | Instrument Sans | 13px | 400 | 1.23 | 0 | Footer legal line |
| `typography.badge` | Instrument Sans | 11px | 600 | 1.18 | 0 | Floating badge text |
| `typography.micro-label` | Instrument Sans | 12px | 700 | 1.33 | 0 | Card amenity micro-labels |
| `typography.uppercase-tag` | Instrument Sans | 8px | 700 | 1.25 | 0.32px | "NEW" nav badge — uppercase, tracked |
| `typography.button-md` | Instrument Sans | 16px | 500 | 1.25 | 0 | Primary CTA button labels |
| `typography.button-sm` | Instrument Sans | 14px | 500 | 1.29 | 0 | Pill button labels · secondary labels |
| `typography.link` | Instrument Sans | 14px | 400 | 1.43 | 0 | Inline body links |
| `typography.nav-link` | Instrument Sans | 16px | 600 | 1.25 | 0 | Top product-nav labels |

### Principles

- Display weights stay modest. The homepage h1 at 28px / 700 is deliberately restrained — photography and layout carry visual hierarchy, not type size.
- The listing-detail h1 at 22px / 500 is quieter still; the photo banner above it does the work.
- The single typographically loud moment is `typography.rating-display` (64px / 700). Rating numbers are the peak trust signal on a listing page — they earn the loudest treatment. Everything else stays controlled.
- `uppercase-tag` is the only token with forced `text-transform: uppercase` and explicit letter-spacing (0.32px).

---

## 2. Colors

### Brand & Accent

| Token | Hex | Use |
|---|---|---|
| `colors.primary` | `#ff5722` | Primary brand accent. Every primary CTA background, the search orb, the heart save state, inline brand links. |
| `colors.primary-active` | `#303841` | Press / pointer-down state on `button-primary`. |
| `colors.primary-disabled` | `#f5f5f5` | Disabled brand fill. |
| `colors.luxe` | `#76abae` | Brand Teal. Supporting accent for secondary highlights and sub-brand Luxe contexts. |
| `colors.plus` | `#303841` | Brand Dark. Deep supporting tone for sub-brand Plus contexts. |

### Text

| Token | Hex | Use |
|---|---|---|
| `colors.ink` | `#222222` | Dominant text on light surfaces. Display headlines, body paragraphs, primary nav links. Never pure black. |
| `colors.body` | `#3f3f3f` | Secondary running text. Used inside long-form review and amenity copy where ink feels too heavy. |
| `colors.muted` | `#6a6a6a` | Sub-titles, inactive tabs, footer sub-labels, "View all" links. |
| `colors.muted-soft` | `#929292` | Disabled link text. Used very sparingly. |
| `colors.on-primary` | `#ffffff` | White text on Brand Red CTAs and dark surfaces. |
| `colors.on-dark` | `#ffffff` | White text on dark backgrounds. |
| `colors.star-rating` | `#222222` | Star icon and rating numbers render in ink, not gold — a deliberate brand choice. |
| `colors.legal-link` | `#428bff` | Inline links inside legal copy only (Privacy, Terms). |

### Surfaces

| Token | Hex | Use |
|---|---|---|
| `colors.canvas` | `#ffffff` | Default page floor for every public page. |
| `colors.surface-soft` | `#f7f7f7` | Lightest fill — disabled fields, sub-nav hover backgrounds, inline search filter band. |
| `colors.surface-card` | `#ffffff` | Card surface — same as canvas; kept as a distinct token for semantic clarity. |
| `colors.surface-strong` | `#f2f2f2` | Circular icon-button surfaces (breadcrumb back-arrow, listing toolbar buttons). |

### Hairlines & Borders

| Token | Hex | Use |
|---|---|---|
| `colors.hairline` | `#dddddd` | Default 1px border — search bar dividers, table separators, footer column splitters, card borders. |
| `colors.hairline-soft` | `#ebebeb` | Lighter divider for long-scrolling editorial body separators. |
| `colors.border-strong` | `#c1c1c1` | Heavier stroke on disabled outline buttons and form input outlines after focus. |

### Semantic

| Token | Hex | Use |
|---|---|---|
| `colors.primary-error-text` | `#c13515` | Inline error text for form validation. Distinct from Brand Red — darker, more saturated. |
| `colors.primary-error-text-hover` | `#b32505` | Error link hover state. |
| `colors.scrim` | `#000000` | Global modal backdrop. Applied at 50% opacity at render time — stored as the base hex only. |

### Brand Summary

| Name | Hex | Token |
|---|---|---|
| Brand Red | `#ff5722` | `colors.primary` |
| Brand Dark | `#303841` | `colors.primary-active` / `colors.plus` |
| Brand White | `#f5f5f5` | `colors.primary-disabled` |
| Brand Teal | `#76abae` | `colors.luxe` |

---

## 3. Spacing & Sizing

### Base Unit

**4px** — with a 2px micro-step for the tightest intervals (`spacing.xxs`).

### Spacing Tokens

| Token | Value | Primary use |
|---|---|---|
| `spacing.xxs` | 2px | Micro-step. Tight internal gaps within a single element (e.g. badge padding adjustment). |
| `spacing.xs` | 4px | Dense category-strip dividers. Minimum breathing room. |
| `spacing.sm` | 8px | Caption / date-row gutters. Icon-to-label gaps. Internal card row spacing. |
| `spacing.md` | 12px | Amenity row internal padding (12px top / bottom). Compact form row gaps. |
| `spacing.base` | 16px | Default internal padding. Card meta block. Gutter between cards in the homepage city grid. |
| `spacing.lg` | 24px | Card internal padding for `host-card` and `reservation-card`. Footer column gutters. |
| `spacing.xl` | 32px | Button radius cap. Larger intra-section gaps. |
| `spacing.xxl` | 48px | Footer vertical padding (top / bottom of the footer column band). |
| `spacing.section` | 64px | Major page band vertical padding. Tighter than typical SaaS (80–96px) — marketplace density needs more cards per scroll. |

### Sizing Reference

| Element | Value | Notes |
|---|---|---|
| Top nav height | 80px | Fixed. 1px bottom hairline. |
| Search bar height | 64px | Pill-shaped. |
| Search orb | 48×48px | Circular. Most-tapped element on the page. |
| Button height (primary / secondary) | 48px | Meets WCAG AAA touch target minimum. |
| Date picker day cell | 40×40px | Circular. |
| Icon button (circle) | 32px | Heart save, back-arrow. Borderline AAA — compensated by 12px internal card padding. |
| Icon button (outline) | 40px | Globe, language picker. |
| Text input height | 56px | Standard form field. |
| Max content width (editorial) | ~1280px | Centered. Gutters absorb overflow above this. |
| Max content width (listing detail) | ~1080px | Narrower cap keeps photo banner and reservation rail readable. |

---

## 4. Border Radius

### Tokens

| Token | Value | Used on |
|---|---|---|
| `rounded.none` | 0px | Body grid. The only hard corner in the system. |
| `rounded.xs` | 4px | Reserved for micro-elements where `rounded.sm` is too heavy. |
| `rounded.sm` | 8px | Buttons (primary, secondary). Text inputs. |
| `rounded.md` | 14px | Property cards. Experience cards. Host card. Reservation card. Dropdown menus. |
| `rounded.lg` | 20px | Available in the scale — not prominently assigned in current surfaces. |
| `rounded.xl` | 32px | Category strip tabs. |
| `rounded.full` | 9999px | Search bar. Search orb. Heart icon button. Account menu avatar. Date picker selected days. "NEW" badge. Guest favourite badge. All pill-shaped elements. |

### Principle

There is no hard corner on any interactive element. Every button, card, input, orb, and badge is rounded. `rounded.none` applies only to the body grid itself — never to interactive surfaces.

---

## 5. Elevation

### Tiers

The system uses **one shadow tier** plus the flat baseline. There are no progressive elevation levels.

| Name | Value | Applied to |
|---|---|---|
| Flat | none | Body, hero, footer, all editorial bands. ~95% of all surfaces. |
| Card float | `rgba(0,0,0,0.02) 0 0 0 1px, rgba(0,0,0,0.04) 0 2px 6px 0, rgba(0,0,0,0.10) 0 4px 8px 0` | Property cards on hover. Search bar at rest. Dropdown menus (account, language picker, date picker). Guest favourite badge. |
| Scrim | `#000000` at 50% opacity | Global modal backdrop — date picker, login dialog, language picker. |

### Principle

Depth is communicated through photography, white-on-white surface separation, and rounded-corner clipping — not through layered shadows. The one shadow tier exists to lift interactive cards above the flat canvas; it is never stacked or intensified.

---

## 6. Known Gaps

---

### 6.1 Hover State Colors

**Status:** Intentionally not documented.

Kullina operates under a global no-hover policy. Interactive surfaces communicate state through elevation (the card float shadow), fill changes (button press), and cursor changes — not through colour shifts on pointer-enter. Attempting to extract precise `:hover` colour values from captured surfaces is unreliable and would produce speculative tokens.

**What is documented:**
- Button press state uses `colors.primary-active` (#303841) as the background — this is a click/tap state, not a hover state.
- Card hover behaviour is a subtle elevation lift using the card float shadow tier (see Section 5 — Elevation). No colour change occurs.
- Tertiary text buttons (`button-tertiary-text`) apply an underline on hover. No colour change.

**What is not documented:**
- Sub-nav background tints on pointer-enter.
- Footer link colour shift on hover.
- Icon button background shift on hover.

These are to be extracted directly from live implementation when available.

---

### 6.2 Loading States & Skeleton Screens

**Status:** Not captured on extracted surfaces.

No skeleton screen patterns were visible in the surfaces used to produce this design system. The following is the expected pattern based on system conventions and should be validated against live implementation before use.

**Expected skeleton behaviour:**
- Skeleton screens use `colors.surface-strong` (#f2f2f2) as the base fill.
- Animated shimmer runs left-to-right using a linear gradient from `colors.surface-strong` → `colors.surface-soft` → `colors.surface-strong`.
- Skeleton shapes mirror the real component's geometry: `rounded.md` for cards, `rounded.full` for avatars and badge placeholders, `rounded.sm` for input and button placeholders.
- No content text, icons, or colour is shown during loading — shapes only.

**Needs confirmation:**
- Shimmer animation duration and easing.
- Whether the search bar displays a skeleton or stays inert during page load.
- Skeleton behaviour on the listing detail page (photo banner + reservation card).

---

### 6.3 Form Error State (Full)

**Status:** Partially documented. Token exists; full visual treatment not captured.

`colors.primary-error-text` (#c13515) is in the colour system. The complete error state for a text input — border treatment, helper text layout, and spacing — was not visible on captured surfaces.

**Expected treatment based on system conventions:**

| Property | Value |
|---|---|
| Input border | 2px solid `colors.primary-error-text` (#c13515) |
| Input background | `colors.canvas` (#ffffff) — unchanged |
| Helper text colour | `colors.primary-error-text` (#c13515) |
| Helper text style | `typography.caption-sm` — 13px / 400 / lh 1.23 |
| Helper text position | Below the input field, `spacing.xs` (4px) gap |
| Label colour | `colors.primary-error-text` (#c13515) — shifts from muted |
| Error hover | Helper text link colour shifts to `colors.primary-error-text-hover` (#b32505) |

**Needs confirmation:**
- Whether an error icon (e.g. ⚠) appears inside the input trailing edge.
- Whether the label above the input also shifts to error colour or stays muted.
- Error state behaviour on focus — does the 2px ink focus border override the error border, or does error take precedence?

---

### 6.4 Sub-brand Full Systems

**Status:** Tokens documented. Full sub-systems out of scope.

`colors.luxe` (Brand Teal — #76abae) and `colors.plus` (Brand Dark — #303841) are registered in the token system and appear on the mainline canvas in limited roles. Their full sub-brand systems — including typography overrides, surface treatment, and component-level colour mapping — live on separate sub-domains and were not captured as part of this extraction.

**What is documented (mainline use only):**

| Token | Mainline role |
|---|---|
| `colors.luxe` | Supporting brand accent for secondary highlights. Used on the `superhost` badge outline and teal brand moments. |
| `colors.plus` | Deep supporting brand tone. Shared with `colors.primary-active` — same hex (#303841), separate semantic role. |

**What is not documented:**
- Luxe sub-domain: full colour palette, typography scale overrides, card and surface treatments.
- Plus sub-domain: equivalent.
- Whether sub-brand contexts override `colors.primary` (Brand Red) entirely or layer alongside it.

These systems are to be documented separately when the sub-domain surfaces are available for extraction.

---

### 6.5 Dark Mode

**Status:** Not scoped.

Kullina has no dark mode on the public web as of this version. No dark-mode tokens, surface inversions, or colour mappings are defined.

**If dark mode is scoped in a future version, the following will need definition:**
- Canvas inversion — a dark page floor token to replace `colors.canvas` (#ffffff).
- Text inversion — replacements for `colors.ink`, `colors.body`, `colors.muted`, and `colors.muted-soft` on dark surfaces.
- Surface token set — dark equivalents of `surface-soft`, `surface-card`, `surface-strong`.
- Hairline and border tokens on dark.
- Shadow tier re-evaluation — the current card float shadow is tuned for white-on-white separation and will not work on dark surfaces.
- Brand Red (`colors.primary`) contrast check against dark canvas — #ff5722 on dark may need a lighter tint variant to meet WCAG AA.
