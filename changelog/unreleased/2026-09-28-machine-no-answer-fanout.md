# A machine that does not answer is asked once, not about every Agent on every reload

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `web`
- **PR:** [#863](https://github.com/Prism-Shadow/penguin-harness/pull/863)

[中文版](2026-09-28-machine-no-answer-fanout.zh.md)

When the relay to a machine was down, the Sessions list asked that machine about each of its Agents on every reload. Each call waited out the socket's 20 s answer timeout and was then repeated as a fetch to the same machine. With 22 Agents and a few reloads, those fetches exhausted the browser (`net::ERR_INSUFFICIENT_RESOURCES`), avatars included. Now such a machine holds no browser connection, and at most one question to it is outstanding at a time.

## Details

- A read to a machine (`/server/<id>/…`) that goes unanswered while the page's socket keeps carrying frames is not repeated over HTTP. Both transports enter the same hub route and the same forward to that machine, so the HTTP copy could not do better. It fails with `machine_no_answer`. Reads to this server, and reads made while the socket itself went quiet, still fall back to HTTP as before.
- A machine that answers none of a reload's questions rests: the list shows its cached rows, and after 2 s one question probes it. Each failed probe doubles the rest, up to 30 s. The first answer brings back the full round, and the console says which machine is resting and for how long.
