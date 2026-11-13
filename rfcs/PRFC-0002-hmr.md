# PRFC-0002 HMR v1: the layer has only `/api/hmr`, and depends only on http and log

[中文版](PRFC-0002-hmr.zh.md)

> **Source**: `rfcs/PRFC-0002-hmr.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — landed (default branch `main`, commit [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)).
> **Rev**: v1.0.0 (migrated into the main repository); the conventions for this file are in [README.md](README.md); per-version changes are recorded in `## Changes` at the end.

- Feature Name: `hmr`
- Start Date: 2026-09-08
- PRFC PR: [Prism-Shadow/penguin-harness-design#128](https://github.com/Prism-Shadow/penguin-harness-design/pull/128)
- Implementation PR: [Prism-Shadow/penguin-harness#656](https://github.com/Prism-Shadow/penguin-harness/pull/656) (first batch)

## Summary
[summary]: #summary

HMR v1 distills the relationship between the layer and the platform down to three rules:

1. **The layer's HTTP surface has only `/api/hmr`.** Every other route is the platform's, provided through the seam; the layer keeps no copy of any route.
2. **The contact surface between the layer and the platform is two handles**: the HTTP surface to be served, and an outlet for writing logs. The entry point builds the initial values of both handles and passes them to the layer; each time a generation of the platform is started, the platform hands over its own http and log, and the layer switches the handles to the new generation

   ```ts
   function hmrMain(initHttp: Http, initLog: Log): Promise<number>
   ```

   The layer relies on no `@Use` injection, and takes nothing out of the pushed tree by name.
3. **The registry is the platform's in-memory state.** Every entry's id is `platform.<name>`; changing an id or a node name is a **hard upgrade** between the layer and the platform — no aliases, no compatibility.

## Motivation
[motivation]: #motivation

`packages/hmr/README.md` established one rule: **the layer carries mechanisms, not policies**. Yet the layer has been violating it all along, and in the way that is hardest to see — asking the platform for things by string.

The violation has already happened once. `/api/desktop` was mounted in the layer; hiyouga changed it without knowing this rule, and the change could therefore only be delivered by reinstalling the program — users got no hot reload. The layer fetching `Log`, `Errors`, `Access`, and `Settings` from the platform by name — for request logging, error persistence, attribution, and the body limit — is the same kind of violation: the next person to change one of those will run into it in just the same way.

`/api/auth` could have stayed in the HMR layer. But to keep the HMR layer to a minimum, these basic features are excluded from the layer as well and moved into the platform: the goal is that **every feature of the platform can be hot-reloaded**, leaving in the layer only the mechanisms required to replace the platform.

## Guide-level explanation
[guide-level explanation]: #guide-level-explanation

Think of the layer as a host: it is in charge of starting the platform, hot-replacing it, opening the port, and handing requests over. There are only two things it needs to know — **whom to hand them to**, and **where to write its own logs**. Both are handles: the entry point provides the initial values (an http that only answers "the platform is not up", and a console log), and afterwards, each time a generation of the platform starts successfully, it hands over its own http and log, and the layer switches the handles over.

```ts
const code = await hmrMain(initHttp, initLog);
process.exit(code);
```

`http` points at the fetch surface the current generation of the platform assembles. `log` points at the current generation's log outlet, falling back to the initial value while the platform is absent. The layer knows nothing of Projects, nothing of settings, nothing of how errors are persisted — all of that sits behind `http`, decided by the platform itself and updated by pushes.

Hence:

- **Above the seam the layer mounts only `/api/hmr`**; below the seam there is only static hosting and the SPA fallback. `/api/auth` and `/api/desktop` (shutdown and the client-update relay) are the platform's route groups; a path the platform rejects is a plain 404, and the layer provides no fallback.
- **Request logs** are written by the platform's middleware; the layer writes lines only for its own lifecycle (startup, swap, exit).
- **Error persistence** is done by the platform's `onError`; when the layer hits a process-level crash it only `log`s, because at that moment there may be no usable platform at all.
- **The body limit** is gated by the platform itself — it was always a platform setting.
- The layer's entry point returns a **process exit code**, folding "how to wind down" into the same function instead of scattering it across signal handling and the shutdown paths.

The places where the layer takes things from the tree by name drop to **zero**: the platform hands http and log over in its startup callback, and the layer never enters the tree.

## Reference-level explanation
[reference-level explanation]: #reference-level-explanation

### The layer's HTTP surface

`createApp(boot)` mounts: the network guard, the platform seam, static hosting. The layer mounts no API above the seam: `/api/hmr` too is a route group the platform declares and contributes (it carries its own network gate, with the platform's auth and admin checks behind it). What the route answers (the pushed body, results, probing) is the mechanism's `upgradeEndpoint`, claimed via `platform.hmrControl`; a generation that does not serve this channel is rejected before commit (`admitsUpgradeRoute`), the previous generation carries on, and the installation always keeps a way to push again. There is no prefix list, and no fallback copies. On the platform side, `HttpModule` assembles according to the contributed `routes` (`prefix` / `auth` / `order`); the cookie gate is mounted per group — every `auth: "user"` group carries a gate on its own `prefix`, and a single request is authenticated only once; the meaning of `auth` is therefore independent of `order`: an `auth: "none"` group ordered after a protected group is still public, and protected groups outside `/api` (the machine proxy `/server/`) are protected just the same. A path served by no group is rejected by the platform, i.e. a 404, instead of falling behind a gate and becoming a 401; the `/api/auth` group itself ends in a 404.

### The entry point

```ts
// main: build the two handles, give them their initial values, hand them to the layer
const http = handle<Http>(initHttp); // the initial value only answers "the platform is not up"
const log = handle<Log>(initLog);    // the initial value writes to console
process.exit(await hmrMain(http, log));

// the layer
async function hmrMain(http: Handle<Http>, log: Handle<Log>): Promise<number> {
  const platformStart = resolveHarness();               // the version harness.json points at; the default is the one bundled into the program
  const replaceHmr = (nextHttp: Http, nextLog: Log) => {
    http.set(nextHttp);
    log.set(wrap(nextLog, log));                         // the new log wraps the old handle: when the platform is gone, fall back to the previous one
  };
  const next = (version: Version) =>
    platformStart(version, resources, (newHttp, newLog) => replaceHmr(newHttp, newLog));

  http.route("/api/hmr/upgrade", (req) => next(versionOf(req)));
  await next(current);
  return exitCode;
}
```

- **The handles** are the only thing the layer holds: the listener reads `http` once per request, and the layer reads `log` once when it writes a line of its own. A swap only changes what the handles point to — no restart, no re-resolution.
- **The platform hands the values out; the layer does not go get them**: after `platformStart` starts a generation of the platform, it passes the http and log that generation assembled to the layer in the callback. The layer never does `tree.api(...)`.
- **Failure means no swap**: when a new generation fails to start, the callback is not called, and the handles still point at the previous generation; the same holds after the host restores the previous version. Before the first generation starts, and after all generations are dead, the handles hold their initial values — http answers "the platform is not up", and log writes to console.
- **`/api/hmr/upgrade` is mounted on the handle**: it is the one route the layer mounts on `http`; every other request falls through to the platform the handle currently points at.

### Migration checklist

- `createApp` drops the four resolutions of `errors` / `settings` / `access` / `authService`; `onError` keeps only `handleError`, and recording is handed to the platform.
- The `uncaughtException` / `unhandledRejection` handlers in `index.ts` no longer go through `liveApi<Errors>`; they write their lines through the `log` handle instead, with the process-exit semantics unchanged.
- `applyPersistedProxy()` moves onto the platform's startup path: proxy settings are the platform's settings.
- `liveApi` is deleted: the handles take the place of its "value of the previous App" fallback semantics.
- `Clock` / `Paths` are not the layer's things: they move out of `hmr/capabilities.ts` and `RuntimeModule` back into the platform's own modules — a pure relocation.

### Node names

The layer's constants and types have been unified on the HMR vocabulary (`HmrCapabilities`, `claimHmrCapabilities`, `HMR_*_RESOURCE_ID`). Once the layer no longer takes nodes by name, the module nodes (`RuntimeModule`, `RuntimeDesktop`, `RuntimeAuthState`, and so on) are renamed to say what they are — they are the group in the platform that wraps the objects the layer publishes into nodes; this too is a hard upgrade, and tests that pin node names are no longer needed.

### registry and ids

What sits in the registry is the platform's state; the process keeps it for the platform, only so that a swap does not lose it. Every entry's id is `platform.<name>` — dot-separated, camelCase, the same shape as a plugin id: `platform.interfaces`, `platform.config`, `platform.db`, `platform.channels`, `platform.proxyControl`, `platform.host`, `platform.desktop`, `platform.lifecycle`, `platform.authState`, `platform.overrides`, `platform.plugins`, plus `platform.resourceInterfaces`, the parking declaration the platform writes for the next generation. The dynamic entry `terminal:<sessionId>` keeps its colon form: that colon is the key by which `disposeGroup` sweeps the group.

The registry is in-memory state, **without aliases**: the layer registers only new ids, and the platform claims only new ids. When a platform carrying this change is pushed onto a layer that predates it, the handshake cannot read `platform.interfaces` and is rejected; the layer restores the previous version, and the layer needs a reinstall. This is deliberate — keeping cross-generation aliases for in-memory state is a long-term cost that buys back no persistent data.

## Status
[status]: #status

**Landed ([penguin-harness#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)):**

- The layer is renamed the HMR layer; the mechanism becomes `packages/hmr` (`HmrHost` cannot see the platform: the bundle is a constructor parameter, the api a type parameter); a README lives at `packages/hmr/README.md`.
- The layer's HTTP surface is down to `/api/hmr`: `AuthRoutes` / `DesktopRoutes` / `DesktopUpdateRoutes` became the platform's route groups, `HMR_LAYER_PREFIXES` and the rejection middleware were deleted, and the layer keeps no fallback copies.
- All registry ids are `platform.<name>`, no aliases; the tests that pinned node names are deleted.
- `createHmrApp` is renamed `createApp`.
- The `log` handle: the platform hands `log` out on its api (named by the iface); each of the layer's request-log lines is resolved through the host to the current platform, or written to console when there is no platform; the `http` handle is the seam itself. The remaining by-name resolutions inside the layer are untouched.

- The entry point and the frozen operations are in `packages/hmr/src/main.ts`: `hmrMain(host, replace, start)` returns a control object — `current()` (which generation requests are handed to; it first waits out any swap in flight, and throws when no generation can be started) and `upgrade(target)` (store the bundle, start the new generation, swap, and commit — or restart the previous generation); both call the product's `replace` afterwards (the new generation, or the previous generation restarted after a failure). The server's `main()` binds the port first (answering 503 before the platform comes up), then hands the host, `replace` (which refreshes the tree the layer uses to resolve nodes), and its own startup over to `hmrMain`; the seam and the upgrade route drive only the control object, and no longer drive the host directly.
- `/api/hmr` is a route group contributed by the platform (`HmrRoutes`), with the auth added by the platform; the control object gained an `endpoint(request)` — the push protocol itself lives in the package; before committing, `upgrade` probes whether the new generation serves `/api/hmr/upgrade` and rejects it if not (the `admit` hook of the kernel `upgrade`); a test pins that "one bad push must not lock the machine up".
- Pushes go the way `git push` does: storage is content-addressed (`store/blobs/<sha256>`), `POST /api/hmr/assets/probe` answers which blobs the target is missing, `PUT /api/hmr/blobs/<sha256>` takes a blob in verbatim (stored only when the hash matches the name), and `POST /api/hmr/upgrade` keeps its shape, in which every content value (`platform` / `cli` / `web.files` and each item of `assets.files`) may be written as `{ sha }`; the upgrade resolves them from storage before starting, and rejects the moment it names a blob the storage does not have. All three belong to the mechanism (`packages/hmr`) and are reached through the control object; deploy.mjs probes first, uploads only the missing blobs, and then pushes a body of names only. Older targets without the probe still receive everything inline.

**Yet to land:**

- The remaining by-name resolutions in the layer (`Errors` / `Settings` / `Access` / `Auth`) and `liveApi` — each goes through on its own, not bundled into one.
- `Clock` / `Paths` move back to the platform; the module nodes get renamed.

## Drawbacks
[drawbacks]: #drawbacks

**Every step is a hard upgrade.** An installation whose program predates this change cannot receive hot pushes of this platform: the handshake is rejected right at the registry ids. Such installations must update the program, not push.

**Process-level crashes are no longer persisted.** When an `uncaughtException` happens, the platform may be mid-swap or not up at all; the layer writes a line through the `log` handle, to wherever the handle points — the platform's log when the platform is there, console when it is not. The cost is losing part of the crash record; what it buys is that the layer no longer holds a reference that "may at any moment point into an already-destroyed tree".

**When the platform is not up there is no HTTP surface at all**, login included. It used to look like there was — `/api/auth` was served by the layer — but that was an illusion: the auth implementation has always lived in the platform. This PRFC puts the fact out in the open rather than fixing it; a real "degraded mode" is another matter.

## Rationale and alternatives
[rationale and alternatives]: #rationale-and-alternatives

**Why parameters are passed rather than fetched by name.** Fetching by name turns "what a module is called" into a contract between the layer and the platform; the price is that modules can never again be renamed and services can never move, and the price of breaking it is an old installation dying the moment it starts. Passing parameters gathers that contract onto a function signature — the signature is watched over by types both sides produce in the same build, so a break is a compile error, not an incident in production.

**Why ids get no aliases.** Aliases make one piece of in-memory state carry two sets of names forever, and on top of that ask for a copy of the read/write logic on each side, layer and platform (exactly what the first implementation did, and it was rejected). A hard upgrade costs only one more reinstall, and the handshake refuses explicitly instead of running on with wrong state.

**Alternative: an export table.** Have the platform publish a stable table of aliases (`"http" → HttpModule#http`), and let the layer recognize only the names in the table. This keeps the flexibility of "by name" and unlocks renaming at the same time. It is a smaller change than this proposal, but it does not solve the real problem — the four pairs of policy still sit below the seam. It can be follow-up work and does not conflict with this proposal.

**Alternative: touch nothing, just never rename.** That was exactly the state before: a name that described things wrongly, kept forever because it was the contract. The cost is that every refactor has to detour around it, and the one that cannot detour is the outage.

## Prior art
[prior art]: #prior-art

Moves in the same direction have already been made along this same seam: the client-update relay, login, and desktop shutdown moved from the layer to the platform (#656); the moves of host commands and plugin loading are pending merge in #631 and #383. The reason is the same every time — that was policy, and policy gets its updates by push. This PRFC carries the line to its end.

Rust's `fn main() -> ExitCode` is the same shape: the entry point receives what it needs, returns an exit code, and never reaches back into the host to demand more.

## Unresolved questions
[unresolved questions]: #unresolved-questions

- The shape of `wrap(nextLog, log)`: the new generation's log wraps the old handle so there is a fallback — but how many generations back does the fallback go: only to the initial value, or one generation at a time?
- Is `Handle` a small type the layer keeps to itself, or does it go into `packages/hmr`?

## Future possibilities
[future possibilities]: #future-possibilities

- Give `ModuleTree` the ability to resolve by interface, so that module names recede for good into implementation detail.
- A degraded mode for when the platform is absent: a minimal surface owned by the layer itself, just enough to see that "the platform is not up" and how to recover.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the landed version from the design repository's default branch, identical to the source file.
