# The server seams a plugin's system app needs

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `core`, `server`, `docs`
- **PR:** [#1675](https://github.com/Prism-Shadow/penguin-harness/pull/1675)

[中文版](2026-11-20-plugin-app-server-seams.zh.md)

The server gained the generic seams a system app provided by a plugin needs: its own folders in a Project, Agent tasks started as a person, read views of the Project, the files of its page, and three data slots for a Project's creation, the semantic ids and the start page (design: [PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)). They are reached through `@prismshadow/penguin-server/plugin`. The in-repo Evaluation Center is unchanged, except that its `benchmark` kind of semantic id is now one such contribution.

## Details

- **`AppData`.** `dataPaths(projectId, appId)` answers `{ dataDir, cacheDir, stateDir }`: the system Agent's agent-level folders of the app, `agents/system_agent/app/{data,cache}/<appId>/` and a state folder under `run/`, each made before it is returned. A Project made before the system Agent existed is given it first.
  - The `benchmark` app's data is the folder the Project's Benchmarks are in.
  - Where the Project's `system_agent` is a user's own Agent, any other app is refused 409 `system_agent_held`, and nothing is written into that Agent.
  - An id that is not one plain segment is 400, and a Project the server does not have is 404 `project_not_found`.
- **`AgentTasks`.** `start({ userId, projectId, agentId, prompt, approvalMode, skills?, model?, thinkingLevel?, title? })` opens a conversation and starts the task, by the steps the Web App's Send takes:
  - 404 when the person cannot reach the Project or the Agent does not exist, and 409 `system_agent_no_sessions` for the system Agent;
  - a fresh temporary Workspace, and the Skills as a `[use_skills]` block in front of the person's text;
  - the person is the run's driver, and the source is `user`, so the conversation is in their sidebar with the approval badge and the completion notice;
  - the approval mode is the one given, one of the four a new chat offers.

  `status(userId, sessionId)` answers `{ status, title, pendingApprovals }`, where `status` is `running`, `completed` or `failed`, or null for a Session that is gone or that the person cannot read.
- **Read views.** `ProjectModels` (`getModels`) and `ProjectMachines` (`projectApis`) are new interfaces on the face, and the host's `Access`, `WorkspaceFiles` and `MachineApi` types are exported beside them. The kernel matches a requirement by structure, so a plugin may declare the same views in its own package.
- **Values on the face.**
  - `containedFile` and `uiFileResponse` serve a package's own page files. `containedFile` refuses a path that climbs out and any link, inside the folder or out of it.
  - `unzipBounded`, `assertSafeEntryPath`, `assertDistinctPaths`, `specialEntries`, `CONTROL_CHARACTER` and the archive limits are the server's own zip guards.
- **`ProjectsModule.appSeeds`** `{ app, path }`. When a Project is created, and when the first owner adopts `default_project`, every folder under the package's `<path>/` is copied into the app's data folder under its own name, where that name is free.
  - Only built-in packages that the Project lists for this server are read. The host reads their `ifaces.json` and runs nothing of them.
  - Each seed is staged under `.seeding/` and renamed into place. Core's new `placeFolder` does this, and `placeBenchmark` now writes through it.
  - A seed that cannot be copied is logged and never fails the Project's creation. Links inside a seed are not copied.
  - Nothing writes seeds later: a deleted one does not come back, and an existing Project never gets them.
- **`SemanticIdModule.kinds`** `{ kind, access? }`, whose code half is `{ takenIds(projectId) }`. `POST …/suggest-id` takes a contributed kind beside `project`, `agent`, `org` and `channel`, and answers 400 for a kind nobody contributes.
  - A contributed kind's id is kebab-case, and its placeholder is `<kind>-<yyyymmdd>`. `access: "owner"` limits the kind to the Project's owner.
  - The Evaluation Center contributes `benchmark` this way, so its proposals are as before.
- **`StartPageModule.metrics`** `{ key, title, titleZh?, icon?, order, value, app? }`: a count fixed when its package is built. `GET /api/contributions` delivers the counts as `startMetrics`, each with its contribution `id` and its module as `from`.
- **Smaller changes.** A Session title's rule moved into `http/session-title.ts`, shared by a rename and a task's title. Core exports `slotEntries`, which reads one slot's entries off a package's table without running it.
- **Docs.** The Plugins page lists what a server module reaches through the face, and the Server API page covers contributed id kinds and `startMetrics`.
