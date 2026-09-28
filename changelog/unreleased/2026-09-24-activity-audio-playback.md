# Music and sound effects, with how the module plays them

- **Date:** 2026-09-24
- **Type:** feat
- **Scope:** `server`, `web`

An audio asset can now be narration, music or a sound effect, and a module learns how to
play it from the asset manifest.

## The contract with the module

It is Loom's contract unchanged, since WAF modules and the `waf-audio-patterns` skill that
assembly runs read already follow it. In `asset_manifest.json`, a music or sound-effect
entry carries four fields together:

- `kind`: `"music"` or `"sfx"`
- `channel`: the channel it plays on (`music` or `sfx` by default)
- `loop`: whether it repeats (music `true`, effects `false` by default)
- `volume`: from 0 to 1 (music 0.4, effects 1 by default)

Narration carries none of them. The manifest validator accepts the four only together, and
only on audio. Manifests saved before this change have none of them and stay valid; no
stored data changes.

## Authoring

- The asset editor has **Audio type** (Narration, Music, Sound effect) for audio. Music
  and effects add **Loop** and **Volume**. Speech-only controls (voice, Generate speech,
  Improve narration, Translate, the other languages' scripts) are hidden for them, since
  they are uploaded or taken from the library, not spoken.
- A track whose script in the specification is wrapped the way Loom's are, as in
  `<audio kind="music" loop="true" volume="0.3">…</audio>`, is planned as that kind, with
  the kind's defaults for anything not given.
- Speech coverage, "Translate and speak", the speech and translations stages, added
  languages, and the Build check's narration coverage all leave music and effects out.
- Loom imports carry each asset's kind, channel, loop and volume, filling in the kind's
  defaults where an older Loom manifest left one out.
