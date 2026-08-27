# The runtime layer — mechanism only

This directory is the heart of the **runtime**: the layer that boots, transports and hot-swaps
everything else. Read this before changing anything here (or in
`packages/desktop/`, or in core's environment tooling — the other runtime homes).

## The four layers

| Layer        | Lives in                                        | How it ships                      |
| ------------ | ----------------------------------------------- | --------------------------------- |
| **runtime**  | `hmr/`, `packages/desktop/`, server transport   | Rebuild + redeploy every install  |
| **platform** | `packages/server/src/hmr/platform.ts` + `app.ts` | One HTTP push, seconds, no restart|
| **workflow** | An agent's own folder                           | Installed/reloaded per agent      |
| **state**    | Parked context documents / runtime resources    | Rides across swaps, not restarts  |

## The rule

**The runtime carries mechanism. It must not carry policy.**

Mechanism is the machinery that is the same no matter what the product does: HTTP transport,
SSE channels, the network gate, the kernel's park → migrate → boot swap, the resource registry,
artifact storage and the atomic `harness.json` commit.

Authentication is NOT on that list, and used to be. Who may set a password, how long a session
lasts, how logins are throttled — that is policy, and a runtime that owned it made every auth
fix wait for a full reinstall: a platform naming a member an older runtime's AuthService lacked
was refused at the handshake. The App builds its own AuthService now (app.ts's buildAppDeps).
What the runtime still publishes is `runtime:auth-state`, the process-scoped values a push must
not forget — the state layer, not a capability.

Policy is everything a deployment might reasonably want to change: business APIs, what an agent
sees, what a command does, how a capability behaves. Policy belongs in the **platform**, which is
hot-swappable.

## Why this matters more than it looks

A runtime change costs a full artifact rebuild and a redeploy of **every installation** — and
until that redeploy lands, the fix does not exist for users. A platform change is one HTTP push
that takes seconds and needs no restart. Every behavior misfiled into the runtime is a fix that
arrives weeks late.

## The test to apply BEFORE editing runtime code

1. Which layer owns this **behavior** in the four-layer model?
2. Can it be delivered by a platform push instead? If yes, it must be.
3. If it truly must live here, be able to say why in one sentence — "it is transport, security,
   kernel, or a one-time primitive the hot layers build on".

### The trap: "fix where the code is"

The single most common way this rule gets broken is finding the line that misbehaves and editing
it there. Today most behavior still physically lives in runtime files, so "fix at the fault site"
lands in the runtime almost every time. **The fault site is not the owner.** Decide the layer
first, then choose the edit site — not the reverse.

### The enabler people forget

Platform code executes **inside the server process**. Anything achievable in-process is therefore
deliverable by a hot push, with zero runtime change — including effects that look like they
belong to the shell, e.g. extending `process.env.PATH` so the agent's spawned shells inherit it.
Before touching the runtime, ask whether a platform `boot()` could do the same thing.

## The route table is not a runtime asset

The runtime mounts ONE seam (`http-seam.ts`) before its own routes: the running platform gets
first refusal on every request and answers `null` for the ones it does not own. A pushed
platform can therefore add an endpoint, replace an existing one, or serve something else
entirely — with no rebuild. The RPC dispatch route that used to stand in for this
(`POST /api/hmr/platform/call`) is gone with it: it made *methods* pushable, which is not the
same thing — a method has no path, no verb and no status code, and every client would have had
to speak that envelope instead of the API it already speaks.

Two boundaries keep it safe, and both are load-bearing:

- **`/api/hmr/*` is never offered to the platform.** It is the channel a broken platform gets
  replaced through; if a push could claim it, one bad push would lock the installation out for
  good.
- **A platform that throws does not fall through.** It claimed the request; running the
  runtime's older handler instead would answer with semantics the caller was not promised. The
  error surfaces as a 500.

A streaming response rides the seam unchanged — the handler returns a whole `Response` as
soon as the stream exists and keeps writing to it, which is what the platform's SSE endpoints
do. A live **socket** is what the seam cannot carry, there being no `Response` to return for
one, so the terminal WebSocket handshake reaches the App through in-process members instead.
That is a property of the contract, not a layer boundary.

## Worked examples (all real, all from review)

- **Opening DevTools from the web UI** — a preload bridge was added to the Electron shell so the
  app could open DevTools. Rejected and reverted: the shell already ships
  Ctrl+Shift+I, so the "capability" bought nothing and cost the window's zero-preload security
  posture. An app-level convenience is never a reason to grow runtime surface.
- **The agent could not find the `penguin` CLI** — the first fix injected `PATH` when the Electron
  shell forked the server. Rejected: "what environment the agent sees" is policy. It belongs in
  the platform's `boot()`, where it also reaches already-deployed machines through a normal push.
- **New business APIs** — the HTTP seam offers every request to the booted platform, which
  serves the ones it owns. This is the mechanism that keeps business APIs out of the runtime
  permanently: a pushed bundle adds, changes or drops endpoints with no route change here.
  Adding a route per business API is the anti-pattern it exists to prevent.

## What does legitimately justify a runtime change

Transport and security mechanism, kernel evolution, and one-time primitives the hot layers build
on (for example: making a web push one gzip artifact served from memory, so pushes stop
serializing on per-file disk writes). If a change is none of those, it is probably policy —
put it in the platform.
