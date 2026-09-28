# A hot-update push can be larger than a gigabyte

- **Date:** 2026-09-27
- **Type:** fix
- **Scope:** `hmr`, `server`
- **PR:** [#801](https://github.com/Prism-Shadow/penguin-harness/pull/801)

[中文版](2026-09-27-hot-update-pushes-past-a-gigabyte.zh.md)

A push is no longer held in memory while it is received. `POST /api/hmr/upgrade` used to inflate
its whole body, turn it into one string and `JSON.parse` it, so a push could never pass V8's
~512MB string ceiling and cost as much memory as it weighed before it got there. The body is now
read as a stream and every part lands in the blob store as it arrives.

## Details

- The upgrade body is inflated and read a chunk at a time; each inline content value — a bundle,
  a web file, an asset — is decoded as it is read and written straight into the blob store, and
  the push goes on naming it by `{ sha }`. The body format is unchanged: inline and `{ sha }`
  values are both accepted, so every existing pusher keeps working.
- `PUT /api/hmr/blobs/<sha256>` streams its body to disk and hashes it on the way; content that
  does not hash to its name is discarded instead of stored.
- Assets are copied from the blob store as files, never read into memory.
- Blobs a request is still writing or naming are kept by a concurrent push's store sweep, and
  every upload writes its own temp file under `hmr/store/incoming/`.
- `/api/hmr` is outside the request body cap derived from the attachment budget, in both the
  shell and the platform: the channel no longer buffers what it receives.
- Handing this server's build to a machine is content-addressed: it asks which parts the machine
  lacks, streams only those from their files, then sends a push that names every part by hash. A
  machine whose server has no probe gets the whole build inline, as before.
- Still bounded: disk space, the platform and cli bundles (each is module source, so one string),
  and the web dist, which is served from memory and stored as one artifact.
