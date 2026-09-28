# Trim a narration on its waveform

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `web`

An uploaded or accepted narration can now be trimmed on its waveform, as in Loom's audio
editor. The author drags across a stretch, plays just that stretch, and removes it.

## Details

- The trimmed clip is written in the browser as a 16-bit PCM WAV at the source's own
  sample rate when that is a WAV. It is stored through the ordinary media upload and bound
  to the asset. **Validate and save media** saves the binding, as for any upload.
- A trimmed narration no longer claims the speech run it came from, since it is no longer
  that run's file. The original upload or run output is kept.
- A click on the waveform still seeks. Only a drag selects.

## Fixes

- The waveform drew the unplayed part of a clip in the canvas's own background colour, so
  it was invisible. It now shows.
