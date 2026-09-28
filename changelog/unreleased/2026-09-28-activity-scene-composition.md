# Compose an animated scene from its storyboard (experimental)

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`

Added a **Scene videos** experiment, off by default. With it turned on, a video or animation
asset in the asset editor gained a **Scene video** block, marked **Experimental**, with a
**Compose from storyboard** button that asked an agent to write a short animated page for the
asset's scene from the scene's description and bound images. The block let the author watch
the page with **Play**, **Pause** and **Restart**, read its frame list, and compose it again.
Nothing was recorded or bound to the asset. While the experiment was off, the studio showed
nothing of it.

## Details

- Added the server setting `activityVideoExperiment` (key `activityVideoExperiment` in
  `server_settings`; a missing key reads as off). `GET`/`PUT /api/admin/settings` gained it, and
  the General page of System settings gained a **Scene videos** row, marked Experimental, that
  only admins saw. Added `GET /api/projects/:projectId/activities/video-setup`, which answered
  `{enabled}`.
- Added `POST /api/projects/:projectId/activities/:activityId/compose-video`
  `{agentId | codingAgentId, expectedRevision, language, assetKey, wafRoot?}`, which started a
  run of the new kind `composition`. It refused with 403 `experiment_off` while the switch was
  off, checked before anything about the draft; 422 `composition_asset_invalid` for an asset
  that was not a video or animation or that no scene used; 409 `media_stale` for a stale media
  plan; 409 `composition_no_images` for a scene with no bound image; and 409
  `composition_image_too_large` for a scene image over 8 MB. Every bound image of the scene was
  read before the run was recorded, from the author's chosen checkout when one was given, so an
  unreadable image refused the run instead of being left out. The App worded each of these
  codes itself.
- The run staged `composition-input.json` (scene and asset descriptions, the canvas from the
  specification's `runtime.resolution`, default 640 × 480, 3 s per frame, 6–60 s in all, and
  the images), the scene's images under `images/`, `gsap.min.js` from the new `gsap` server
  dependency (GSAP 3.15, standard no-charge licence, vendored and never loaded from a CDN),
  Penguin's `penguin-composition.js` bridge, and `composition-template.html`. The template
  carried the content policy `default-src 'self' 'unsafe-inline'`, a fixed-size `#stage` and
  the `window.__composition = {duration, ready, timeline}` contract. The bridge stamped
  `data-duration` on the stage once the page loaded, resolved `ready`, and played, paused and
  restarted the timeline on the studio's messages. The prompt was added as `compositionPrompt`.
- Collection read `composition.html` (512 KB at most) and `frames.json`
  (`{frames: [{id, description, seconds}]}`, 1–20 frames, 6–60 s in all) and failed the run with
  a code the studio worded: `composition_network` (an `http(s)://`, `ws(s)://` or
  protocol-relative address, or `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `sendBeacon`), `composition_reference` (a file that was not staged, including `data:` URLs),
  `composition_template` (the policy meta tag, the bridge script or `#stage` dropped),
  `composition_random`, `composition_timeline` (no `gsap.timeline(...)` assigned to
  `window.__composition.timeline`), `composition_size` and `composition_frames`. The code was
  recorded on the run as `composition.problem`. A kept composition's candidate was its frames,
  total length, and the page's SHA-256 and size.
- Added `GET .../runs/:runId/composition-link`, which signed a one-hour link bound to the run
  and the host and redirected to `/preview/composition/:token/composition.html` on the preview
  origin. When no separate preview origin was configured, the link pointed at the App's own
  host and the page was served with a sandbox that kept it off the App's origin. The route
  served only the page, the staged images, and the two scripts from Penguin's own copies; it
  served the page and images only while their bytes matched what was checked and staged,
  answered everything else with 404, and stopped serving when the experiment was turned off.
  The studio showed the page in an `<iframe sandbox="allow-scripts">`, talked to it only by
  message, and said the composition could not be shown when the page never reported in.
- A scene whose specification listed learner choices (`choices`, `options`, `answers`,
  `interactions` or `interaction`) got an advisory line in the Scene video block; Compose
  stayed available.
- The run history and the sessions panel named the run **Scene composition**.
