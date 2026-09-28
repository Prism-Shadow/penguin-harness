# Zoom the behavior map and inspect its phases

- **Date:** 2026-09-24
- **Type:** feat
- **Scope:** `web`

The behavior map under the activity player can now be zoomed and read phase by phase:

- **Zoom out**, **Zoom in** and **Fit** beside the map scale the drawing from 50% to 300%
  of the panel's width, scrolling when it is larger. Ctrl (or Cmd) with the scroll wheel
  zooms too.
- Choosing a phase, by click or with Enter or Space, opens its inspector: whether it is
  the first or a final phase, the actions it runs on entry and on exit, the services it
  runs, the phases it is reached from and moves on to with their triggers, and where it
  leaves the scene. Neighbouring phases can be followed from there.

The map is now announced as a group of phases rather than an image, since its phases can
be chosen.
