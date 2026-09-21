# Waveform speech review and bulk narration generation

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `web`
- **PR:** [#31](https://github.com/Prism-Shadow/penguin-harness/pull/31)

Speech was reviewed through a bare audio element, one clip at a time, and narration could
only be generated one asset at a time. Clips now show their shape, and a language's
missing narration can be generated in one action.

## Waveform

Accepted speech and every speech candidate draw their waveform above the player. The
picture is computed from the decoded clip and drawn on a canvas, so no dependency was
added. Clicking it seeks; the arrow keys step through the clip; the native player
underneath still owns playback. Nothing is fetched until the waveform is asked for,
except for the one clip the author has open, and a clip whose waveform cannot be drawn
says so and keeps its player.

Audio bound to an uploaded file plays in the workbench too, rather than only generated
speech.

## Speech coverage

A panel under the scene tree lists the narration in the chosen language, each with the
scenes asking for it and whether it is bound, needs speech, needs a script, or has a
script beyond the 5000-character limit. Narration counts as covered once it has any
binding, however it got one.

One action generates every narration that can be generated now. It names the count and
asks for confirmation before starting that many agent runs. The server runs one
generation per activity at a time, so the narrations are queued and each is asked for
once the one before it finishes; the panel reports how many are left and can stop the
queue. A failure stops it rather than letting the rest fail the same way. The count on
the button and the work it starts come from one shared function, so they cannot
disagree. The queue is held by the page, so leaving the page stops it while the runs
already started carry on.
