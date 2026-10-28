# Docs, the Agent API tutorial and the penguin-sdk skill match 0.2.17

- **Date:** 2026-10-26
- **Type:** process
- **Scope:** `docs`, `landing`, `skills`, `tooling`
- **PR:** [#1323](https://github.com/Prism-Shadow/penguin-harness/pull/1323)

[中文版](2026-10-26-docs-corrections-0-2-17.zh.md)

- **Reverse proxies.** Configuration Reference, Docker and Security Model say that behind a proxy that terminates TLS the server needs `PENGUIN_TRUST_PROXY=1`, and the proxy must keep the external `Host` and overwrite `x-forwarded-proto` with `https`; otherwise every write the Web App makes is refused with `403` `cross_origin_write`. Security Model names the origin check as a third layer against cross-site request forgery, the `415` for a write with a body and no `Content-Type`, and the two writes exempt from the origin check. The commented `PENGUIN_TRUST_PROXY` line in `docker/compose.yaml` says the same.
- **Session cookie name.** Server API gives a browser's session cookie as `penguin_session_<port>`, and says when the plain `penguin_session` applies.
- **Agent API tutorial.** "Connect agents to any external app through one unified API" shows the 0.2.17 stream (records from `session_meta` to `task_end`, between `ping` and `[DONE]`), takes the Session id from `session_meta`, reads records in `ask.mjs`, and uses the release's Try it screenshot. It requires 0.2.17 and names the API tab's current **Approval mode** and **Run settings** › **Maximum concurrent runs**.
- **penguin-sdk skill.** A failed `request_end` carries its detail on `error_message` and its cause on `error_code` (such as `auth`), not on `message`. Skill version `2026.10.25.1`.
