# Activity media lives in the media repository, and deploys commit authored work

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `server`, `web`, `activities`

Generated and uploaded media now live in the WAF media repository, in Loom's layout, instead of under `~/.penguin`:

```
media/loom/<pc>/<pc>-<ref>/
  images/<english|spanish|romanian>/<key>.png     accepted media, each with Loom's sidecar <key>.json
  audios/<language>/<key>.mp3
  videos/<language>/<key>.webm
  uploads/<name>-<digest>.<ext>                   files an author uploaded
  candidates/<runId>.<ext>                         takes not accepted yet; never published
```

- **Takes are written straight into the media repository**, as candidates. Accepting one copies it to the asset's own path, replacing what was there, writes the sidecar and removes the candidate. The manifest binds `media/loom/<pc>/<pc>-<ref>/<folder>/<language>/<key>.<ext>` instead of `media/generated/<runId>.<ext>`, and validation requires that path for generated media.
- **Audio is kept as MP3**, as Loom kept it. Gemini speech (WAV) is converted with ffmpeg when the take is stored, and a server without ffmpeg refuses with 503 `ffmpeg_missing`.
- **Uploads are addressed per ref**, as `media/loom/<pc>/<pc>-<ref>/uploads/...`.
- **Media moves with the ref.** Renumbering a ref moves its media folder and re-addresses the manifest. A ref made from a template gets a copy of the template's media folder, without its candidates. A version saved under another number is restored into the current ref's folder.
- **Occupied addresses are refused.** Creating a ref whose media folder already exists is refused with 409 `activity_exists`. In the managed workspace, a product's media folder is checked out, with its LFS files, when its first ref is made.
- **Versions** keep the generated and uploaded files at their media-repository paths. Their blobs stay under `~/.penguin`.

Deploys no longer discard the working tree of the module and media clones, where activities are now authored:

- **`verify_module`** sets aside uncommitted work and fast-forwards `main` to origin; a `main` that has diverged fails, with git's reason. It then puts the work back, copies the newest assembled module over it, and commits it all on `main` ("Penguin Harness: <pc> as authored") before the checks run. `prepare_deploy` still branches from `main`.
- **`verify_media_assets`** does the same around the media clone's authored files, then commits and pushes only the files the activity data names that are new or changed. Candidates and other uncommitted files stay where they are.
- **Readiness** no longer reports uncommitted or unpushed work in the module and media clones. The activity-data clone must still be clean.
