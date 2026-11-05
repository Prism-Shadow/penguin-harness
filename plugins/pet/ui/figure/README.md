# The pet widget's figure — provenance and license

Everything under this directory is vendored from the Coopanion desktop pet
(`packages/cortico-world-desktop-pet`, commit-time copy in the harness repo's
`dev/pet/ref/coopanion`), unmodified:

- `whale/` — the DeepSeek whale figure pack (大肥鱼): `figure.json` (manifest, api 2),
  `model.json` (parts, pivots, grids), `figure.js` (the rig driver: springs, face texture,
  WebGL drawing), `tex/` + `feat/` (the original DeepSeek scheme's textures), `schemes/`
  (the other vendors' recolours), `outfits/` (cape, crew), `thumbs/`.
- `kit/` — the body kit (`body.js`: the live pet simulation — walking, roaming, sitting,
  sleeping, dragging, throwing, touching, faces — and `createBody`) and the renderer
  (`rig.js`: a small Live2D-style WebGL2 grid-deform sprite engine, WebGL1 fallback).

The kit simulates the body and the figure draws it; the widget document (`../widget.js`) is
only the host: a stage (bounds, pointer events), the speech bubble, and the pet's server
state. The figure's `createWhaleBody(base, opts)` contract (`figure.json`'s `entry` /
`export`) is kept exactly as Coopanion's figure frame calls it.

The textures were generated for Coopanion (character design 溟月 by 上善无形; the DeepSeek
maid secondary creation by ZipZipPipe; the schemes' apron logos carry DeepSeek's, OpenAI's,
Anthropic's, Google's, Alibaba Cloud's, Moonshot's and MiniMax's trademark graphics). See
the pack's own README (`whale/` in Coopanion) for the full art pipeline.

The pet plugin therefore ships under **AGPL-3.0-or-later** (the kit's and the pack's
license), not the harness's Apache-2.0; the record lives in the repository's
`THIRD-PARTY-NOTICES.md`.
