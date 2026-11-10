import { defineConfig } from "tsup";

// The workspace imports the TypeScript source (package.json `exports`) and the server's build
// inlines it, and the package is private, so no consumer loads this build. Running it refreshes
// the server's injected copy of the source (pnpm's syncInjectedDepsAfterScripts), which is why
// the dev prestep runs it; PENGUIN_BUILD_JS_ONLY=1 there skips the declarations, as the server's
// build does.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: process.env.PENGUIN_BUILD_JS_ONLY !== "1",
  clean: true,
  sourcemap: true,
});
