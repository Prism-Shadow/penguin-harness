# A hot push stores what it sends, so the next push sends only what changed

- Date: 2026-10-01
- Type: perf
- Scope: deploy

`scripts/deploy.mjs` now sends the parts the target lacks two ways. Parts up to 1 MiB, other than the platform and CLI bundles, are uploaded with `PUT /api/hmr/blobs/<sha>`, eight at a time, which stores them in the target's blob store. The two bundles and anything larger go inline in the gzip upgrade body as before. A refused upload falls back to inline. Runtimes in the field drop an inline part after using it, so every push used to send every web file again (about 49 MB raw); after the first push to a target, a push now sends only the files that changed.
