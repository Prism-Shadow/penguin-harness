# DeepSeek Harness sandbox adaptor

Puts the **DSH** sandbox ecosystem behind this harness's own sandbox interface. This is the
portable floor: it works on Linux, macOS and Windows, and implements the `fs-write`
dimension.

## What it covers

`@deepseek-ai/dsh-sandbox-local` carries the platform chain and probes each rung
functionally:

| Host | Mechanism |
| --- | --- |
| Linux | dsh-bwrap → Landlock |
| macOS | Seatbelt |
| Windows | ACL restricted-token runner |

DSH's policy vocabulary governs **file-write effects only**, so this adaptor declares
exactly `fs-write`. The sandbox service therefore never routes a `network` or
`mask-paths` policy here, and the adaptor never has to silently drop a dimension it
cannot honor — for those, use the bubblewrap, Seatbelt or MXC backend for your platform.

## Requirements

- The DSH dependencies (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-sandbox`,
  `@deepseek-ai/dsh-sandbox-local`) are dependencies of **this package**, not of the
  harness — which is what "extensions are configuration, not built-in capability" means in
  dependency terms.

They load behind dynamic imports, which is load-bearing for hot push: the package reaches
native-adjacent modules that a pushed single-file bundle resolves from the installation, so
an installation missing them fails *this* load — reported fail-closed by the service —
instead of failing the whole platform bundle's import.

## Install

Add the specifier to your deployment's `extensions.json` and restart, or push a platform that
carries it:

```json
{ "extensions": ["@prismshadow/penguin-extension-sandbox-dsh"] }
```

Installing is an operator-side action: the harness resolves the package from the installation,
never from this listing.

## License

Apache-2.0.
