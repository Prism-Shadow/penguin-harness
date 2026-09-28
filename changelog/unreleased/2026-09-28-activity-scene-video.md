# Record a composed scene to a video and keep it (experimental)

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`

With the **Scene videos** experiment on, the Scene video block of a video or animation asset
gained a **Record video** button under a kept [composition](2026-09-28-activity-scene-composition.md).
Penguin played the composition once in its [test browser](2026-09-25-test-browser.md) and
recorded it with Playwright's page recorder to a WebM as long as the composition, with no FFmpeg
or other encoder. The recording then played beside the asset's current video under **Current
and new**, and **Use new** bound it to the asset; **Keep current** put it aside. While the
experiment was off, the studio showed nothing of it and the routes refused.

## Details

- Added `POST /api/projects/:projectId/activities/:activityId/render-video`
  `{compositionRunId, expectedRevision}`, which started a run of the new kind `video` with no
  Session and no agent, under the one-run-per-activity rule. It refused with 403
  `experiment_off` while the switch was off, checked first; 409 `draft_conflict` for a stale
  revision; 409 `video_composition_missing` when the named run was not a succeeded composition
  that kept its page; 409 `video_asset_changed` when its asset was no longer a video or
  animation of the media plan; 409 `test_browser_missing` without the test browser; and 409
  `generation_running` while another run was going. The App worded each code itself. The run
  recorded `video: {language, assetKey, compositionRunId, width, height, seconds}`.
- The recorder opened the composition on the server's loopback address through a signed
  composition link, in a context with `recordVideo` at the composition's canvas size and a
  viewport of the same size, waited for `window.__composition.ready`, sought the timeline to 0,
  played it, and waited the composition's length plus 0.5 s, at most 65 s. Closing the context
  finished the file. The recording opened with a short blank lead-in while the page loaded; it
  was not trimmed, and the studio said so beside the button. The browser launcher was a port
  (`VideoRenderPorts`), so tests drove a fake.
- Added `inspectWebm`, which kept a recording only when it began with the EBML header
  (`1A 45 DF A3`), named the document type `webm`, and was at most 100 MB. A recording that
  failed it failed the run with its cause and kept nothing. A kept recording was stored in the
  draft workspace as `videos/<runId>.webm`, and the run's candidate was `{runId, sha256, bytes}`.
- Added `GET .../runs/:runId/video`, which served a video run's recording, or one the draft
  bound, as `video/webm`, and `POST .../runs/:runId/accept-video` `{expectedRevision}`, which
  bound a succeeded recording made against the current draft to its asset.
- `MediaAsset` gained an optional `generatedVideo: {runId, sha256}`, allowed only on video and
  animation assets bound to `media/generated/<runId>.webm`. Saving a media plan by hand could not
  add or change one, and the WAF manifest left it out.
- The studio's player served a bound recording at its media path, and media stats measured it.
  Module assembly staged accepted recordings into the Session at their bound paths and checked
  their hashes when collecting. Saved versions kept a recording's bytes, and a ref made from a
  template kept the template's recordings.
- The asset editor played a bound recording in place of the "no preview" line, read its file
  details from it, and locked its path like other generated media. The run history and the
  sessions panel named the run **Scene video recording**.
