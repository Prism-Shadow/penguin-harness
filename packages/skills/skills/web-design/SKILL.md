---
name: web-design
description: Default visual language for generated web pages — minimal black-white-gray, square corners, hierarchy from weight and spacing; colors, radii and gradients only on explicit request.
short_description: Minimal monochrome defaults for generated web pages.
short_description_zh: 生成网页的极简黑白默认视觉规范。
version: 1
updated: 2026-07-17T00:00:00Z
---

# Web Design

Default visual rules for every web page or frontend interface you generate. Apply them to any HTML/CSS you produce unless the user explicitly asks otherwise.

## Before you start

If the user's message only invokes this skill (e.g. "use web-design skill") without a concrete page or interface to build, ask the user what they want to build. Do not start until the requirement is clear.

## Core rules

- Monochrome only: black, white and grays. No accent colors, no gradients, no decorative shadows.
- Square corners everywhere: `border-radius: 0` on buttons, cards, inputs, images and modals.
- Hierarchy comes from font weight, font size, spacing and thin light-gray borders — never from colored blocks or backgrounds.
- Generous whitespace: prefer more spacing over more dividers; let sections breathe.
- Introduce colors, rounded corners or gradients **only when the user explicitly asks for them**, and only where asked — the rest of the page stays monochrome and square.

## Tokens

Base every stylesheet on a small monochrome token set:

```css
:root {
  --fg: #111111; /* primary text */
  --fg-muted: #666666; /* secondary text */
  --bg: #ffffff; /* page background */
  --bg-subtle: #f5f5f5; /* raised surfaces */
  --border: #e2e2e2; /* hairline borders (1px) */
}
```

Tailwind equivalent: stick to `text-neutral-900` / `text-neutral-500` / `bg-white` / `bg-neutral-100` / `border-neutral-200` / `rounded-none`; do not use color utilities (`blue-*`, `emerald-*`, ...), `rounded-*` variants other than `rounded-none`, or `bg-gradient-*`.
