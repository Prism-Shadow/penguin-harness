# Local pages no longer wait for a machine or the internet

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `web`, `server`, `desktop`, `ui-gallery`, `docs`
- **PR:** [#1345](https://github.com/Prism-Shadow/penguin-harness/pull/1345)

[中文版](2026-10-26-local-first-loading.zh.md)

A connected machine that stopped answering (the network behind its ssh connection went quiet, or its server stalled) held this server's Session list and `/chat`'s pick of the last conversation, the Evaluation Center and the terminal list for as long as each of its calls took to time out, and held the archive's groups on the server side. The Plugins page held this server's own built-in modules on every read while the published index had not answered. The server's boot waited for the schedulers' first pass, which can fire a missed task and reach the network, and the desktop shell chose its update feed over the network while launching. Every page now shows what this server holds from this server alone, and asks machines and the internet only after that, each part loading on its own.

## Details

- **Session list**: this server is asked first and its rows go on screen as soon as it answers; the machines are asked after that. A machine still being asked keeps the rows it showed (or its cached rows) and its cache until its own answer lands, which builds the list again. `/chat` opens the last conversation without waiting for any machine.
- **Remote reads of the app shell** start once this server's Session list is on screen, or once there is no list to wait for: the machines' Agent lists and event stream behind the sidebar, the machines' scheduled-task marks, the release check and a pinned balance (`lib/local-first.ts`).
- **Evaluation Center**: the list, a Benchmark's page and its Cases show this server's at once; each machine is asked after this server answered and joins when it answers. A machine connecting or dropping out no longer returns the list to its skeleton, and a Benchmark absent from the answers so far reads as missing only once no machine is still being asked.
- **Terminal list**: this server's shells show as soon as it answers; a machine's list is asked after that and given up after the API socket's own answer wait, instead of holding every later refresh, which shares the one in flight.
- **Archive**: `GET /api/me/archived-sessions/groups` takes `servers=here` (this server's groups, asking no machine) or `servers=machines` (the machines' groups). Settings › Archived chats asks this server's groups first, shows them with their rows, then asks the machines' and merges them in; until then a refresh keeps the machine groups on screen. Without the parameter the route answers both, as before.
- **Plugin registry**: `GET /api/plugins/registry`, and the readme and archive routes that read the same listing, no longer wait for a published index that has nothing cached: the shipped entries list at once and the source is named as still loading, and the page reads it again as before.
- **Schedulers at boot**: the server no longer waits for the first pass of the scheduled-task scheduler and of company mode's scheduler before it announces its port and serves pages. Each pass still runs as the platform comes up, missed slots included, and a failure in it is recorded; the periodic tick is armed before the pass.
- **Desktop update checks**: the shell chooses its update feed (the OSS mirror or GitHub) and starts its automatic checks only once the main window is shown, never while launching. An app started straight into the tray, with no window shown ten minutes after launch, starts them then; whichever comes first starts them, once. "Check for Updates…" runs whenever it is asked.
- The component gallery's mock answers the machines' side of the archive with nothing; the server API docs describe `servers`; the design spec and the frontend skill state the rule.
