import { defineConfig } from "tsup";

// The same shape as claude-code and the sandbox plugins: the `@prismshadow/penguin-core/plugin`
// decorators are compiled INTO the bundle (they register through a `Symbol.for` store, so a
// second copy of the code is the same store). A pushed plugin is unpacked under the data
// root, where Node's walk-up never reaches the program's `lib/node_modules`, so a bare import
// of the SDK would fail at load on every installation — discord-bot's `external` shape only
// works from a repo checkout.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
