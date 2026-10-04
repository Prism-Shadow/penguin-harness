# Example: an Agent that sends music

The smallest plugin that teaches the PenguinHarness web app to draw a kind of Workspace file, plus
a Skill that teaches the Agent to produce one. It demonstrates:

- **A file renderer as data.** The plugin's one module contributes to the server's
  `WebModule.fileRenderers` slot: files ending in `mp3`, `wav`, `ogg` or `m4a` take the web app's
  builtin `audio` renderer. The web app reads it from `GET /api/contributions`; no browser code is
  loaded into the app.
- **The Markdown is not touched.** When a paragraph of a reply links such a file in the
  Workspace — `[Evening Theme](music/tune.wav)` — the link stays a link (clicking it opens the file
  in the Files panel) and a player appears directly below that paragraph, once per file. A link
  inside a code span or block is not a link and gets nothing; a reply that is still streaming
  gets its players when it settles.
- **A Skill.** `skills/send-music/SKILL.md` teaches the Agent to synthesize a short tune to WAV with
  Python's standard library (or convert it with `ffmpeg` when one is present) and to link it in the
  reply by its Workspace-relative path.

The package is private, so it is not published, and it is not shipped with the builtin plugins
(`scripts/build-plugins.mjs` skips the `plugins/example-*` directories), so no install enables it.

## Enable the player

A plugin is loaded by its package name only, from the bundled plugin directory a build stages.
Stage the examples into it with the builtin plugins, then list the package in a Project's
`.project_config.toml` and restart the server:

```sh
PENGUIN_PLUGIN_EXAMPLES=1 node scripts/build-plugins.mjs --out packages/server/plugins
```

```toml
[plugins]
"@penguinharness/example-music" = "*"
```

What a Project lists is loaded for the whole server. Reload the web app after enabling it: the app
reads contributions once per sign-in. The web e2e suite enables it this way
(`packages/web/e2e/run.sh`).

## Install the Skill (a separate, manual step)

Enabling the plugin does not give any Agent the Skill: a code plugin has no slot to contribute a
Skill through, and Skills reach an Agent only by being installed onto it. Install it on each Agent
that should send music, either way:

- **Upload.** Zip the skill directory so the archive holds a single top-level `send-music/`
  (`cd skills && zip -r send-music.zip send-music`), then install the zip from the Agent's
  Skills settings.
- **Copy.** Copy `skills/send-music/` into the Agent's `agent_state/skills/` directory.

Then ask the Agent for a tune.
