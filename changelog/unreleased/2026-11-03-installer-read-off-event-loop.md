# Installing a machine reads the installer without parking the server

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `server`
- **Issue:** [#1435](https://github.com/Prism-Shadow/penguin-harness/issues/1435)

[中文版](2026-11-03-installer-read-off-event-loop.zh.md)

`installOnRemote` read the installer asset with `fs.readFileSync` inside the request path. The read of that asset — tens to hundreds of megabytes, possibly on a slow or network-mounted directory — now goes through `fs.promises.readFile`, so the server's event loop keeps answering other requests while an install is being prepared.

## Details

- The read keeps its existing failure shape: a missing or unreadable installer still ends the install at the `prepare the installer` step with the filesystem's own message.
- A regression test parks the read on a FIFO installer asset and checks that a timer still fires before the bytes are fed, then lets the install run on over its channel to the `installed` outcome.
