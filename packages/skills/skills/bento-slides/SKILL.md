---
name: bento-slides
description: Create and edit Bento presentations — self-contained .bento.html decks whose document is JSON. Use whenever the user wants a slide deck or presentation: from scratch, from source material, or by improving an existing file.
short_description: Author Bento slide decks.
short_description_zh: 制作 Bento 幻灯片。
version: 1
updated: 2026-07-22T00:00:00Z
---

# Authoring Bento decks

A Bento deck is one self-contained `.bento.html` file. The document is plain JSON in a single block:

```html
<script type="application/bento+json" id="bento-doc"> { "format":"bento/slides", ... } </script>
```

Edit **that block only**, in place. Escape every `<` in the JSON as `\u003c` so it can never contain a literal `</script>`. Leave the rest of the file — the compressed runtime — untouched. In a chat context the user copies the JSON out instead (*Save ▾ → Copy document JSON*) and pastes the replacement back (*Save ▾ → Replace from JSON…*); `window.bento.loadDoc(json)` does the same from the console.

Adapted from the Bento project's own skill, https://bento.page/skills/bento-slides/SKILL.md (MIT, © 2026 The Bento/Suite authors). The authoritative schema and recipe reference is https://bento.page/agents.md.

## Before you start

If the user's message only invokes this skill (e.g. "use bento-slides skill") without a concrete request, ask what deck they want before doing anything: the topic, the source material to build it from, and whether to start from scratch or edit an existing `.bento.html`. Do not download anything or write a document until the goal is clear.

## Starting from nothing

The user does not need Bento installed — the app ships inside every deck. When there is no `.bento.html` to edit, fetch the latest signed release and author into it:

```bash
# name the file after the deck's topic, e.g. Q4_Review.bento.html
curl -fsSL https://bento.page/releases/slides/Bento_Slides.bento.html -o "<Topic>.bento.html"
```

On Windows without curl: `iwr https://bento.page/releases/slides/Bento_Slides.bento.html -OutFile <Topic>.bento.html`.

Verify the download contains `id="bento-doc"`, then **replace** that block's JSON — it ships with a showcase deck, which is discarded. For a fresh document:

- **Fetch https://bento.page/agents.md before authoring** and start from its "Minimal valid document" skeleton. `size` and `theme` (including `theme.fontFamily`) are **required**; the app will not boot without them.
- **Fully specify element fields** as the skeleton shows — shapes need `stroke` / `strokeWidth`, text needs `fontFamily` / `align` / `valign`. Missing fields render wrong or not at all.
- **Omit `docId` and `collab` entirely.** The app mints a fresh identity and dormant collaboration credentials on first open.

When done, offer to open it (`open` / `xdg-open` / `start`): the file boots straight into the editor with the finished deck. Aim for one pass from request to opened deck.

## Workflow

1. **Find the document.** Locate the `#bento-doc` block and parse its JSON. Note `doc.size` (canonical 1280×720), `doc.theme`, existing element `id`s, and whether `doc.template` / `doc.readonly` are set.
2. **Read the source material** the user gave you and classify each piece — a stat, a table, a process, a definition to expand, a photo.
3. **Map material to a feature; do not default to bullet text.** This is the step that makes it a Bento deck rather than a slideshow of paragraphs:
   - numbers to compare visually (trend, magnitude, share) — a **chart** element
   - a comparison, spec, pricing or feature grid — a **table** element (`columns` weights, `rows` of `cells`, a `style` object)
   - consecutive slides about the **same thing changing** — **morph**: give shared elements the same `id` on both slides and `transition:"morph"` on the later one (Bento's signature move; reach for it liberally)
   - a point to **drill into** — a **state slide** (`stateOf` plus an element `link`)
   - a **hero or full-slide image** — full-bleed image, scrim rect and text, with **ken-burns** drift
   - a **sequence, flow or timeline** — a line or `path` with a `dash-march` loop, or morph a highlight through the steps
   - a **headline number** — big text with `fx:{countUp:true}`
   - **every cover and divider** — at least one ambient motion
   - **repeated chrome or a logo** — keep its `id` stable across slides so it morphs in place
   - a **demo clip, recording or soundbite** — a **media** element (`kind: video|audio`); embed short clips as a data URI, link big ones by URL to keep the file small
4. **Author** using the schema, keeping https://bento.page/agents.md open for the element shapes, the morph / chart / state / ken-burns snippets and the gotchas. Respect one accent colour, at most two typefaces, 96px side margins (right-most x ≤ 1184), and write **speaker notes** on every slide.
5. **Self-audit before finishing:**
   - [ ] any numbers rendered as text that should be a **chart**?
   - [ ] do consecutive slides on one subject share **ids and `transition:"morph"`**?
   - [ ] at least one **motion moment** (ken-burns, loop, count-up), especially on the cover?
   - [ ] a drill-down that would work better as a **state slide**?
   - [ ] one accent colour, at most two typefaces, 96px margins?
   - [ ] speaker notes on every slide?
6. **Write back** the edited `#bento-doc` block (escaping `<` as `\u003c`), or return the replacement JSON. Never regenerate the whole HTML file.

## Critical gotchas

- **Charts:** bar and line series `data` must be **plain numbers** — `{value,…}` item objects coerce to 0, and only pie takes `{name,value}`. Colour by series, not per bar. `option` is pure JSON: template formatters only (`{b}` / `{c}` / `{d}`), never functions.
- **Morph needs deterministic, stable ids** shared across the slides that should animate together. Different ids mean no morph — the elements just cut.
- **Images and fonts must be embedded** as data URIs in `doc.assets` and referenced by `"asset:<key>"`, so the file stays self-contained.
- **Media:** a `media` element (`kind: video|audio`) embeds short clips as a data URI in `src`, or references a URL for big files. `autoplay` runs only in present mode and needs `muted:true` for video. Do not embed large videos — they bloat the file.
- **Never regenerate `docId`** when editing an existing deck; it is the document's identity. Fresh decks omit it and the app mints one.
- `template:true` means every open mints a fresh deck; `readonly:true` means the file boots straight into the show with no editor.

Working examples of every technique: open any template at https://bento.page and read its `#bento-doc` block.
