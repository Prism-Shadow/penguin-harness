# @prismshadow/penguin-hmr — the mechanism, and nothing else

This package is the hot-update **mechanism**: the version store, the atomic `harness.json`
commit, the resource registry live objects ride across a swap in, and the park → boot → swap
itself, with the recovery that re-boots the previous version when a boot fails.

## The rule

**Nothing in this package may encode what the product does, and it is not to be changed
without asking.**

Not "prefer not to" — asking is the rule. Everything here ships by rebuilding and redeploying
**every installation**, so a change costs weeks of latency for every user, and a mistake costs
the channel through which every other fix arrives. A package that cannot be hot-updated is the
one package a broken hot update has to survive.

If you are here because something needs fixing, the odds are the fix belongs somewhere else.
Apply the test in `packages/server/src/hmr/README.md` first:

1. Which layer owns this **behaviour**?
2. Can a platform push deliver it instead? If yes, it must.
3. If it truly must live here, be able to say why in one sentence — "it is transport,
   security, the kernel, or a one-time primitive the hot layers build on".

The trap is answering "fix it where the code is". Most behaviour that reaches this package
arrives that way, and each arrival is a fix that lands weeks late for everyone. Auth was here
once. So was plugin loading. Both moved out; nothing has ever needed to move in.

## What is deliberately NOT here

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
