# Detection patterns

Concrete signals for each tell. `scripts/scan.mjs` encodes these; this file is
the human reference and the place to widen patterns for a specific stack.

**Scan scope.** Frontend source only: `.html .css .scss .tsx .jsx .ts .js .vue
.svelte .astro .md .mdx .php .twig` plus `tailwind.config.*`. Skip
`node_modules dist build .git out .next .astro coverage vendor` and anything
`*.min.*` or a lockfile.

**Every match is a lead, not a verdict.** Open the file and confirm. The false
positives noted below are the usual ways a pattern lies.

**Suppression.** Once the user has defended a hit, pin the decision so re-scans
stay quiet: `--only=` / `--skip=` filter by tell id, `--exclude=` drops paths,
and comment directives suppress in source — `deslop-ignore` (this line),
`deslop-ignore-next-line`, `deslop-ignore-file`, each optionally followed by
tell ids (`/* deslop-ignore-next-line 06 */`). Prefer id-scoped directives so
other tells still surface on those lines.

**Extension.** `--rules=extra.mjs` loads additional tells (same shape as the
core ones; string patterns compile case-insensitive). Use it for
language-specific copy rules — English patterns like tell 14's don't fire on
non-English slop. `scripts/rules.ru.mjs` is a shipped Russian example. Remember
JavaScript's `\b` is ASCII-only: it never matches next to Cyrillic and most
non-Latin scripts, so write plain substrings instead.

---

### 01 Indigo→violet gradient
```
rg -n -i 'from-(indigo|violet|purple|fuchsia)-[0-9]+ ?.*to-(purple|violet|fuchsia|pink)-[0-9]+'
rg -n -i '(linear-gradient|bg-gradient)[^;]*(#6366f1|#8b5cf6|#a855f7|#7c3aed)'
rg -n -i 'shadow-(purple|violet|indigo)-[0-9]+/[0-9]+'
```
*False positives:* a brand that genuinely is purple (check the logo / design
tokens); a one-off illustration. Slop is the *combination* — purple gradient +
glow + pill button + "AI-powered" eyebrow.

### 02 Gradient headline text
```
rg -n 'bg-clip-text.*text-transparent|text-transparent.*bg-clip-text'
rg -n '(-webkit-)?background-clip:\s*text'
rg -n -i '-webkit-text-fill-color:\s*transparent'
```
*False positives:* a logo wordmark; a single deliberate hero treatment. Slop is
gradient text used as the default heading style.

### 03 Warm "cozy" palette
```
rg -n -i '\b(amber|orange|stone)-(50|100|200|300)\b'
rg -n -i 'bg-\[#(fdf6ec|fef3e2|faf3e8|fff7ed|fdf4e3)\]'
rg -n -i 'text-amber-[0-9]+|border-amber-[0-9]+'
rg -n -i 'text-(gray|slate|zinc|neutral)-(400|500)[^"]{0,60}bg-(amber|stone|orange|rose|blue|indigo|green)-'
```
*False positives:* a food/coffee/craft brand where warm is the identity. Slop is
warm-as-default with no brand reason. The last pattern is the sibling tell:
default gray text dropped onto a tinted surface — the gray was never toned to
the background; use a darker shade of the surface hue instead.

### 04 Default semantic palette
```
rg -n -i 'bg-(blue|indigo)-50|bg-amber-50|bg-green-50|bg-emerald-50|bg-red-50'
rg -n -i 'text-(blue|indigo)-(600|700).*text-(green|emerald)-(600|700)'  # multiple stock hues near each other
rg -n -i 'info.*blue|warning.*amber|success.*green|error.*red'
```
*Confirm:* three or four of the stock `-50 / -600` semantic pairs used together
(info=blue, tip=amber, success=green, error=red), unrelated to the brand. A
single, deliberate status colour is fine.

### 05 One-hue status box
```
rg -n -i 'border-(red|amber|yellow|green|blue)-[0-9]+[^"]*text-\1-[0-9]+'
rg -n -i 'bg-(red|amber|yellow|green)-[0-9]+/(5|10|15|20)'
rg -n -i '(error|warning|success)[^\n]{0,40}(red|amber|yellow|green)-[0-9]+'
```
*Confirm:* one box where border, text, and a `/10` background are all the same
hue — the whole alert is one colour at three opacities. A single muted accent on
a neutral surface is fine.

### 06 Gradients as atmosphere
```
rg -n -i 'radial-gradient|bg-\[radial-gradient'
rg -n -i 'linear-gradient[^;]*(to bottom|180deg|to top)'  # top-lighter surface fill
rg -n -i 'bg-gradient-to-(b|t)\b[\s\S]{0,40}from-'
rg -n -i 'repeating-(linear|radial)-gradient'
rg -n -i 'bg-gradient-to-(br|tr|bl|tl)\b[\s\S]{0,40}from-(emerald|green|teal|cyan|purple|violet|fuchsia)-\d+/(5|10|15|20|25)'  # per-card accent-hue wash
rg -n -i 'box-shadow:[^;]*(#(6366f1|8b5cf6|a855f7|22d3ee|06b6d4)|rgba?\(139|rgba?\(168)'  # colored glow accents
```
*Confirm:* a page-wide radial glow behind everything, or card surfaces filled
with a top-to-bottom gradient where a flat colour would do; bento cards each
washed in a tint of their own accent (green card → green gradient, purple →
purple); repeating-gradient stripes as surface decoration; colored box-shadow
glows as dark-mode accents. A gradient that points at something specific is a
choice, not slop.

### 07 Serif-italic on one word
Hard to grep purely; look for a serif font family or `<em>/italic` applied
*inside* an otherwise-sans heading.
```
rg -n -i 'font-serif|font-family:\s*(georgia|"?playfair|"?lora|"?cormorant)'
rg -n '<em>|italic' -g '*.{tsx,jsx,vue,svelte,astro,html}'
```
*Confirm:* the italic/serif span sits within an `<h1>/<h2>` whose base font is
sans.

### 08 Serif where sans belongs
```
rg -n -i 'font-family:\s*[^;]*(playfair|cormorant|lora|"?dm serif|"?libre baskerville)'
rg -n -i "fontFamily.*(Playfair|Cormorant|Lora)"
rg -n -i 'font-serif[^"]{0,60}(italic|text-[4-9]xl)|(italic|text-[4-9]xl)[^"]{0,60}font-serif'
```
*False positives:* an editorial/publishing product that wants serif. Slop is
display serif as UI/body on a tool or dashboard — or the oversized italic-serif
hero headline, now the universal AI-startup landing page uniform. Set it roman
or use a non-serif display face; a genuinely editorial register may keep it.

### 09 Decorative strikes & highlights
```
rg -n -i 'line-through' -g '*.{css,scss,tsx,jsx,vue,svelte,astro,html}'
rg -n '<(mark|s|u|del|strike)[\s>]' -g '*.{md,mdx,html,tsx,jsx,vue,svelte,astro}'
rg -n -i 'text-decoration:\s*(line-through|underline)'
```
*Confirm:* a strike over text that isn't being deleted, an underline that isn't
a link, a highlighter swipe under a heading — decoration, not annotation. Real
edits, links, and annotations are fine.

### 10 The kicker above every heading
```
rg -n -i 'uppercase[\s\S]{0,40}tracking-(wide|wider|widest)|tracking-(wide|wider|widest)[\s\S]{0,40}uppercase'
rg -n -i '\b(eyebrow|kicker|overline)\b' -g '*.{css,scss,tsx,jsx,vue,svelte,astro,html}'
rg -n -i 'text-transform:\s*uppercase[\s\S]{0,80}letter-spacing:\s*0?\.[0-9]+em'
```
*Confirm:* the same tracked-caps micro-label above the hero *and* every section
heading, saying what the heading already says (FEATURES over features). A
kicker that adds a real dimension — a category, a date, a number in a genuine
sequence — is an editorial device doing its job.

### 11 Full-sentence display headline
```
rg -n 'text-(5|6|7|8|9)xl' -g '*.{tsx,jsx,vue,svelte,astro,html}'
rg -n -i 'tracking-tighter?\b[\s\S]{0,40}font-(extrabold|black)|font-(extrabold|black)[\s\S]{0,40}tracking-tighter?\b'
rg -n -i 'font-size:\s*(clamp\([^)]*[4-9](rem|\.[0-9]+rem)|[5-9][0-9]px|[4-9]rem)'
```
*Confirm:* a full sentence (10+ words) at display size, usually extrabold with
crushed tracking, wrapping to 3+ lines. Two or three words at display size is
what display sizes are for. Crushed tracking on its own is the same tell:
`letter-spacing` past the point where characters keep their shapes
(`rg -n -i 'letter-spacing:\s*-0?\.0[5-9]'`).

### 12 Flat type hierarchy
```
rg -n '<h[12][^>]*text-(sm|base|lg)\b'
rg -n -i 'font-size:\s*1[4-8]px' -g '*.css'   # then count distinct sizes
```
Mostly a visual judgment: open the page and count the sizes actually in use.
*Confirm:* headings barely bigger than body (steps under ~1.25×), hierarchy
carried by gray shades instead of size. A deliberately quiet, single-size
editorial layout with strong spacing is a choice; a dashboard where the page
title and a table cell match is not.

### 13 Highlighted keywords
```
rg -n '<mark' -g '*.{md,mdx,html,tsx,jsx,vue,svelte,astro}'
rg -n 'text-(primary|indigo|purple|violet)-[0-9]+' -g '*.{tsx,jsx,vue,svelte,astro,html}'
rg -n -i 'font-semibold|font-bold' -g '*.{md,mdx}'
```
*Confirm:* multiple colored/`font-semibold` spans inside one paragraph of body
copy. One accented phrase is fine.

### 14 AI copywriting voice
```
rg -n -i "not just .{1,40}\bit'?s\b|say goodbye to|meet your new|supercharge|unlock the power|in seconds, not"
rg -n -i '\b(blazing[- ]fast|effortless|seamless|game[- ]changer|next[- ]level)\b'
rg -n -i '\b(growth|security|process|privacy|productivity|compliance|feature|innovation) theater\b'
```
Also flag paragraphs built from three-word sentences ("Fast. Beautiful. Yours."),
em-dash triplets, and "we killed the X theater" framing — dismissing something
as *theater* is a recurring generated-copy tic; say plainly what the thing does
or doesn't do. *False positives:* a genuine quote; a doc that discusses these
phrases (like this one).

### 15 Emoji everywhere
```
rg -n '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2190}-\x{21FF}\x{2B00}-\x{2BFF}]' -g '*.{md,mdx,html,tsx,jsx,vue,svelte,astro}'
rg -n -i '(🚀|✨|⚡|🔒|🎉).{0,40}(<|$)'  # emoji leading a heading/button/bullet
```
*False positives:* emoji inside a code sample being documented; an emoji picker
feature; user-generated content. Slop is an emoji stuck on *every* heading,
button, and bullet in your chrome.

### 16 Glowing status dot
```
rg -n -i 'animate-ping|animate-pulse'
rg -n -i 'shadow-(green|emerald|lime)-[0-9]+/[0-9]+|box-shadow:[^;]*(0 0|glow)'
rg -n -i '(ready|online|live)[\s\S]{0,40}(●|rounded-full)'
```
*Confirm:* a status dot with a pulsing halo or coloured glow — usually saturated
green "● Ready / Online." A small flat dot is fine.

### 17 Rounded card, colored left border
```
rg -n -i 'border-l-4 .*rounded|rounded.* border-l-4'
rg -n -i 'border-left:\s*[0-9]+px .*;.*border-radius|admonition|callout|\bnote-box\b'
rg -n -i 'border-2\b[\s\S]{0,40}border-(indigo|purple|violet|blue|pink|green)-[0-9]+'
```
*Confirm:* stacked callouts used as decoration on plain list items, not one
semantic aside. The last pattern is the sibling: a thick accent ring around a
rounded card to make one tier "pop" — the border fights the rounded corners;
remove the ring or carry the emphasis another way.

### 18 Rounded-square icon tiles
```
rg -n -i 'rounded-(lg|xl|2xl) bg-(indigo|purple|blue|green|amber|pink)-(50|100)'
rg -n -i '(lucide|heroicons|@tabler/icons|react-icons)'
rg -n -i '\b[wh]-(20|24|28|32)\b[\s\S]{0,40}(<svg|Icon)'
rg -n '<svg[^>]*(width|height)="(9[6-9]|[1-9][0-9]{2})"'
```
*Confirm:* one icon-in-a-tile per feature, in a grid, icons unrelated to
content — or the same reflex at another size, a giant decorative line icon
parked in a card as filler.

### 19 Max radius + glassmorphism
```
rg -n 'rounded-full' -g '*.{tsx,jsx,vue,svelte,astro,html}'
rg -n -i 'backdrop-blur|backdrop-filter:\s*blur|bg-white/(5|10|20|30)|bg-black/(5|10|20|30)'
rg -n -i 'border-radius:\s*(9999px|50%|2rem|24px)'
```
*Confirm:* `rounded-full` on cards/inputs (not just avatars/pills); blur used as
the default surface; radius values that don't agree with each other.

### 20 Oversized drop shadow
```
rg -n -i 'box-shadow:[^;{}]*\b([6-9][0-9]|[0-9]{3,})px'   # a 60px+ blur/spread
rg -n -i 'shadow-\[[^\]]*\b([6-9][0-9]|[0-9]{3,})px'      # tailwind arbitrary shadow
rg -n -i 'filter:[^;{}]*drop-shadow\([^)]*\b([6-9][0-9]|[0-9]{3,})px'
rg -n -i '\bborder\b[\s\S]{0,40}shadow-(xl|2xl)|shadow-(xl|2xl)[\s\S]{0,40}\bborder\b'
```
*Confirm:* the shadow's render range is far bigger than the element casting it —
a small card/icon under a huge, faint, barely-offset blur (a fog, not a drop).
A genuinely large surface (a modal, a full hero) with a proportionate shadow is
fine; so is one small, tight elevation shadow. The last pattern is the "ghost
card" variant: a hairline border *and* a wide diffuse shadow on the same card —
two separators doing one job; commit to an edge or an elevation.

### 21 Corners that don't nest
Hard to grep with certainty; flag the same radius token on nested containers.
```
rg -n -i 'rounded-(xl|2xl|3xl)' -g '*.{tsx,jsx,vue,svelte,astro,html}'  # then check for nesting
rg -n -i 'border-radius:\s*(1rem|1\.5rem|24px|32px)'
```
*Confirm:* an outer box and an inner box carrying the *same* big radius, so the
corners don't sit concentric. Inner radius should be outer minus the padding; a
single flat radius scale that already nests correctly is fine.

### 22 Border that dies at the corner
The break is visual (a stroke on the straight edges, none along the arcs);
grep for the code that produces it — a radius and a border on different boxes.
```
rg -n -i 'rounded-(lg|xl|2xl|3xl)[^"]{0,60}overflow-(hidden|clip)|overflow-(hidden|clip)[^"]{0,60}rounded-(lg|xl|2xl|3xl)'   # clipping wrapper: check the child for a border
rg -n -i 'clip-path:\s*inset\([^)]*round'
rg -n -i 'border-[trbl]\b[^"]{0,60}rounded-(lg|xl|2xl|3xl)|rounded-(lg|xl|2xl|3xl)[^"]{0,60}border-[trbl]\b'
```
*Confirm:* a `rounded overflow-hidden` wrapper whose child carries the 1px
border/dividers — the square ring is erased at every corner by the clip; a
`clip-path: inset(… round …)` cutting a border off; or a single-side border
stopping mid-arc on a rounded box. A border set on the rounded element itself
wraps the arc and is fine; so are straight dividers between square-cornered
regions.

### 23 Badge & pill spam
```
rg -n -i 'rounded-full .*(bg-(indigo|purple|green|amber|pink)-(50|100|200))'
rg -n -i '>(\s*[✨🔥🎉🚀]\s*)?(new|beta|hot|popular|pro|coming soon)\s*<'
```
*Confirm:* several decorative pills in chrome. A real version tag is fine.

### 24 AI-drawn SVG icons
Grep finds inline SVG; the judgment is visual.
```
rg -n '<svg' -g '*.{tsx,jsx,vue,svelte,astro,html,svg}'
rg -n -i '<circle[^>]*r="[0-9]'  # dot eyes / blob body built from primitives
rg -n -i '(mascot|blob|logo)\.svg'
```
*Confirm:* an inline `<svg>` that's a blob-with-dot-eyes or a cartoon creature
built from primitive shapes, shipped as the product's mark. A drawn icon set or
a real designed logo is fine.

### 25 Icon in a tint of itself
```
rg -n -i 'bg-(indigo|blue|green|amber|red|purple|pink)-[0-9]+/(5|10|15|20)[\s\S]{0,60}text-\1-'
rg -n -i 'text-(indigo|blue|green|amber|red|purple|pink)-[0-9]+[\s\S]{0,60}bg-\1-[0-9]+/(5|10|15|20)'
rg -n -i 'rounded-(md|lg|xl)\s+bg-(indigo|blue|green|amber|red)-[0-9]+/(5|10|15|20)'
```
*Confirm:* an icon tile whose translucent background is the same hue as the icon
inside it — every glyph wrapped in a soft colored square. A deliberate opaque
button surface is fine.

### 26 The springy hover
```
rg -n -i 'hover:(scale-1[01][0-9]|-translate-y-)'
rg -n '\btransition-all\b'
rg -n -i 'cubic-bezier\([^)]*,\s*1\.[2-9][0-9]*'   # overshoot easing = bounce
rg -n -i 'animate-bounce|transition:[^;]*\b(width|height|margin|padding)\b'
```
*Confirm:* scale/lift/bounce on hover across cards, buttons, and images, and
`transition-all` as the default. A drawer that springs as it physically slides
in is motion doing a job; a card that jumps when the cursor grazes it is not.
Also flag animating layout properties (width/height/margin/padding) — jank on
top of the decoration.

### 27 The wobbling spinner
```
rg -n 'translate\(-50%, ?-50%\)' -g '*.{css,tsx,jsx,vue,svelte,astro,html}'
rg -n '@keyframes +[a-zA-Z-]*(spin|rotate|load)'
rg -n -i 'animate-spin'
rg -n 'transform-origin: *[0-9]'
```
*Confirm:* run the page and watch one full revolution — the arc's centre must
not trace a circle. Code tells: a spin keyframe that sets `transform:
rotate(…)` on an element centered with `transform: translate(-50%, -50%)` (the
keyframe replaces the whole property, so the element snaps off-centre and
orbits); a `transform-origin` that isn't the element's centre; `animate-spin`
on an emoji or on an SVG whose artwork isn't centred in its viewBox. A
centered element whose keyframe re-states the translate (`translate(-50%,
-50%) rotate(360deg)`) is fine.

### 28 The all-caps card grid
```
rg -n -i 'grid-cols-3'
rg -n -i 'uppercase[\s\S]{0,30}(text-xs|tracking-wide|tracking-wider)|text-transform:\s*uppercase'
rg -n -i 'everything you need|why (you.?ll love|choose|teams)'
```
*Confirm:* an ALL-CAPS micro-label + number/icon repeated across interchangeable
cards — a feature grid or a stat-card grid — points unrelated.

### 29 The invented stat row
```
rg -n -i '\b[0-9]+[km]\+'
rg -n '99\.9%|24/7'
rg -n -i '(10k|50k|99\.9|24/7)[\s\S]{0,60}(developers|users|teams|uptime|support|countries)'
```
*Confirm:* three big round numbers in a row — a `Nk+`, a `99.9%`, a `24/7` —
with tiny uppercase labels, in the hero or above the fold. A real, odd,
sourced figure ("1,847 CI runs yesterday") is the fix, not a hit.

### 30 The 01 / 02 / 03 section markers
```
rg -n '["'\''>`]0[1-9]["'\''<`]' -g '*.{tsx,jsx,vue,svelte,astro,html}'
rg -n -i 'text-(7|8|9)xl[\s\S]{0,50}(text-(gray|slate|zinc|neutral)-(100|200)|opacity-(5|10|20))'
rg -n -i 'step[- ](one|two|three)'
```
*Confirm:* giant faint ordinals stapled to *unordered* marketing sections. A
genuinely ordered sequence — install steps, a changelog, an indexed catalogue —
has earned its numbers.

### 31 Cards inside cards
Grep gives leads; the judgment is in the rendered DOM.
```
rg -n '<(Card|Panel|Box)[^>]*>\s*<\1' -g '*.{tsx,jsx,vue,svelte}'
rg -n -i 'rounded[^"]*border[^"]*"[\s\S]{0,120}rounded[^"]*border' -g '*.{tsx,jsx,vue,svelte,astro,html}'
```
*Confirm:* three or more nested surfaces each with its own border/radius/shadow
and shrinking padding. A child that is genuinely a separate object (a preview,
an embed) may keep its own surface.

### 32 One gap everywhere
```
rg -n '(space-y-4|gap-4)[^"'\''`]{0,80}(space-y-4|gap-4)'   # the token twice on one line
rg -n -c 'space-y-4|gap-4'                                  # per-file counts; high = lead
```
Mostly a visual judgment: the grep only finds the token, the tell is the
*absence of any other value*. Count the distinct spacing values in a component;
one value for both within-group and between-group distances is the tell.
*Confirm:* a heading equidistant from its own body and from the previous
section. A deliberate uniform grid (a photo wall, a calendar) is a choice.

### 33 Inter everywhere (evolved)
```
rg -n -i 'fonts\.googleapis\.com/css2\?family=(Inter|Space\+Grotesk|Manrope|Plus\+Jakarta)'
rg -n -i 'font-family:\s*[^;]*("?Inter"?|"?Space Grotesk"?|"?Manrope"?|"?Plus Jakarta Sans"?|"?Geist"?)'
rg -n 'from ["'\'']next/font/google' -g '*.{ts,tsx,js,jsx}'
```
*Confirm:* judgment tell — the faces themselves are good. Slop is the stock
pairing (Space Grotesk display + Inter body) or Inter-by-default with no sign
anyone compared alternatives. A team that tried others and landed on Inter made
a choice; check for any evidence of one (a comment, a brand doc, a deliberate
fallback stack).

### 34 The tasteful terminal (evolved)
```
rg -n -i 'font-mono' -g '*.{tsx,jsx,vue,svelte,astro,html}'
rg -n -i 'font-family:\s*[^;]*(mono|jetbrains|fira code|ibm plex mono|geist mono)'
rg -n '[╔╗╚╝║═▓▒░]|\$ [a-z]' -g '*.{tsx,jsx,vue,svelte,astro,html,md}'
```
*Confirm:* monospace on non-code UI chrome; ASCII banners as decoration;
near-black with a single warm accent. This one needs judgment most — it's a
current default, so weigh whether the terminal metaphor actually serves the
product.

### 35 The editorial dashboard (evolved)
```
rg -n -i '>\s*Good (morning|afternoon|evening),' -g '*.{tsx,jsx,vue,svelte,astro,html}'
rg -n -i 'font-serif' -g '*.{tsx,jsx,vue,svelte,astro,html}'
rg -n -i 'font-family:\s*[^;]*(fraunces|canela|tiempos|didot|freight|reckless|newsreader)'
rg -n -i 'oldstyle-nums|font-variant-numeric:\s*oldstyle'
```
*Confirm:* the serif is on app chrome (a dashboard h1, stat-card numerals),
not on genuinely editorial content; the greeting-as-headline sits on an
operational surface; the cream + tracked-caps kicker + deep accent kit came
as a set. A docs site or essay page in a text serif is not this tell.
