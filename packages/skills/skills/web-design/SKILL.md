---
name: web-design
description: Penguin visual language for generated web pages and app UIs — GitHub-style simplicity with a single blue accent, light and pure-black dark themes, design tokens, and component and chat-interface recipes.
short_description: Penguin-style visual defaults for generated web UIs.
short_description_zh: 生成网页的 Penguin 风格视觉规范。
version: 1
updated: 2026-07-20T00:00:00Z
---

# Web Design

Default visual language for every web page or frontend you generate, distilled from the Penguin Harness landing page and web app. The idea is **GitHub-style simplicity**: solid backgrounds, 1px borders instead of shadows, system fonts, one blue accent used sparingly. Depth comes from hairline borders, not shadows or gradients; dark mode is pure black, not navy. Apply these defaults unless the user explicitly asks for another style.

## Before you start

If the user's message only invokes this skill (e.g. "use web-design skill") without a concrete page or interface to build, ask what they want to build. When a concrete build is already requested (an app UI, a landing page, a RAG chat interface), do **not** ask about styling — apply the defaults below.

## Design tokens

```css
:root {
  color-scheme: light;
  /* Brand blue — the only accent family. Use sparingly: links, eyebrows, tiny dots, tints. */
  --brand-50: #e8f0fe; --brand-100: #d2e3fc; --brand-300: #8ab4f8; --brand-500: #4285f4;
  --brand-600: #1a73e8; /* accent text/icons in light mode */ --brand-700: #0b57d0; /* links on white */
  /* Neutrals (Tailwind gray) */
  --gray-50: #f9fafb; --gray-100: #f3f4f6; --gray-200: #e5e7eb; --gray-300: #d1d5db;
  --gray-400: #9ca3af; --gray-500: #6b7280; --gray-600: #4b5563; --gray-900: #111827;
  --bg: #ffffff; --surface: #ffffff; --border: var(--gray-200); --control-border: var(--gray-300);
  --fg: var(--gray-900); --fg-muted: var(--gray-600); --fg-faint: var(--gray-500);
  --accent-bg: #111827; --accent-fg: #ffffff; /* primary buttons are near-black, not blue */
  --radius-control: 6px; /* buttons, inputs, chips */ --radius-card: 12px; /* cards, panels */
  --ease: cubic-bezier(0.2, 0.7, 0.3, 1);
}
.dark {
  color-scheme: dark; /* pure black, no blue tint */
  --bg: #000000; --surface: #0d0d0d; --border: #1f1f1f; --control-border: #303030;
  --fg: #f3f4f6; --fg-muted: #9ca3af; --fg-faint: #6b7280;
  --accent-bg: #f3f4f6; --accent-fg: #111827; /* primary button inverts to light */
  --brand-600: #8ab4f8; --brand-700: #8ab4f8; /* brand text flips to the 300 tone */
}
```

- Toggle dark mode with a `dark` class on `<html>` (persist the choice; default to `prefers-color-scheme`).
- Primary buttons are **neutral black/white**, never blue fills. Brand blue is reserved for accents: links, section eyebrows, small status dots, `--brand-50` tinted chips.
- Pills, badges and dots use `border-radius: 9999px`; everything else uses the two radii above. No gradients or elevation shadows on content (modals excepted; flat focus rings drawn with `box-shadow` are fine).

## Typography

System fonts only — no CDN fonts, no @font-face. The CJK entries matter (bilingual product):

```css
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
       "PingFang SC", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }
code, pre, kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
```

Headings are always `font-weight: 600` with `letter-spacing: -0.025em` — nothing heavier, no thin weights. Scale: page/hero title 30–36px; section title 24–30px; card title 16–18px; body 14px / line-height 1.5; captions 12px in `--fg-faint`; code 13px / line-height 1.85. Hierarchy comes from weight, size, spacing and hairlines — never from colored blocks.

## Language

Write the page's UI copy in the language the user's request was made in — a Chinese request gets a Chinese interface, an English request an English one — and set `<html lang>` to match. Code identifiers, CSS class names and code comments stay English.

## Components

- **Primary button** — `background: var(--accent-bg); color: var(--accent-fg); border-radius: 6px; padding: 6px 12px; font-size: 14px; font-weight: 500;` hover: `opacity: .9`. Large CTA variant: height 44px, radius 8px, padding 0 20px.
- **Secondary button** — white/`--surface` bg, `1px solid var(--control-border)`, same paddings; hover swaps bg to `--gray-100`/dark `#1f1f1f`.
- **Card** — `border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 24px;` hover changes **only the border color** (one step darker) — no lift, shadow or scale.
- **Input / textarea** — `border: 1px solid var(--control-border); border-radius: 6px; padding: 8px 12px;` focus: border one step darker + `box-shadow: 0 0 0 2px rgb(156 163 175 / .3)`; no default outline stacking.
- **Pill chip** — `border-radius: 9999px; border: 1px solid var(--border); padding: 4px 10px; font-size: 12px; color: var(--fg-muted);` hover: bg `--gray-50`. Brand-tinted variant: `--brand-50` bg, `--brand-700` text.
- **Sticky nav** — `height: 56px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--bg) 85%, transparent); backdrop-filter: blur(8px);` logo 28px + product name 15px semibold.
- **Code block** — `--gray-50`/dark `--surface` bg card with a bordered header row (mono 12px label + copy button), body mono 13px.
- **Focus** — `:focus-visible { outline: 3px solid rgb(107 114 128 / .4); outline-offset: 2px; }`.

## Motion

One easing everywhere: `var(--ease)`, durations 120–280ms. Entrances rise in (`translateY(10px)` + fade, 280ms, stagger siblings by 40ms); overlays fade (120ms); hover feedback is **color-only** (`transition: color, background-color, border-color 150ms`) — never transform on hover. Always include:

```css
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
```

## Chat / RAG app layout

The default shape for a generated conversational or docs-QA app:

- **Shell** — centered column, `max-width: 48rem`, `padding: 0 16px`; sticky nav on top with the app name; message list grows, composer pinned at the bottom.
- **Empty state** — vertically centered title + one-line subtitle in `--fg-muted`, over an optional dot-grid backdrop (`background-image: radial-gradient(rgb(26 115 232 / .14) 1px, transparent 1px); background-size: 22px 22px;` faded out with a bottom mask) — the only decorative flourish allowed. Below it, a wrapped row of 3–4 example-question pill chips the app can genuinely answer; clicking one fills and submits the composer.
- **Messages** — user messages right-aligned in a `--gray-100`/dark `#1f1f1f` rounded bubble (radius 12px, padding 8px 14px, max-width 85%); assistant messages plain on the page background, no bubble. Stream deltas into the assistant message as they arrive with a 1-character pulsing cursor; render markdown.
- **Citations** — after an answer, a wrapped row of pill chips: `[1] path — heading`, brand-tinted variant, title attribute carrying the full path.
- **Composer** — a bordered card (radius 12px) with a borderless textarea inside and a small primary send button bottom-right; Enter sends, Shift+Enter for newline; disable while streaming. **Never send while an IME composition is in progress**: on keydown, ignore Enter when `event.isComposing` (or `event.keyCode === 229`) — for CJK input methods that Enter only confirms the composed text, and auto-sending on it fires half-typed messages.
- **States** — loading: three pulsing dots in `--fg-faint`; error: 13px `#b91c1c` text on `#fef2f2` (dark: `#f87171` on `#450a0a`) in a rounded box with a retry affordance. Never leave a silent failure.

## Page layout (marketing / landing)

Content width `max-width: 72rem`, gutters 16–24px; section rhythm `padding: 64–96px 0`; section header = uppercase 14px semibold brand-colored eyebrow → title → one-line subtitle in `--fg-muted`, then a card grid (`gap: 20px`, 2–3 columns, collapsing to one on mobile). Hero: centered, logo + name, headline with at most one brand-colored word, CTA pair (primary + secondary). Responsive by default: single column under 640px, tap targets ≥ 40px, no horizontal scroll.
