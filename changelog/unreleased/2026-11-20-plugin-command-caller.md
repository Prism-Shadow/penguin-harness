# Plugin commands can require their plugin enabled and run for the person whose run is in progress; plugin settings need a person

- **Date:** 2026-11-20
- **Type:** feat
- **Scope:** `core`, `server`
- **PR:** [#1665](https://github.com/Prism-Shadow/penguin-harness/pull/1665)

[中文版](2026-11-20-plugin-command-caller.zh.md)

- A plugin command can declare `requiresProjectListing`. It then runs only for a caller whose Project lists the plugin for this machine, and anyone else gets `403 plugin_not_enabled` before any of its code runs.
- A plugin command can declare `tokenCaller: "session-driver"`. A call made with the local API token, which every Agent's shell carries, then runs as the signed-in person who started the run in progress in the named Session rather than as the administrator the token stands for, and that person's access to the Project is what counts. A token call that names no Session gets `403 session_required`. No run in progress, a run nobody signed in started, a run someone else steered, or a person who cannot open the Project gets `403 driver_unknown`. Every other command treats the token as before.
- Each run records who started it while it is in progress. A queued follow-up is driven by whoever queued it once it starts. Schedules nobody signed for, the Agent API, company mode, goals and compactions have no driver, and a subagent's Session counts as its root's run. Nothing is in progress after a restart.
- A schedule's creator is now only the person who saved it with their own sign-in. A schedule saved with the local API token, or a file an Agent or anyone else writes or changes, has no creator, and its runs have no driver. Notifications of such a schedule go to the Project's owner.
- Saving plugin settings and running their actions (`PUT /api/admin/plugin-config`, `POST /api/admin/plugin-config/action`) take a person's sign-in. The local API token can still read them, so an Agent can no longer loosen its own sandbox.
- A known limit until per-Session credentials: an Agent can name another Session of a Project it reaches and run such a command as the person whose run is in progress there.
