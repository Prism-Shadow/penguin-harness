# Settings → Appearance switches between the three themes

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#892](https://github.com/Prism-Shadow/penguin-harness/pull/892)

[中文版](2026-09-29-theme-switching.zh.md)

The Web App's Appearance settings gained a theme picker — Primer (通用), Frost (白领) and Console (极客) — together with five text sizes, a font pairing and the active theme's own accent palette. Every choice applies on the spot and is remembered per browser. The default text size became 16px, the step that used to be the smallest.

## Appearance settings

- **Theme** picks Primer, Frost or Console; **Mode** keeps light, dark and follow-system.
- **Accent** lists the active theme's own presets after "Theme's own". A preset another theme lists is kept: it shows as the theme's own accent until a theme that lists it is active again.
- **Font size** has five steps — XS 14px, S 15px, M 16px (the new default), L 18px (the old default) and XL 20px. A size chosen in an earlier release carries over by pixels; see [backward compatibility](2026-09-29-backward-compatibility.md).
- **Fonts** picks the Latin face and the CJK face separately, each defaulting to the theme's own; the monospaced face always stays the theme's.
- A new **Credits** page, last in the Personal group and open to every account (the desktop window included), lists each bundled font — its family, the themes that use it, its license, and the full license text on request. The MiSans credit moved there from the account menu.

## The themes reach the real app

- The app window, the sidebar's navigation rows and group headers, the settings rail, menu rows, the work group and its thinking and tool rows, the composer card, menus, popovers, tooltips and dialogs, settings rows, page titles and tab bars carry the theme hooks, so Frost and Console restyle them as they do in the gallery — Frost's shimmer on running work and Console's transcript-style steps included. Notices (toasts and notice strips) and the usage, context and score charts carry hooks too, so each theme draws them its own way. Primer looks as before apart from the new default size.
- The switch knob and filled accent buttons take their colours from the theme, so a knob stays visible on a light accent track and a label stays readable on every accent fill.

## Tooltips, pickers and counts

- Every hover hint in the Web App shows in the app's own tooltip — the one the sidebar's rail used — instead of the browser's: it opens after a short pause, on keyboard focus as well as on hover, and follows the theme. Truncated text shows whole in it. Elements whose hint was their only name keep that name for screen readers.
- Pickers and menus share one look: the panel, row spacing, hover and selected states and the check mark of the settings selects, in the composer's model, thinking, permission and skill pickers, the agent, machine, protocol and organization pickers, and every menu.
- The pending-approval count beside a Session title is a plain number in the attention colour, with no rounded badge behind it.

## Calmer dark mode

- Dark mode keeps near-white for headings and emphasis and sets body text a step below it, at least 11:1 against every page surface; secondary text stays at least 6:1 and meta text (timestamps, placeholders) at least 4.5:1. Primer's dark canvas is lifted off pure black, and the gray scale behind `dark:` classes moves with it.
- In Console, messages, the composer's input and Session titles read in the sans reading face; navigation, labels, step rows and code stay monospaced. Console's work group loses its box, and Frost's work group lines its steps up with the header.
- Frost's dialogs are opaque (only menus, popovers and tooltips stay frosted), and at phone width the app fills the screen with no inset around it.

## Details

- The de-slop guard's new hits from recent work were fixed in place (literal text sizes moved onto rungs, off-rhythm gaps and paddings, an unnamed transform transition, pulsing marks now carrying the `ui-live` hook, one oversized shadow); the spinners, the notice-strip map, one uppercase heading and one inset accent bar were allowlisted for their planned waves.
