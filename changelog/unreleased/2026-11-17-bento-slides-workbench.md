# Bento Slides gains the AI PPT workbench

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `plugins`, `docs`
- **PR:** [#1585](https://github.com/Prism-Shadow/penguin-harness/pull/1585)

[中文版](2026-11-17-bento-slides-workbench.zh.md)

The built-in `use-bento-slides` plugin carries a Slides workbench (`slides`, the AI PPT workbench) beside its Skill: Bento's slide editor in a tab beside the Agent's chat, where the person edits a deck while the Agent edits the same deck, and both sides' edits are kept. The plugin is preinstalled, so a new Project's `default_agent` has a **Slides** tab and an **AI PPT** tile in the App Center; an existing Agent gets the workbench when it applies the plugin update the Agents page offers.

## Details

- A deck is one file, `.files/decks/<id>.bento.json` in the workbench's folder of files it shares with its Agent: the JSON a `.bento.html` file carries in its `#bento-doc` block, never `collab`, written by the page one slide header, element and asset per line. The page saves the person's edits with the revision they were made from; when the Agent has written the file since, the handler answers `409` with the file, and the page replays the person's unsaved edits on the Agent's version by slide and element id. Where both sides set the same property the person's value is kept and the page says so.
- The handler keeps the version one side replaced under `.files/history/<id>/`, the last twenty per deck. A **History** menu lists them and restores one as the person's own edit (saved like one, and undone with Bento's undo). The deck picker deletes a deck with a second click, taking its history and its conversation with it. When the open deck's file is removed, the page saves nothing more and offers to keep what is on screen as a new deck; after the event stream reconnects, it reads the open deck again.
- The rail beside the editor runs a request on the Agent in one Session per deck, naming the deck's file, the slide the person is on and the elements they selected, and shows the answer as it is written. The request tells the Agent to use the `bento-slides` Skill.
- The editor runs Bento 1.2.13, vendored unmodified as `ui/vendor/bento-slides-1.2.13.runtime.txt` (735,819 bytes, MIT), in a sandboxed frame with no origin of its own and a policy that allows no connection. **Export** writes a self-contained `.bento.html`; **Import** takes one, or a deck's `.json`. On a server without workbench files the tab says it needs a newer PenguinHarness.
- The `bento-slides` Skill (`2026.11.17.1`) merges in the workbench's own Skill: it covers decks in the workbench (where they are, one read-modify-write per step, keeping ids) and standalone `.bento.html` files, prefers the workbench when it is installed and the request names no file, and ships Bento's agent guide (`references/bento-agents.md`, guide 1.2.13, unmodified) instead of asking the Agent to download it.
- The plugin's card describes both parts in both languages and its quick start makes a deck in the workbench. The plugin gains `README.md`, `README.zh.md` and `THIRD-PARTY-NOTICES.md`, and tests for the merge and the handler. The built-in plugin tables and the Workbench plugins section of the Skills & Plugins docs page describe the workbench.
- Design: [penguin-harness-design#470](https://github.com/Prism-Shadow/penguin-harness-design/pull/470). Builds on workbench files, [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579).
- Start with a named blank deck or a three-slide project brief, present in the workbench, or download an editable PowerPoint (.pptx). The HTML source preserves Bento animations and can be imported for further editing.
