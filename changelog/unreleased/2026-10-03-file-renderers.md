# A reply's link to an audio file plays below its paragraph

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`, `ui`, `server`, `plugins`

[中文版](2026-10-03-file-renderers.zh.md)

A plugin can declare how a kind of Workspace file is drawn, and the web app draws it below the reply paragraph that links such a file.

- The server's `WebModule` gains a `fileRenderers` slot: `{ extensions, renderer }`, extensions without the dot and compared case-insensitively. `GET /api/contributions` answers it as `fileRenderers`.
- In a conversation, when a paragraph or a list item of an assistant reply links a Workspace file whose extension a rule lists, the named renderer is drawn directly below that block: once per file, in link order. The Markdown is unchanged and the link keeps its click (it opens the file in the Files panel). Links inside code are not links. Renderers appear once a reply has settled, not while it streams. Safe mode skips the rules with every other contribution.
- The web app ships one builtin renderer, `audio`: a compact one-row player card on the Workspace file URL (`preload="none"`), drawn from theme tokens with the radius, line and surface of the transcript's other cards — a round accent play/pause button, the file name, elapsed / total time and a thin seek bar whose lighter share marks what has loaded and can be sought. Its width is capped and nothing shifts when the file's length arrives. The button and the seek bar are named after the file, and the bar takes the arrow keys and Home/End. When loading fails, the card becomes a line saying the file cannot be played. Renderers are named in a chat slot, `ChatModule.fileRenderers`; a rule whose renderer is an iframe is skipped.
- The UI package's Markdown renderer gains `ProseBlockTrailerProvider`: a surface may add content after a paragraph or a list item, chosen from the links inside it, on the settled render.
- Workspace files ending in `.mp3`, `.wav`, `.ogg` and `.m4a` are served with their audio content types instead of `application/octet-stream`.
- `plugins/example-music`: an example plugin contributing `mp3`/`wav`/`ogg`/`m4a` → `audio`, with a `send-music` Skill that teaches an Agent to synthesize a short tune into the Workspace and link it. The Skill is installed onto an Agent by hand (the plugin's README). It is private, so it is not published, and as a `plugins/example-*` directory it is not shipped either, unless `PENGUIN_PLUGIN_EXAMPLES=1` stages the examples beside the builtin plugins; a Project then enables it by its package name. The web e2e suite does both for its run.
