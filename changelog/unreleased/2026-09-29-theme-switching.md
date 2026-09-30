# Settings → Appearance switches between the three themes

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#892](https://github.com/Prism-Shadow/penguin-harness/pull/892)

[中文版](2026-09-29-theme-switching.zh.md)

The Web App's Appearance settings gained a theme picker — Primer (通用), Frost (白领) and Console (极客) — together with five text sizes, a font pairing and the active theme's own accent palette. Every choice applies on the spot and is remembered per browser. The default text size became 16px, the step that used to be the smallest.

## Appearance settings

- **Theme** picks Primer, Frost or Console; **Mode** keeps light, dark and follow-system.
- **Accent** lists the active theme's own presets after "Theme's own". A preset another theme lists is kept: it shows as the theme's own accent until a theme that lists it is active again. "Theme's own" is painted in the colour it resolves to; Console's own accent is black and white (near-black in light, near-white in dark), with its former orange-red kept as a preset.
- **Font size** has five steps — XS 14px, S 15px, M 16px (the new default), L 18px (the old default) and XL 20px. A size chosen in an earlier release carries over by pixels; see [backward compatibility](2026-09-29-backward-compatibility.md).
- **Fonts** picks the Latin face and the CJK face separately, each defaulting to the theme's own; the monospaced face always stays the theme's.
- A new **Credits** page, last in the Personal group and open to every account (the desktop window included), lists each bundled font — its family, the themes that use it, its license, and the full license text on request. The MiSans credit moved there from the account menu, as MiSans's entry in the list.

## The themes reach the real app

- The app window, the sidebar's navigation rows and group headers, the settings rail, menu rows, the work group and its thinking and tool rows, the composer card, menus, popovers, tooltips and dialogs, settings rows, page titles and tab bars carry the theme hooks, so Frost and Console restyle them as they do in the gallery — Frost's shimmer on running work and Console's transcript-style steps included. Notices (toasts and notice strips) and the usage, context and score charts carry hooks too, so each theme draws them its own way. Primer looks as before apart from the new default size.
- The switch knob and filled accent buttons take their colours from the theme, so a knob stays visible on a light accent track and a label stays readable on every accent fill.

## Tooltips, pickers and counts

- Every hover hint in the Web App shows in the app's own tooltip — the one the sidebar's rail used — instead of the browser's: it opens after a short pause, on keyboard focus as well as on hover, and follows the theme. A hint shows only where its words are not already on screen: on an icon-only control or a chart mark, or when the element's text is cut off, and then it shows the text whole. Elements whose hint was their only name keep that name for screen readers.
- A copy button turns its icon into a check for a moment after copying; its label and its tooltip never change to "Copied".
- Pickers and menus share one look: the panel, row spacing, hover and selected states and the check mark of the settings selects, in the composer's model, thinking, permission and skill pickers, the agent, machine, protocol and organization pickers, and every menu.
- The pending-approval count beside a Session title is a plain number in the attention colour, with no rounded badge behind it.

## Charts follow the theme

- Every chart draws through one shared set of chart parts — bars, lines, the fill under a line, points, grid and axis labels, and the Trace timeline's bars: the cost center's requests, Token and cost charts, the context donut, the Evaluation Center's score chart and sparkline, the agents' activity sparkline and the Trace timeline. The theme decides how each part looks: its palette, bar width, corners, outline and fill, line width and curve, point shape and the fill under a line.
- Frost draws soft, low-glare pastels — pale, borderless, rounded bars, smooth curves and a faint grid; Console draws thin, solid bars with a 1px outline, stepped 1px lines, square points and a dashed grid. Primer draws them as before, except that the Trace timeline now uses the same palette shades as the other charts — in dark mode its bars are one step deeper, and the approval-wait bar is a slightly deeper rose in both modes.

## Frost and Console, refined

- Frost follows a calm, cool off-white: the sidebar and the main area are told apart by fill alone (no inset card, radius or shadow), groups are soft fills instead of lines — the Settings rows sit in one soft band — dialogs are opaque with 20px corners, status pills have no border, and icons are muted monochrome.
- Console is pared down to a terminal's plainness: cards, rows and menus are the page plus a hairline, tints and shadows are gone, and notices and toasts read as status lines (`[ OK ]`, `[WARN]`, `[FAIL]`, `[INFO]`, `[NOTE]`).
- The settings switch's knob now scales with the theme's spacing, so it no longer runs past Console's track; the two font pickers in Appearance stay on one line.

## Calmer dark mode

- Dark mode keeps near-white for headings and emphasis and sets body text a step below it, at least 11:1 against every page surface; secondary text stays at least 6:1 and meta text (timestamps, placeholders) at least 4.5:1. Primer's dark canvas is lifted off pure black, and the gray scale behind `dark:` classes moves with it.
- In Console, messages, the composer's input and Session titles read in the sans reading face; navigation, labels, step rows and code stay monospaced. Console's work group loses its box, and Frost's work group lines its steps up with the header.
- Frost's dialogs are opaque (only menus, popovers and tooltips stay frosted), and at phone width the app fills the screen with no inset around it.

## Details

- The de-slop guard's new hits from recent work were fixed in place (literal text sizes moved onto rungs, off-rhythm gaps and paddings, an unnamed transform transition, pulsing marks now carrying the `ui-live` hook, one oversized shadow); the spinners, the notice-strip map, one uppercase heading and one inset accent bar were allowlisted for their planned waves.
