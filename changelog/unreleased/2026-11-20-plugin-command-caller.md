# Plugin commands can require their plugin enabled and run for a Session's driver; plugin settings need a person

- **Date:** 2026-11-20
- **Type:** feat
- **Scope:** `core`, `server`, `cli`

[中文版](2026-11-20-plugin-command-caller.zh.md)

- A plugin command can declare `requiresProjectListing`. It then runs only for a caller whose Project lists the plugin for this machine, and anyone else gets `403 plugin_not_enabled` before any of its code runs.
- A plugin command can declare `tokenCaller: "session-driver"`. A call made with the local API token, which every Agent's shell carries, then runs as the person who last started a run in the named Session rather than as the administrator the token stands for. A token call that names no Session gets `403 session_required`. A Session that records nobody, or whose driver can no longer open the Project, gets `403 driver_unknown`. Every other command treats the token as before.
- The Session index records that person (`driven_by`) whenever a signed-in person starts or steers a run, or the scheduler starts one for its creator, so the answer is the same after a restart. A subagent's Session takes its root's. Sessions from before this change record nobody until a person starts a run in them.
- Saving plugin settings and running their actions (`PUT /api/admin/plugin-config`, `POST /api/admin/plugin-config/action`) take a person's sign-in. The local API token can still read them, so an Agent can no longer loosen its own sandbox.
- Outside a Session, the CLI retries a `session_required` refusal once with the stored sign-in, as it already does for `human_required`.
