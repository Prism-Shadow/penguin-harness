# Storyboard for an activity's scenes

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `web`

The Scenes section now opens on a storyboard: every scene as a frame, in the
specification's order. The asset editor gained a strip to walk the activity scene by scene.

## Details

- Each frame shows the scene's first bound image, or its description when it has none, with
  its number and name. A frame is marked while an agent generates one of its assets, when a
  conversation's proposal would change one of them (a dashed outline), and when media is
  still missing. Every mark is also named in the frame's accessible name.
- Choosing a frame makes it the scene the conversation is about and shows a sheet with its
  description and media. A medium or **Open** takes the author to that asset.
- The board's header has **Edit media**, **Play** (opens the Player panel) and
  **Assemble** (runs the module stage).
- The asset editor shows the asset's scene with **Storyboard**, **Previous** and **Next**,
  stepping over scenes that ask for no media.
