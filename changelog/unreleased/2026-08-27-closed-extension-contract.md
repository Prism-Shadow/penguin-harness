# The extension contract is closed, and owns the sandbox vocabulary

- **Date:** 2026-08-27
- **Type:** refactor
- **Scope:** `core`, `server`
- **PR:** [#354](https://github.com/Prism-Shadow/penguin-harness/pull/354)

[中文版](2026-08-27-closed-extension-contract.zh.md)

`PenguinContext` and `PenguinInterface` used to be open: the harness added its members by augmenting `@prismshadow/penguin-core/extension` with `declare module`. An extension checking against the contract therefore compiled against members only one embedder supplies, and nothing at the core layer could say which were which. They name every member now, and are not reopened.

## Details

- The sandbox vocabulary moved into the contract, at `@prismshadow/penguin-core/extension`: `SandboxPolicy`, `SandboxProvider`, `ConfinedArgv`, the mode and dimension unions, and the registry/control surfaces. A backend is written against those names and nothing else, so they belong with the contract rather than inside the harness that routes them. `PenguinContext.sandbox` and `PenguinInterface.sandbox` are declared outright.
- Only the vocabulary moved. `SANDBOX_DIMENSIONS`, `providerDimensions` and `requestedDimensions` read those shapes and are the embedder's, so they stay in the server package — which keeps both extension subpaths emitting types and nothing else (core's `extension/index.js` is still 33 bytes), so an extension package carries no runtime dependency on either.
- What the harness offers beyond the contract is named on an interface that extends it — `HarnessContext`, carrying `terminals`. Values of that type still satisfy the contract, so the seam is unchanged; an extension that wants `terminals` writes `ctx as HarnessContext` and thereby states, where it is used, that it depends on running inside this harness.

## Compatibility

Nothing about the wire or on-disk formats changes; this is a compile-time surface. An extension that read `context.terminals` off the plain contract now needs the cast, which is the point — that member was never part of the contract, only of this embedder.
