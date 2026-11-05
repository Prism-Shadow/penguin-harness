# Fix patterns

Before→after for each tell. These are *directions*, not find-and-replace rules —
adapt to the project's tokens and framework. Prefer changing a shared token or
component once over editing every call site.

General order of operations:
1. Fix the design tokens / theme first (colors, radius, fonts). Many hits
   disappear at once.
2. Then components, then one-off call sites.
3. Then copy.

---

### 01 Indigo→violet gradient
```diff
- class="bg-gradient-to-r from-indigo-500 to-purple-500 shadow-lg shadow-purple-500/50"
+ class="bg-[--accent]"      /* one solid, chosen accent */
```
If a gradient is truly wanted, make it subtle and directional (a single hue,
low contrast) and justify it. Drop the colored glow shadow.

### 02 Gradient headline text
```diff
- <h1 class="bg-gradient-to-r from-indigo-500 to-pink-500 bg-clip-text text-transparent">
+ <h1 class="text-[--ink]">          /* solid; go bigger/heavier for impact */
```

### 03 Warm "cozy" palette
Replace the amber/stone wash with a near-neutral base and keep one warm accent:
```diff
- bg-[#fdf6ec] text-amber-900 border-amber-200
+ bg-[--paper] text-[--ink] border-[--rule]   /* accent stays for one element */
```
Propose the neutral values; let the user confirm before applying globally.

### 04 Default semantic palette
Replace the framework rainbow with a coherent set derived from your palette:
neutrals plus at most one or two intentional semantic colours.
```diff
- <span class="bg-blue-50 text-blue-700">Info</span>
- <span class="bg-green-50 text-green-700">Success</span>
- <span class="bg-amber-50 text-amber-700">Warning</span>
- <span class="bg-red-50 text-red-700">Error</span>
+ <span class="chip">Info</span> <span class="chip">Warning</span>
+ <span class="chip chip--ok">Success</span>       /* one chosen green */
+ <span class="chip chip--danger">Error</span>     /* the brand accent */
```

### 05 One-hue status box
Carry the state in a word first; drop the border/text/tint all being one hue.
```diff
- <div class="border border-red-500 bg-red-500/10 text-red-500 rounded p-3">
-   Something went wrong.
- </div>
+ <div class="border border-[--rule] bg-[--surface] text-[--ink] rounded p-3">
+   <b>Error</b> — something went wrong.   /* one muted accent, on a neutral surface */
+ </div>
```

### 06 Gradients as atmosphere
Hold one flat background; build surface depth with a hairline, not a gradient.
```diff
- <body class="bg-[radial-gradient(circle_at_top,#1e293b,#020617)]">
-   <div class="rounded-2xl bg-gradient-to-b from-white/10 to-white/0 …">
-   <div class="rounded-2xl bg-gradient-to-br from-emerald-400/15 to-transparent …">
+ <body class="bg-[--bg]">                 /* one flat colour, held */
+   <div class="rounded-[--radius] bg-[--card] border border-[--rule]">
+   <div class="rounded-[--radius] bg-[--card] border border-[--rule]">
```
If a glow must exist, let it point at one element instead of filling the void.

### 07 Serif-italic on one word
```diff
- The editor that <em class="font-serif italic text-indigo-600">actually</em> ships.
+ The editor that <b>ships</b>.        /* emphasise by weight/position, one voice */
```

### 08 Serif where sans belongs
Swap the display serif for the project's UI sans in the font tokens; keep serif
only if the product's voice is genuinely editorial (and then use a *text* serif).
```diff
- font-family: "Playfair Display", serif;
+ font-family: var(--font-sans);
```
For the oversized italic-serif hero: set it roman, or move to a non-serif
display face — the italic-serif hero is the AI-startup landing page uniform.

### 09 Decorative strikes & highlights
Remove the strike/underline/highlight used for emphasis; let structure carry it.
```diff
- <h1>The <s>old</s> <mark>new</mark> way to <u>ship</u>.</h1>
+ <h1>A faster way to ship.</h1>
```
Keep strike-through for a real edit, underline for a link, highlight for a real
annotation — each only when it does that job.

### 10 The kicker above every heading
Delete kickers that restate their heading; keep one only where it adds a real
dimension (a category, a date, a genuine sequence number).
```diff
- <p class="text-xs uppercase tracking-widest text-indigo-500">Features</p>
- <h2>What it does</h2>
+ <h2>What it does</h2>       /* scale and space introduce the section */
```

### 11 Full-sentence display headline
Compress the point into a few words at display size; move the rest to a
normal-size subline.
```diff
- <h1 class="text-7xl font-extrabold tracking-tight">
-   We help modern teams resolve incidents faster than ever before
- </h1>
+ <h1 class="text-5xl font-semibold">Pages the right engineer</h1>
+ <p class="text-lg text-[--ink-2]">It maps alerts to code owners and routes
+ each incident to whoever shipped the change.</p>
```
After shortening, re-check any `max-width` that was sized for the old headline —
a stale narrow measure (say `20ch`) will re-wrap your few words onto two lines
and undo the fix. Verify the rendered result, not just the copy.

### 12 Flat type hierarchy
Give the scale real steps; let the most important thing be unmistakably bigger.
```diff
- <p class="text-[15px] font-semibold">Usage this month</p>
- <p class="text-sm text-gray-500">API calls: 48,210 (+12% vs May)</p>
+ <p class="text-xs text-[--ink-2]">API calls this month</p>
+ <p class="text-4xl font-semibold tabular-nums">48,210</p>
+ <p class="text-xs text-[--ink-3]">+12% vs May</p>
```
Merge sizes that are within a pixel or two; aim for ≥1.25× between steps.

### 13 Highlighted keywords
```diff
- Our <span class="text-indigo-600 font-semibold">revolutionary</span> platform helps
- <span class="text-pink-600 font-semibold">ambitious</span> teams move faster.
+ A project tracker for engineering teams. It updates issues from your commits.
```
Let structure carry emphasis; at most one accented phrase.

### 14 AI copywriting voice
Rewrite for specifics. Delete triads, em-dash drama, and "X theater" framing.
```diff
- It's not just an editor — it's a movement. Say goodbye to friction.
+ A code editor. Opens in under a second, ~half the memory of Electron editors.
- We killed the standup theater.
+ It replaces the daily standup with a three-line summary of yesterday's PRs.
```

### 15 Emoji everywhere
Remove emoji from headings, buttons, and bullets; keep one only where it carries
real information (a status).
```diff
- <h2>🚀 Why you'll love it</h2>
+ <h2>Why teams pick it</h2>
```

### 16 Glowing status dot
Drop the halo, the pulse, and the glow shadow; a flat dot plus a word is enough.
```diff
- <span class="relative flex h-3 w-3">
-   <span class="animate-ping absolute h-full w-full rounded-full bg-green-400 opacity-75"></span>
-   <span class="relative rounded-full h-3 w-3 bg-green-500 shadow-lg shadow-green-500/50"></span>
- </span> Ready
+ <span class="inline-block h-2 w-2 rounded-full bg-[--ok]"></span> Ready
```

### 17 Rounded card, colored left border
Collapse stacked callouts to body text; keep at most one real aside.
```diff
- <div class="border-l-4 border-indigo-500 rounded-lg bg-indigo-50 p-4">Note …</div>
- <div class="border-l-4 border-amber-500 rounded-lg bg-amber-50 p-4">Tip …</div>
+ <p>… the note, inline as normal prose …</p>
+ <aside class="note">Beta: exports may change format before 1.0.</aside>
```

### 18 Rounded-square icon tiles
Drop decorative tiles; use a labelled list with real specifics.
```diff
- <div class="rounded-xl bg-indigo-100 p-2"><Icon/></div><h3>Fast</h3><p>Very fast.</p>
+ <li><b>Fast</b> — cold start in 180 ms, measured on a 2020 laptop.</li>
```

### 19 Max radius + glassmorphism
Pick one small radius token; replace blur panes with solid surfaces.
```diff
- class="rounded-full backdrop-blur bg-white/10 border border-white/20"
+ class="rounded-[--radius] bg-[--card] border border-[--rule]"
```

### 20 Oversized drop shadow
Shrink the shadow to a real elevation: tight blur, small offset, low opacity,
never bigger than the element. Often a hairline replaces it outright.
```diff
- box-shadow: 0 16px 80px 10px rgba(0,0,0,0.36);   /* a room-sized fog */
+ border: 1px solid var(--rule);
+ box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 4px 10px -6px rgba(0,0,0,0.1);
```
Keep it colorless; a tinted glow is not depth. (See tell 01 for the purple
glow-shadow, tell 16 for the status-dot halo.) Ghost-card variant: if a card
has both a hairline border and a wide soft shadow, keep one — usually the
hairline.

### 21 Corners that don't nest
Compute the inner radius from the outer minus the padding, or don't round the
inner element at all.
```diff
- <div class="rounded-2xl p-3"><div class="rounded-2xl">…</div></div>   /* both 16px */
+ <div class="rounded-2xl p-3"><div class="rounded-lg">…</div></div>   /* 16 − 12 ≈ 8 */
```

### 22 Border that dies at the corner
Put the radius and the border on the same box; never let a clip eat a stroke.
```diff
- <div class="rounded-xl overflow-hidden">      /* wrapper owns the radius… */
-   <table class="border divide-y">…</table>    /* …child owns the stroke — erased at every corner */
- </div>
+ <div class="rounded-xl overflow-hidden border border-[--rule]">  /* same box: the stroke wraps the arc */
+   <table class="divide-y">…</table>
+ </div>
```
Or keep the hairlines as dividers: run them straight, edge to edge, and drop
the radius from the fill — square-cornered regions need no arc.

### 23 Badge & pill spam
Delete decorative pills; keep at most a real status tag.
```diff
- <h1>Dashboard</h1><Pill>✨ New</Pill><Pill>🔥 Popular</Pill><Pill>β Beta</Pill>
+ <h1>Dashboard</h1><span class="ver">v2.1</span>
```

### 24 AI-drawn SVG icons
Get a real, high-quality icon: commission a designer, or generate one with the
best image model and refine it until it's crisp and on-brand.
```diff
- <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/><circle cx="18" cy="20" r="2"/>…</svg>
+ <img src="/icon.svg" alt="" />        /* a real icon: a designer, or a strong image model, refined */
```
Don't ship the crude blob the model sketched, and don't fall back to a bare
letter; a crude generated icon is worse than no picture at all.

### 25 Icon in a tint of itself
Let the icon inherit the text color with no container; if it truly needs one,
give it a deliberate opaque surface.
```diff
- <div class="rounded-lg bg-blue-500/10 p-2"><Icon class="text-blue-500"/></div>
+ <Icon class="text-[--ink]"/>          /* just an icon; no tinted tile */
```

### 26 The springy hover
Transition only the properties that carry the state change, at 120–200ms with a
standard ease; hover feedback is a surface shift, not growth.
```diff
- class="transition-all duration-500 hover:scale-105 hover:-translate-y-2 hover:shadow-2xl"
+ class="transition-colors duration-150 hover:bg-[--surface-2] hover:border-[--rule-strong]"
```
Never animate layout properties (width/height/margin/padding); save spring
easing for things that genuinely move through space.

### 27 The wobbling spinner
Give the rotation a fixed centre; never put centering and spinning in the same
`transform` — a keyframe replaces the whole property.
```diff
- .spinner { position: absolute; top: 50%; left: 50%;
-   transform: translate(-50%, -50%); animation: spin 1s linear infinite; }
- @keyframes spin { to { transform: rotate(360deg); } }  /* clobbers the translate */
+ .spinner-box { position: absolute; inset: 0; display: grid; place-items: center; }
+ .spinner { animation: spin 1s linear infinite; }       /* rotates in place */
```
Centre the artwork too: the SVG arc centred on its viewBox, `transform-origin`
left at center (or use the standalone `rotate` property, which composes with
`translate` instead of replacing it). Then watch one full revolution before
moving on.

### 28 The all-caps card grid
Replace the grid of equal-weight cards with the single most important point,
told fully; drop the ALL-CAPS micro-labels.
```diff
- <div class="grid grid-cols-3 gap-8"> …6 icon+CAPS-label+one-liner cards… </div>
+ <p class="lead">It replaces your standups.</p>
+ <p>Every morning it reads yesterday's commits and PRs and writes the team a
+ three-line summary.</p>
```

### 29 The invented stat row
Keep only measured, sourced numbers; delete the set dressing.
```diff
- <div class="stats"><b>10k+</b> Developers <b>99.9%</b> Uptime <b>24/7</b> Support</div>
+ <p><b>1,847</b> CI runs yesterday, median 3m 12s — from the public status page.</p>
```
One real, checkable figure beats three round ones. No numbers yet? Say what the
product does instead.

### 30 The 01 / 02 / 03 section markers
Delete ornamental ordinals on unordered sections; number only real sequences.
```diff
- <span class="text-8xl font-extrabold text-gray-100">01</span><h2>Collaborate</h2>
- <span class="text-8xl font-extrabold text-gray-100">02</span><h2>Innovate</h2>
+ <h2>Collaborate</h2>            /* sections distinguished by scale and space */
```
Install steps, changelogs, and catalogues have earned their numbers; keep those.

### 31 Cards inside cards
One surface per region; group inside it with spacing and hairlines.
```diff
- <div class="card"><div class="card"><div class="card">Pro — $8/mo</div></div></div>
+ <div class="card">
+   <h3>Billing</h3>
+   <div class="row">Plan <b>Pro — $8/mo</b></div>    /* rows split by hairlines */
+   <div class="row">Renews <b>May 3</b></div>
+ </div>
```
A child keeps its own surface only when it's genuinely a separate object (a
preview, an embed).

### 32 One gap everywhere
Space by relationship: pull a heading toward its own rows, push groups apart.
```diff
- <div class="space-y-4">
-   <h3>Profile</h3><p>Name</p><p>Email</p>
-   <h3>Danger zone</h3><p>Delete workspace</p>
- </div>
+ <section class="mb-8">
+   <h3 class="mb-1.5">Profile</h3><p>Name</p><p>Email</p>
+ </section>
+ <section>
+   <h3 class="mb-1.5">Danger zone</h3><p>Delete workspace</p>
+ </section>
```
Use a small scale with real jumps (4/8/16/32/64), unevenly on purpose.

### 33 Inter everywhere
Choose a face like you'd choose a logo: try a few, set your own copy in each,
and be able to say why this one.
```diff
- font-family: "Space Grotesk", sans-serif;   /* display */
- font-family: "Inter", sans-serif;           /* body — the stock pairing */
+ font-family: var(--font-sans);   /* one face, compared and chosen — with the
+                                     reason recorded in the tokens file */
```
Landing back on Inter after comparing is a choice; starting there isn't. A
system stack picked for a reason is a choice too. Propose candidates; let the
user pick — never swap a brand font silently.

### 34 The tasteful terminal
Move monospace back to code; use terminal metaphors only where they serve the
product.
```diff
- <body class="font-mono bg-[#0a0a0a] text-amber-400">
-   <pre>  ╔══════════════╗
-          ║  WELCOME  ║
-          ╚══════════════╝</pre>
+ <body class="font-sans bg-[--bg] text-[--ink]">
+   <h1>Welcome</h1>          /* mono stays in <code>/<pre> for actual code */
```

### 35 The editorial dashboard
Type follows the job: sans + tabular lining numerals for scanned surfaces;
serif display only where the surface is genuinely editorial.
```diff
- <h1 class="font-serif text-5xl text-emerald-950">Good evening, Mara.</h1>
- <p class="italic font-serif text-emerald-800/70">The quiet rhythm of your services.</p>
- <div class="stat font-serif text-4xl">3</div>
+ <header class="flex items-baseline justify-between">
+   <h1 class="text-sm font-semibold">On-call — payments</h1><time>22:41 UTC</time>
+ </header>
+ <div class="stat text-3xl font-bold tabular-nums">3</div>
```
