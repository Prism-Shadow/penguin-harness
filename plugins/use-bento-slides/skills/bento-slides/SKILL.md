---
name: bento-slides
description: "Create and edit Bento slide decks, whose document is JSON: in the Slides workbench, where the user edits the same deck while you work, or as a self-contained .bento.html file. Use whenever the user wants a slide deck or presentation, or a request names the Slides workbench or a deck file under workbenches/slides/.files/decks/."
version: 2026.11.17.1
---

# Bento slide decks

A Bento deck is a JSON document (`"format": "bento/slides"`). It lives in one of two places, and the place decides how you edit it:

- **A deck in the Slides workbench:** one file, `<deck-id>.bento.json`, that holds only the JSON. The user has it open in an editor and may change it while you work. See _Decks in the Slides workbench_.
- **A standalone `.bento.html` file** in a Workspace: the self-contained Bento app, with the JSON in one block inside it. See _Standalone .bento.html files_.

A request sent from the workbench names its deck file. A request that names a `.bento.html` file, or asks for a file in the Workspace, is about that file. Otherwise, when the Slides workbench is installed (its folder, below, exists), make the deck there and tell the user to open the **Slides** tab, or the **AI PPT** tile in the App Center; its **Export** button gives a `.bento.html` whenever they want one. Without the workbench, write a `.bento.html` file.

The document format, every element type and the copy-paste recipes are in `references/bento-agents.md`: the Bento project's own guide (https://bento.page/agents.md, guide version 1.2.13, MIT, © 2026 The Bento authors), shipped with this skill unmodified, so reading it needs no download. Its notes on installing Bento's own skill do not apply here.

## Before you start

If the user's message only invokes this skill (e.g. "use bento-slides skill") without a concrete request, ask what deck they want before doing anything: the topic, the source material to build it from, and whether to start from scratch or change an existing deck. Do not download anything or write a document until the goal is clear.

## Decks in the Slides workbench

The workbench shows the deck in Bento's editor and loads whatever you save within a second, so the user watches your work land: save small, finished steps.

### Where the decks are

```
<App Data Dir>/agents/<Agent ID>/agent_state/workbenches/slides/.files/decks/<deck-id>.bento.json
```

Build the path from the Environment section of your system prompt. A request sent from the workbench names the exact file; use that path as given. `<deck-id>` is lower-case letters, digits and hyphens.

- **One deck, one file,** holding the deck's document and nothing else: no HTML, no runtime, no `<` escaping.
- **To create a deck,** write a new `<deck-id>.bento.json` there (make the `decks/` directory if it is missing). It appears in the workbench's deck list at once.
- **Never write** `collab` into a deck (it would hold the keys to a live sharing room), and never change a deck's `docId`.
- Leave `history/`, beside `decks/`, alone: the workbench keeps there the versions one side replaced.

### One read-modify-write per step

The user may save the same file at any moment, and the workbench rewrites it in its own layout when they do. Text you read a few seconds ago may no longer match. So:

1. **Change the deck with a short script that loads the JSON, changes it and writes it back, in one run.** Do not carry text from an earlier read into a later edit, and do not edit by exact string replacement across turns.

   ```bash
   python3 - "$DECK" <<'PY'
   import json, sys
   path = sys.argv[1]
   doc = json.load(open(path, encoding="utf-8"))
   slide = next(s for s in doc["slides"] if s["id"] == "numbers")
   title = next(e for e in slide["elements"] if e["id"] == "headline")
   title["html"] = "Revenue by quarter"
   json.dump(doc, open(path, "w", encoding="utf-8"), ensure_ascii=False)
   PY
   ```

   `node -e` with `JSON.parse` / `JSON.stringify` works the same way. Any valid JSON layout is accepted.

2. **Write the whole file in one step.** A half-written file is shown to the user as "cannot be read right now" until the next write.
3. **One coherent step per write:** a slide added, a chart replaced, a colour scheme applied. The user sees each one land.
4. **Read only what you need.** Print the slide ids and titles first; open one slide's elements when you work on it. Skip `assets` (picture data, often megabytes): `doc.pop("assets", None)` when printing, and never rewrite a picture you did not change.

When the request names a slide ("slide 3 (id "numbers")") or selected elements, those are what "this slide", "this title" and "here" mean.

### Merging with the user's edits

The workbench replays the user's own edits on top of your version, element by element, by `id`.

- **Keep ids.** Changing an element keeps its `id`; a new element gets a new, descriptive `id` unique on its slide (`revenue-chart`, not `el7`). Renaming an id reads as "deleted one, added another" and drops what the user did to it.
- **Change only what the request asks for.** Do not reformat, renumber or re-space the rest of the deck: every property you touch is one the user's edit can collide with. On a collision the user's value is kept and yours goes to the deck's history.
- **Do not remove what the user added** unless asked.

Pictures and media in a workbench deck must be embedded (below): the editor there allows no network, so a remote URL does not load.

When you are done, answer in one or two sentences: what changed, on which slides. The user already sees the result.

## Standalone .bento.html files

A `.bento.html` file is the Bento app with the document inside it, as plain JSON in a single block:

```html
<script type="application/bento+json" id="bento-doc"> { "format":"bento/slides", ... } </script>
```

Edit **that block only**, in place. Escape every `<` in the JSON as `<` so it can never contain a literal `</script>`. Leave the rest of the file — the compressed runtime — untouched, and never regenerate the whole file. In a chat context the user copies the JSON out instead (_Save ▾ → Copy document JSON_) and pastes the replacement back (_Save ▾ → Replace from JSON…_); `window.bento.loadDoc(json)` does the same from the console.

### Starting from nothing

The user does not need Bento installed — the app ships inside every deck. When there is no `.bento.html` to edit, fetch the latest signed release and author into it:

```bash
# name the file after the deck's topic, e.g. Q4_Review.bento.html
curl -fsSL https://bento.page/releases/slides/Bento_Slides.bento.html -o "<Topic>.bento.html"
```

On Windows without curl: `iwr https://bento.page/releases/slides/Bento_Slides.bento.html -OutFile <Topic>.bento.html`.

Verify the download contains `id="bento-doc"`, then write the document into that block, replacing whatever it holds. When done, offer to open it (`open` / `xdg-open` / `start`): the file boots straight into the editor with the finished deck. Aim for one pass from request to opened deck.

## Making a good deck

1. **Read the deck first.** Note `doc.size` (canonical 1280×720), `doc.theme`, the existing element `id`s, and whether `doc.template` / `doc.readonly` are set.
2. **For a new deck,** start from the "Minimal valid document" skeleton in `references/bento-agents.md`. A deck needs `format: "bento/slides"`, `version: 1`, `size` and `theme` (including `theme.fontFamily`); the app will not boot without them. **Fully specify element fields** as the skeleton shows (`x, y, w, h, rotation, opacity`, and per type what the guide lists — shapes need `stroke` / `strokeWidth`, text needs `fontFamily` / `align` / `valign`): a missing field renders wrong or not at all. Omit `docId` and `collab`: the app mints a fresh identity on first open.
3. **Read the source material** the user gave you and classify each piece — a stat, a table, a process, a definition to expand, a photo.
4. **Map material to a feature; do not default to bullet text.** This is the step that makes it a Bento deck rather than a slideshow of paragraphs:
   - numbers to compare visually (trend, magnitude, share) — a **chart** element
   - a comparison, spec, pricing or feature grid — a **table** element (`columns` weights, `rows` of `cells`, a `style` object)
   - consecutive slides about the **same thing changing** — **morph**: give shared elements the same `id` on both slides and `transition:"morph"` on the later one (Bento's signature move; reach for it liberally)
   - a point to **drill into** — a **state slide** (`stateOf` plus an element `link`)
   - a **hero or full-slide image** — full-bleed image, scrim rect and text, with **ken-burns** drift
   - a **sequence, flow or timeline** — a line or `path` with a `dash-march` loop, or morph a highlight through the steps
   - a **headline number** — big text with `fx:{countUp:true}`
   - **every cover and divider** — at least one ambient motion
   - **repeated chrome or a logo** — keep its `id` stable across slides so it morphs in place
   - a **demo clip, recording or soundbite** — a **media** element (`kind: video|audio`); embed short clips as a data URI
5. **Author** with `references/bento-agents.md` open for the element shapes, the morph / chart / state / ken-burns recipes and the gotchas. Respect one accent colour, at most two typefaces, 96px side margins (right-most x ≤ 1184), and write **speaker notes** on every slide.
6. **Self-audit before finishing:**
   - [ ] any numbers rendered as text that should be a **chart**?
   - [ ] do consecutive slides on one subject share **ids and `transition:"morph"`**?
   - [ ] at least one **motion moment** (ken-burns, loop, count-up), especially on the cover?
   - [ ] a drill-down that would work better as a **state slide**?
   - [ ] one accent colour, at most two typefaces, 96px margins?
   - [ ] speaker notes on every slide?

You cannot run the Bento app's own `validate()` or `measure()` from here. After a structural change, re-read the document you wrote and check that it parses, that every slide and element has an `id`, and that text boxes are large enough for their text at their font size (a line of N characters at font size F needs about `0.55 * F * N` px of width).

## Critical gotchas

- **Charts:** bar and line series `data` must be **plain numbers** — `{value,…}` item objects coerce to 0, and only pie takes `{name,value}`. Colour by series, not per bar. `option` is pure JSON: template formatters only (`{b}` / `{c}` / `{d}`), never functions.
- **Morph needs deterministic, stable ids** shared across the slides that should animate together. Different ids mean no morph — the elements just cut.
- **Images and fonts must be embedded** as data URIs in `doc.assets` and referenced by `"asset:<key>"`, so the deck stays self-contained.
- **Media:** a `media` element (`kind: video|audio`) embeds short clips as a data URI in `src`; a standalone file may reference a URL for big files, a workbench deck may not. `autoplay` runs only in present mode and needs `muted:true` for video. Do not embed large videos — they bloat the deck.
- **Never regenerate `docId`** when editing an existing deck; it is the document's identity. Fresh decks omit it and the app mints one.
- `template:true` means every open mints a fresh deck; `readonly:true` means the file boots straight into the show with no editor.

Adapted from the Bento project's own skill, https://bento.page/skills/bento-slides/SKILL.md (MIT, © 2026 The Bento authors). "Bento" is that project's name; this plugin is not affiliated with or endorsed by it.
