# waf-state-machine

This package is the behavioral runtime for WAF Loom generated activities. It is
published to Waterford Nexus and bundled into generated module output. Generated
behavior imports this package and must not import XState directly.

The public WAF actor contract is backed by a native hierarchical XState v5
state machine. Generated activity code must use this package's API rather than import
XState directly. The adapter preserves WAF's dotted leaf snapshots, cancellable
actions, preview starts, transition notifications, and terminal semantics.
Dialect path lookup is isolated in the internal Definition Index; state-owned
cleanup is isolated in the Effect Scope Registry.

The canonical state machine definition remains in the activity ref at
`spec/state-machine.json`. That document uses the WAF State machine dialect,
not XState's native machine schema; the package compiles it through the adapter.
The runtime also validates `configuration.activityScenes` against the state machine's
top-level scenes and exposes canonical descriptions and media keys through
`data.sceneCatalog`.

Generated browser code imports the main package entry. Pure state machine tests can
import `waf-state-machine/state-machine` without loading WAF host dependencies.

## Project structure

The source tree is organized around the package's two runtime domains:

- `src/state-machine/` contains the host-independent state-machine definition,
  validation, execution, and effect-lifecycle modules.
- `src/activity/` contains activity host integration, observations, scene
  metadata, and asset hydration.
- `src/index.ts` and `src/state-machine-api.ts` are stable package entry points.

Tests mirror these domains under `test/activity/` and `test/state-machine/`.

Development uses Node 24.19.0:

```sh
cd ../..
npm run check:state-machine
```

Publish the verified package to Waterford Nexus with:

```sh
npm --workspace waf-state-machine run prepack
npm pack --workspace waf-state-machine
npm --workspace waf-state-machine publish
```
