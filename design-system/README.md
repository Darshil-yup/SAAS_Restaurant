# Kullina Design System

Single source of truth for all design tokens, typography scale, and component styles.

## Usage

### CSS (existing Vite app)

```css
@import '../design-system/css/tokens.css';
@import '../design-system/css/typography.css';
```

### TypeScript (monorepo / new apps)

```typescript
import { colors, spacing, radii, shadows, typography, breakpoints } from './design-system/ts/tokens';
```

### Typography classes

```html
<h1 class="type-display-xl">Page Title</h1>
<p class="type-body-md">Running text</p>
<span class="type-badge">NEW</span>
```

## Token Reference

### Colors

| Token | Hex | Role |
|---|---|---|
| `--color-primary` | `#ff5722` | Brand Red — CTAs, accent |
| `--color-primary-active` | `#303841` | Brand Dark — press state |
| `--color-primary-disabled` | `#f5f5f5` | Disabled fill |
| `--color-luxe` | `#76abae` | Brand Teal |
| `--color-ink` | `#222222` | Primary text (never pure black) |
| `--color-body` | `#3f3f3f` | Secondary text |
| `--color-muted` | `#6a6a6a` | Tertiary text |
| `--color-canvas` | `#ffffff` | Page background |

### Spacing (4px base)

`--spacing-xxs` (2px) → `--spacing-xs` (4px) → `--spacing-sm` (8px) → `--spacing-md` (12px) → `--spacing-base` (16px) → `--spacing-lg` (24px) → `--spacing-xl` (32px) → `--spacing-xxl` (48px)

### Border Radius

`--radius-xs` (4px) → `--radius-sm` (8px, buttons) → `--radius-md` (14px, cards) → `--radius-full` (9999px, pills)

### Elevation

Single tier only: `--shadow-card` for interactive surfaces. No stacked shadows.

## Rules

1. **No hover color changes.** Use elevation, transform, or cursor changes for hover state.
2. **No pure black.** Text uses `#222222` (`--color-ink`).
3. **No hard corners on interactive elements.** Everything gets a radius.
4. **Single shadow tier.** Depth via photography and white-on-white separation.
