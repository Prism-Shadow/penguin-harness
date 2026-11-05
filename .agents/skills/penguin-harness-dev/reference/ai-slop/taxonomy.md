# The AI-slop taxonomy

35 tells, in two tiers. **Classic** = widely recognised. **Evolved** = newer
defaults that already read as templated. For each: what it is, why it reads as
machine-made, and the fix. Detection patterns live in `detection.md`; code
patches in `fixes.md`.

The rule under every entry: slop is the *absence of a decision*. A tell is only
slop when it's a default nobody chose. The same element, chosen and defended,
is fine.

## Color

**01 · Indigo→violet gradient** — the `#6366f1 → #a855f7` diagonal on buttons,
glows, and hero backgrounds. It's the factory setting of Tailwind demos and
template galleries, so it reads as an absence of a decision.
*Fix:* one justified accent; if a gradient, give it direction and a reason, not
a "premium" sticker.

**02 · Gradient headline text** — `background-clip:text` rainbow fills on
headings. Trades legibility and contrast for an effect every AI page uses;
decoration eats the message.
*Fix:* solid color for headings; build hierarchy with size, weight, and space.

**03 · Warm "cozy" palette** — amber/stone/orange wash on soft beige. The
model's laziest translation of "warm and friendly": Tailwind's warm ramp served
raw, so every "human" product looks identical.
*Fix:* neutral base + one restrained warm accent; warmth comes from words.

**04 · The default semantic palette** — info in blue/indigo, tip in amber,
success in green, error in red: the framework's stock `-50` backgrounds with
`-600` text. Nobody picked these hues; three or four unrelated candy colors,
related to nothing — not your brand, not each other. A bowl of default rainbow
candy where every box shouts a different colour.
*Fix:* grow semantic colours out of your one palette (tints of a hue plus
neutrals); colour only the states that truly differ. Most notes need no colour.

**05 · The one-hue status box** — a status or alert where the border, text, and
background are all one hue, the background just a see-through version of it: red
on red, yellow on yellow, green on green. The framework reflex
(`border-red-500`, `text-red-500`, `bg-red-500/10`), one loud hue at three
opacities, nothing toned to sit next to your UI. Red/yellow/green is a traffic
light, not a palette.
*Fix:* carry the state in words and weight first — a bold "Error" reads before
colour does. If you colour at all, one muted accent from your own palette on a
neutral surface.

**06 · Gradients as atmosphere** — a near-black blue page with a soft glow up
top and cards whose surface is itself a gradient, lighter above and darker
below: the default "premium dark mode." The glow and surface gradients carry no
information; it's the move a model makes to look premium in the dark, the same
midnight blue with a spotlight behind a thousand AI pages. Same family:
bento cards each washed in a tint of their own accent — the green card gets a
green gradient, the purple card a purple one — plus repeating-gradient stripes
as surface decoration, and colored box-shadow glows used as dark-mode accents.
*Fix:* pick one flat background and hold it; build surface depth with a hairline
and a restrained shadow. If a glow must exist, let it point at something.

## Type

**07 · Serif-italic on one word** — swapping one word in a sans headline to
serif italic for "emphasis." Cheap drama that stages two voices in one sentence;
the most viral AI headline tic.
*Fix:* emphasise with weight, position, or a line break; keep one voice, and if
you truly need italic use the same family's italic.

**08 · Serif where sans belongs** — Playfair/Lora/Cormorant display serif on a
dev tool or SaaS, as body/UI text or as an oversized italic-serif hero
headline. The model equates "premium" with "serif"; display serifs are hard to
read at UI sizes and tonally off, a tuxedo on a terminal. The italic-serif hero
reads as taste in isolation — by now it's the universal AI-startup landing
page uniform.
*Fix:* one legible sans you chose; serif only when you want that voice, and a
text serif not a display one. Set the hero roman, or use a non-serif display
face (a genuinely editorial product may keep it — judge by context).

**09 · Decorative strikes & highlights** — striking out, underlining, or
swiping a highlighter over a word, not to delete or annotate but as decorative
"emphasis." The same disease as serif-emphasis: the model doesn't trust the
words to carry weight, so it draws on them.
*Fix:* let weight, size, line breaks, and structure carry emphasis; keep strike
for real edits, underline for links, highlight for real annotation.

**10 · The kicker above every heading** — a tiny uppercase, letter-spaced label
above the hero headline, then another above every section heading: FEATURES,
HOW IT WORKS, TESTIMONIALS. The kicker is an editorial device for *adding*
information (a section, a date, a category); the AI page stamps it as a reflex,
and the label restates what the heading already says. Zero information, worn as
a hat on every heading — a template's rhythm, not a decision.
*Fix:* delete any kicker that restates its heading; keep one only where it adds
a real dimension. Let scale and space introduce sections.

**11 · The full-sentence display headline** — a whole marketing sentence set at
display size (`text-6xl font-extrabold tracking-tight`), wrapping to three or
four lines and eating the first viewport. Display sizes are for the two or
three words that can carry that scale; the model doesn't know which words yours
are, so it sets the whole pitch huge and crushes the tracking to look
"designed." Size standing in for the decision about what matters. (The
killaislop.com site itself did it — its definition section set a whole
sentence at display size until this entry forced the fix.)
*Fix:* compress the one thing into a few words and let those be big; say the
rest in a normal-size subline. Tighten tracking only as far as the face was
designed to go.

**12 · The flat type hierarchy** — every size on the page crammed between 14
and 18px: headings barely bigger than body, labels barely smaller, hierarchy
left entirely to shades of gray. The opposite failure of the display-size
sentence, and the same absence: nobody decided what matters most. The model
plays it safe (`text-lg` heading, `text-sm` everything else), so a reader
can't tell the page's one important thing from its footnotes.
*Fix:* a scale with few steps and real contrast between them (1.25× and up);
give the most important thing a size that says so. If two sizes are within a
pixel or two, merge them.

## Copy

**13 · Highlighted keywords** — coloring or bolding scattered words
mid-paragraph, like a highlighter ran over it. When every word is emphasised,
none is; it's the signature of not knowing the point.
*Fix:* let sentence structure carry emphasis — at most one accent per paragraph.

**14 · The AI copywriting voice** — "It's not just X — it's Y", "Say goodbye to
X", punchy three-word triads, an em-dash habit, dismissing things as "X
theater." A rhythmic fingerprint: symmetrical, one notch too excited,
specifics-free.
*Fix:* write something specific — real numbers, nouns, consequences; say it the
way one person explains it to another.

**15 · Emoji everywhere** — an emoji on every heading, button, and bullet: 🚀
launch, ⚡ fast, 🔒 secure, 🎉 delight. Borrowed warmth standing in for tone
that copy and design should carry; a glyph before every point is louder, not
clearer.
*Fix:* cut decorative emoji from the UI; keep one only where it genuinely
carries information, like a real status.

## Components

**16 · The glowing status dot** — a status indicator (online / ready / live)
drawn as a solid dot in a pale halo, usually pulsing, almost always saturated
green; at its most decorative, glued into a hero marketing pill, playing status
for a tagline with no state behind it. A status is a tiny signal; the halo,
pulse, and breathing glow carry no information. Inflating a binary state into a
glowing gem is textbook overdesign.
*Fix:* a small, flat, single-color dot plus a word; no halo, no pulse. Colour
only when the state actually matters or changes — and if nothing is live behind
it, no dot at all.

**17 · Rounded card, colored left border** — a pale rounded box with a 4px
colored bar down the left, wrapped around every list item, not just a "Tip/Note"
but feature points and changelog rows. A docs admonition turned into universal
decoration, so every row looks like an "important note" and none is. Sibling
move: a thick accent ring (`border-2` in a loud color) around a rounded card
to make one tier "pop."
*Fix:* let a list be a list — alignment, spacing, hierarchy. Callouts are
scarce: one or two a page, only for a genuine aside.

**18 · Rounded-square icon tiles** — every feature gets a rounded-square chip +
a line icon, tiled into a grid. Shortest path to "looks designed"; the icons
rarely relate to the content, they just fill the grid. Same reflex at another
size: a giant decorative line icon (`w-24 h-24`) parked in a card as filler.
*Fix:* an icon must carry meaning or go; a clear label + one sentence beats a
row of glyphs.

**19 · Max radius + glassmorphism** — everything a max-radius pill; every card a
translucent `backdrop-blur` pane. A frozen slice of 2021 Dribbble; effect
presets unrelated to what the product says.
*Fix:* one radius, held site-wide (usually small); depth from solid surfaces and
space, not blur.

**20 · The oversized drop shadow** — a small card or icon casting a huge, soft
shadow that bleeds far past it on every side: big blur, low opacity, almost no
offset. A shadow says how high a surface floats, and real light gives a tight
contact shadow plus a soft ambient one with the blur tracking the height; this
one tracks nothing. A big soft blur reads as "depth" in a thumbnail but maps to
no real height — atmosphere standing in for elevation. Variant: the "ghost
card," a hairline border *plus* a wide diffuse shadow on the same card — two
separators doing one job; commit to an edge or an elevation, not both.
*Fix:* a small elevation scale, held: tight blur, small offset, low opacity,
never a shadow bigger than the thing casting it. Often a hairline does the
separating and no shadow is needed; keep it colorless — a tinted glow isn't depth.

**21 · Corners that don't nest** — the same radius on every layer: a big-radius
outer box with an inner box at the same big radius, so the corners don't sit
concentrically and the inner arc fights the outer one. Nested corners have a
rule (inner = outer − gap); AI UIs skip the math and stamp one radius token on
everything.
*Fix:* compute the nested radius (inner = outer − padding), or don't round the
inner element at all; keep a small, deliberate radius scale.

**22 · The border that dies at the corner** — a rounded rectangle with a 1px
hairline on its straight edges and nothing at the corners: the outline runs to
the tangent points and stops, the arcs go naked. It happens because the radius
and the border live on different boxes. The model memorized a recipe — content
that can't round its own corners (a table, an image, a list, a scroll area)
gets wrapped in `rounded-xl overflow-hidden` — while the child component ships
with its own 1px border or dividers. Every line is locally correct: the
wrapper owns the radius, the child owns the stroke. But the square stroke ring
falls outside the rounded clip at all four corners and gets erased; the
straight runs survive inside the clip. The model never renders its own output,
so it never sees the corner; a human sees the broken edge in one glance. The
fingerprint of code that's right line by line and wrong as a whole.
*Fix:* put the radius and the border on the same box — border + border-radius
on one element, and the stroke wraps the arc for free. If an outer layer
genuinely must clip content, move the border up onto the clipping layer too.
Inverse holds: if the lines are really dividers, keep them straight, run them
edge to edge, and don't round the fill.

**23 · Badge and pill spam** — "✨ New", "β Beta", "🔥 Popular" decorative pills
everywhere. Manufacturing fake buzz; in bulk each stops meaning anything.
*Fix:* a badge only for real status (a version, stock).

**24 · AI-drawn SVG icons** — asking a model to "draw an icon" and shipping what
comes back: a round blob with two dot eyes, a mascot of primitive shapes, a logo
that's a rounded square with a face. Vector art the machine can't really draw,
used as the product's mark; it looks like placeholder art that never got
replaced.
*Fix:* get a real, high-quality icon. Commission a designer, or generate one
with the best image model and refine it until it's crisp and on-brand. A crude
SVG the model sketched, or a bare fallback letter, isn't a mark worth shipping.

**25 · Icon in a tint of itself** — every icon wrapped in a rounded square
filled with a see-through tint of its own color: a blue icon on faint blue, a
green one on faint green (`bg-{color}/10` behind `text-{color}`). A one-line
reflex — pad, round, wash in 10% of the icon's hue — so the page becomes a grid
of soft colored squares.
*Fix:* let an icon just be an icon; inherit the text color, no container. If
something genuinely needs one, give it a deliberate opaque surface from your
palette, not a tint of the icon it holds.

## Motion

**26 · The springy hover** — every card, button, and image wearing
`hover:scale-105` and `transition-all`: touch it and it grows, lifts, and
bounces on an elastic ease. Motion is information — what changed, where a thing
went, what's interactive — and scaling a card on hover says nothing; the card
isn't growing, and the user already knows the cursor is on it. `transition-all`
is the tell inside the tell: animating every property is the absence of
deciding which one means something.
*Fix:* transition only the properties that carry the state change (background,
border, opacity), 120–200ms, standard ease. Hover feedback is a surface shift,
not growth; save spring physics for things that genuinely move through space.

**27 · The wobbling spinner** — a loading spinner that doesn't turn around its
own centre: the arc wobbles, tracing a little circle as it spins. Off-centre
artwork, a stray `transform-origin`, or a rotate keyframe that clobbers the
centering `translate(-50%, -50%)` (a keyframe replaces the whole `transform`).
A spinner has exactly one job — rotate in place around a fixed point — and
anyone who runs the page sees the wobble within half a second; shipping it is
an admission that nobody ever watched the interface move. Other tells are an
absence of taste; this one is an absence of looking. It lands at the worst
moment: the user has nothing to do but stare, and the most-watched element on
the page is limping. "Loading" reads as "broken."
*Fix:* give the rotation a real centre: artwork centred in its own box (the
SVG arc centred on the viewBox), `transform-origin` at center, and centering
kept out of the animated `transform` — position with a wrapper or the
standalone `rotate` property. Then watch one full revolution.

## Layout

**28 · The all-caps card grid** — an ALL-CAPS label plus a number or icon,
copied into rows of interchangeable cards: feature grids and dashboard
stat-cards alike. It fakes structure while stuffing unrelated things into
identical boxes; the ALL-CAPS micro-label is the default costume for "looks
designed."
*Fix:* decide the single most important thing and show it fully; if you must
list, use real hierarchy and contrast, not a grid of equal-weight cards.

**29 · The invented stat row** — three big numbers in a row: 10k+ developers,
99.9% uptime, 24/7 support, on a product that launched yesterday. Social proof
turned into a layout, filled whether or not the proof exists; the numbers are
set dressing (a round 10k+, two nines, a 24/7), not measurements. Real numbers
are odd and specific — and one invented figure poisons every true one beside it.
*Fix:* show a number only if you measured it, and say where it came from; one
real, checkable figure beats three round ones. No numbers yet? Say what the
product does.

**30 · The 01 / 02 / 03 section markers** — a giant faint ordinal beside every
marketing section (01 Collaborate, 02 Innovate, 03 Scale) as if they were steps
in a sequence. Numbering is a claim that these things happen in this order;
feature sections have no order, so the numerals are costume borrowed from
editorial design where an index means something. The cheapest way to look
structured without deciding on a structure.
*Fix:* number what's genuinely ordered — install steps, a changelog, a
catalogue — and delete the ornamental ordinals everywhere else.

**31 · Cards inside cards** — a bordered, rounded, shadowed card holding
another card holding another, every layer with its own surface and padding. A
card claims its content is one self-contained thing; nested three deep, nothing
is contained and the padding stacks until content is a sliver. The model boxes
because a box is the only grouping move it trusts — grouping by spacing and
alignment requires deciding what belongs together.
*Fix:* one surface per region; inside it, group with spacing, alignment, and
hairline dividers. A child earns its own surface only when it's genuinely a
separate object (a preview, an embed).

**32 · One gap everywhere** — `gap-4`, `p-4`, `space-y-4`: one spacing value
stamped across the page, so a heading sits exactly as far from its own body as
from the previous, unrelated section. Spacing is how a layout says what belongs
together — tight inside a group, generous between groups. One value everywhere
announces that nothing belongs to anything; proximity stops carrying
information, and the eye has to read every line to find the structure.
*Fix:* space by relationship, not by token: pull related lines close, push
unrelated groups apart. A small scale with real jumps (4/8/16/32/64), used
unevenly on purpose.

## Evolved slop

**33 · Inter everywhere** — Space Grotesk for display, Inter for body; or
Geist, Manrope, Plus Jakarta Sans. Every AI-built page draws from the same five
faces. They're good typefaces — that's the trap: the model reaches for them
because everyone did, and every product wearing them dissolves into the same
page. A typeface is the loudest single signal of who made this; outsourcing it
to the training-data average dodges the identity decision the way the indigo
gradient dodged the color one.
*Fix:* choose a face the way you'd choose a logo — try a few, set your own copy
in each, be able to say why this one. Landing back on Inter after that is a
choice; starting there isn't. (A system stack, picked for a reason, is a choice
too.)

**34 · The "tasteful terminal"** — mono everywhere, a near-black background, one
warm accent, ASCII art: the look of "an AI that read one Vercel blog post." It
isn't ugly, that's the trap; it's polished enough to have become the new
default, dodging the design decision exactly like the indigo gradient did, in
cooler clothing.
*Fix:* keep monospace for code, not UI chrome; use ASCII art and terminal
metaphors only where they serve the product. Real taste is a choice you can
explain, not this season's safest template.

**35 · The editorial dashboard** — an operational UI dressed as a magazine: a
giant serif "Good evening" greeting, serif numerals in the stat cards, cream
paper, a tracked-caps kicker over every block. The second-wave uniform:
scolded out of indigo gradients, the model's new shorthand for "taste" is
cream + display serif + one deep accent, stamped on any surface regardless of
its job. The greeting is lifted from a chat assistant's home screen, where the
greeting is the content; a dashboard's content is its numbers, and display
serifs with proportional oldstyle figures are prose type — the numerals you
can't scan down a column. A magazine is read once; a console is scanned all
day.
*Fix:* match the type to the job — a scanned interface takes a legible sans
with tabular lining numerals, hierarchy from scale and space. Display serif
belongs to genuinely editorial surfaces (docs, essays, a magazine). For
warmth, one material decision — a paper tint or an ink accent — not the full
costume.
