# A machine's JSON answers cross the link compressed, and unchanged ones as a 304

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#1396](https://github.com/Prism-Shadow/penguin-harness/pull/1396)

[中文版](2026-10-29-machine-answers-compressed.zh.md)

Every request the server forwards to a machine now asks for a compressed answer, and a read it forwarded before is asked again with the validator of the answer it kept, so an unchanged answer crosses the ssh link as a 304 of a few hundred bytes instead of its whole body. Opening a remote conversation brought the models list, the Agent's Skills and its config — about 140 KB of plain JSON — over that link every time.

## Details

- Every server compresses its JSON answers of 1 KiB and more under `/api/` and `/server/` for a caller that accepts it: brotli (quality 6) when accepted, gzip otherwise, nothing for a caller that asks for neither; `q=0` is a refusal.
- Every GET answer of 200 with a JSON body carries a weak `ETag` computed from its bytes (a route that sets its own keeps it), and a request whose `If-None-Match` names it is answered 304 with no body.
- The server forwards to a machine — the `/server/<machineId>` proxy and the Session-level forward — asking for `br, gzip` in its own name rather than passing on the caller's `Accept-Encoding`, `If-None-Match` or `If-Modified-Since`, and decodes the answer before relaying it. A machine that answers without an encoding is relayed as before.
- The server keeps, in memory, the last such answer of each read per machine, per user who asked and per path, and revalidates it on the next forward of the same read: a 304 is answered with the kept body, a new answer replaces it. Nothing is answered without asking the machine. Answers over 2 MiB are not kept, the least recently used go once the kept answers pass 16 MiB, a machine's answers go when it is taken out of a Project or uninstalled, and a hot push or a restart starts empty.
- A relayed answer no longer carries the machine's `Transfer-Encoding`.
