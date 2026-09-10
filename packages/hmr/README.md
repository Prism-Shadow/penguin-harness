# @prismshadow/penguin-hmr — the HMR layer's mechanism, and nothing else

This package is the hot-update **mechanism**: the version store, the atomic `harness.json`
commit, the resource registry live objects ride across a swap in, and the park → boot → swap
itself, with the recovery that re-boots the previous version when a boot fails.

It is the heart of the **HMR layer** — the layer that boots, transports and hot-swaps
everything else. The layer's other homes are the server's half of it
(`packages/server/src/hmr/`: the capability contract, the upgrade endpoints, the seam, and the
platform itself), `packages/desktop/`, and core's environment tooling. Read this before
changing any of them.

The layer used to be called "the runtime", and that name is why this file has to keep saying
what belongs here: *runtime* also means "the program that is running", so everything the
process did sounded like it belonged to the layer, and behaviour kept landing here that ships
only by reinstalling every installation. The layer is named after the one thing it does.

## The four layers

| Layer        | Lives in                                                | How it ships                       |
| ------------ | ------------------------------------------------------- | ---------------------------------- |
| **hmr**      | `packages/hmr`, `server/src/hmr/`, `packages/desktop/`  | Rebuild + redeploy every install   |
| **platform** | `packages/server/src/platform.ts` + `app.ts`            | One HTTP push, seconds, no restart |
| **workflow** | An agent's own folder                                   | Installed/reloaded per agent       |
| **state**    | Parked context documents / the resource registry        | Rides across swaps, not restarts   |

## The rule

**The HMR layer carries mechanism. It must not carry policy. And this package is not to be
changed without asking.**

Not "prefer not to" — asking is the rule. Everything in the layer ships by rebuilding and
redeploying **every installation**, so a change costs weeks of latency for every user, and a
mistake in this package costs the channel through which every other fix arrives. A package that
cannot be hot-updated is the one package a broken hot update has to survive.

Mechanism is the machinery that is the same no matter what the product does: HTTP transport,
SSE channels, the network gate, the park → migrate → boot swap, the resource registry, artifact
storage and the atomic `harness.json` commit. Policy is everything a deployment might reasonably
want to change: business APIs, what an agent sees, what a command does, how a capability
behaves. Policy belongs in the **platform**, which is hot-swappable.

Authentication is policy, and used to be in the layer: a platform naming a member an older
runtime's AuthService lacked was refused at the handshake, so every auth fix waited for a
reinstall. The App builds its own AuthService now; what the layer still publishes is
`runtime:auth-state`, the process-scoped values a push must not forget — state, not a
capability.

The layer's HTTP surface is `/api/hmr/*` — the channel a broken platform is replaced through,
which is why it is never offered to the platform. Every other route is the platform's; the
layer keeps rollback copies of `/api/auth` and `/api/desktop` below its seam only until no
platform that declines them can be rolled back to.

## The registry is the state layer, not an HMR-layer API

Most of what the resource registry holds is the **platform's own state**, kept there for one
reason: a swap must not lose it. The auth values, the plugin host's imported objects, the frames
the shell last sent, the nodes a test stands in for — platform code writes them, platform code
reads them, and their meaning changes by push.

The id says which kind an entry is: `hmr:*` is a capability — what only the process can
provide (the config it started with, the open database, the channels, the hot host) —
and `platform:*` is parked state. An id is a wire contract between generations, so the
`runtime:*` names the entries had before are registered and claimed as aliases until no
installed layer predates the rename (`LEGACY_RESOURCE_IDS` in
`packages/server/src/hmr/capabilities.ts`). Reading parked state as a capability is how
behaviour ends up misfiled.

## The test to apply BEFORE editing HMR-layer code

1. Which layer owns this **behaviour** in the four-layer model?
2. Can a platform push deliver it instead? If yes, it must.
3. If it truly must live here, be able to say why in one sentence — "it is transport,
   security, the kernel, or a one-time primitive the hot layers build on".

**The trap is "fix where the code is."** Much behaviour still physically lives in the layer's
files, so a fix at the fault site lands in the layer almost every time. The fault site is not
the owner: decide the layer first, then choose the edit site.

**The enabler people forget:** platform code executes inside the server process. Anything
achievable in-process is deliverable by a hot push with zero layer change — including effects
that look like the shell's, such as extending `process.env.PATH` so the agent's spawned shells
inherit it. Before touching the layer, ask whether a platform `boot()` could do the same.

Worked examples, all from review: a preload bridge added to the Electron shell so the page could
open DevTools (rejected — the shell already ships Ctrl+Shift+I, and the bridge cost the window's
zero-preload posture); `PATH` injected where the shell forks the server so the agent could find
the `penguin` CLI (rejected — what environment the agent sees is policy, and `boot()` reaches
deployed machines by push); a route added to the shell per new business API (the anti-pattern
the seam exists to prevent). What does justify a layer change: transport and security
mechanism, kernel evolution, and one-time primitives the hot layers build on.

## The route table is not a layer asset

The shell mounts ONE seam (`packages/server/src/hmr/http-seam.ts`) before its own routes: the
running platform gets first refusal on every request and answers `null` for the ones it does
not own, so a pushed platform can add an endpoint, replace one, or serve something else
entirely with no rebuild. Two boundaries keep it safe: `/api/hmr/*` is never offered, and a
platform that throws does not fall through — it claimed the request, and the error surfaces as
a 500. A streaming response rides the seam unchanged; a live socket is what it cannot carry,
so the terminal WebSocket handshake reaches the App through in-process members instead.

## What is deliberately NOT in this package

- **The platform.** `HmrHost` never imports one: the bundle compiled into the program is a
  constructor argument, and the api it exposes is a type parameter. This package cannot name
  a route, a service or a plugin, and that is enforced by it having no way to see one.
- **The capability list.** Which objects a platform may claim, and what each promises, is the
  server's contract (`packages/server/src/hmr/capabilities.ts`) — the registry here holds
  whatever it is handed.
- **The HTTP surface.** `/api/hmr/*` is the server's (`packages/server/src/hmr/routes.ts`),
  including who may push.
- **What "a version" contains.** The store keeps bytes and a manifest; that a version is a
  platform plus a cli plus a web bundle is the product's idea, expressed in what the server
  hands over.

## Layout

| File             | What it is                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| `host.ts`        | `HmrHost`: store, commit, boot, upgrade, recovery                        |
| `resources.ts`   | `HotResources`: the registry, and its disposal groups                    |
| `manifest.ts`    | `harness.json` — read, write, materialize; importable with no host       |
| `ifaces-diff.ts` | What a refused handshake says two generations disagree about             |

Internal to this repo (`private`), and inlined into the server's bundle — it is a boundary in
the source tree, not another artifact to publish.
