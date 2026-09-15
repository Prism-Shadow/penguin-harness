import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
  // The SDK is the host's: the plugin compiles against its types and calls its helpers at
  // runtime, and must never carry a second copy (the production pack marks it external too).
  external: ["@prismshadow/penguin-core", /^@prismshadow\/penguin-core\//],
});
