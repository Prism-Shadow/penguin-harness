import { defineConfig } from "tsup";
import { buildBenchmarks, stageBenchmarks } from "../../scripts/build-benchmarks.mjs";
// Inlines this checkout's git identity into the artifact — see the helper's module doc:
// core's dist is what the server imports at run time, and a shipped bundle has no path back to the checkout it came from.
import { buildGitDefine } from "../../scripts/build-git-stamp.mjs";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/interfaces/index.ts",
    // The plugin contract: types only, so a plugin package compiles against the SDK
    // without depending on whatever embeds it.
    "src/plugin/index.ts",
    // A row's effective connection and credential rule: no Node dependency and no catalog
    // data, so the Web App bundles the same answers the server and the CLI compute.
    "src/state/model-connection.ts",
    // Window/threshold arithmetic plus its two defaults: pure numbers, no Node dependency, so
    // the web app can bundle the compaction-threshold derivation its context ring fills against.
    "src/llm/context-limits.ts",
    // Hot-update kernel: zero-dependency subpath so web can bundle it directly.
    "src/kernel/index.ts",
    // A2UI block grammar: pure TypeScript, no Node dependency, so the web renderer bundles the
    // same parser and fallback the checker script uses (cli.ts is bundled separately by
    // scripts/build-a2ui-check.mjs and is deliberately not an entry here).
    "src/a2ui/index.ts",
  ],
  format: ["esm"],
  target: "node24",
  // The records and markers live in @prismshadow/amsp, and core's root entry re-exports
  // them (`export *`). esbuild turns a nested `export *` of an external module into a runtime
  // copy that leaves the names out of the module's static exports, so an `import { isSessionMeta }
  // from "@prismshadow/penguin-core"` would not link. Bundling the package keeps every name a
  // static export of core; it has no dependency of its own and holds no state, so the copy in
  // core's dist and the one a host imports beside it are the same pure functions.
  noExternal: ["@prismshadow/amsp", "@prismshadow/skills"],
  dts: true,
  clean: true,
  sourcemap: true,
  define: buildGitDefine(),
  onSuccess: async () => {
    await buildBenchmarks();
    await stageBenchmarks("dist/builtin-benchmarks");
  },
  // @prismshadow/skills (the vendored SKILL.md parser and its writer) is a devDependency bundled
  // into dist, so the published core carries that code and never imports the package at run
  // time; its own runtime dependency, yaml, is one of core's dependencies and stays external.
});
