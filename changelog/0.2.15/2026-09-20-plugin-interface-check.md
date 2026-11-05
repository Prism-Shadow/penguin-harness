# A plugin's interfaces are compared with the platform's by the TypeScript compiler

- **Date:** 2026-09-20
- **Type:** feature
- **Scope:** `server`, `desktop`, `scripts`
- **PR:** [#808](https://github.com/Prism-Shadow/penguin-harness/pull/808)

[中文版](2026-09-20-plugin-interface-check.zh.md)

Whether a plugin package still fits the platform it is loaded into used to be answered by looking the interfaces it names up in the platform's own table — which compares a declaration with itself and can never fail. Each side now brings its own: the plugin the `ifaces.json` its package was generated with, the platform this generation's table. Each is rendered as a self-contained `.d.ts`, the questions become assignments in a third file, and the TypeScript compiler answers them, in both directions — the platform's interface must be assignable to what the plugin requires, and what the plugin provides must be assignable to what the platform asks for.

- A member the platform has dropped, or whose signature no longer fits, is a load error naming the module, the alias and the interface; a member the platform has gained breaks nothing.
- The plugin's table is never substituted: an interface either side holds no copy of is logged as *not compared*, never answered from the other's entry — both halves are counted, so the tally is the number of questions that went unanswered. (The generator does not yet copy host interfaces into a plugin's table, so today that is most of them — the log says so rather than reporting a pass.)
- An opaque type is compared by its name, the identity the table records: each side is rendered into its own file, so the brand is a plain property rather than a `unique symbol`, which would be a different symbol per file and would stop the platform fitting itself.
- A table the renderer cannot read costs the comparison, not the package: an unrenderable expression in the plugin's own table is *not compared*, with the reason, while one in the platform's own table is reported.
- Rendering is lossless or it refuses: a table expression with no TypeScript form is reported by name, never widened; a stream carries its return type, so a change to it is not invisible.
- The compiler is a runtime dependency of the server now, loaded the first time a comparison needs it and resolved beside the module, beside the running program, or in the pushed assets. A hot push carries it as `archives/typescript.tgz` (the compiler's entry and default libraries only), because the program on the target may predate the dependency; the desktop build stages it beside the server bundle, which has no `node_modules` of its own. On an installation that has none of the three, plugins load as before and the log says the comparison was not made.
- `gen-ifaces`: an optional member typed `unknown` (or `any`) keeps that type. Stripping `undefined` with `getNonNullableType` turned `unknown` into `{}`, which refuses `null`.
