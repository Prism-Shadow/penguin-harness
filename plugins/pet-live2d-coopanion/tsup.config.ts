import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // Hono rides in the bundle, the way every pure-JS dependency of a builtin plugin does;
  // the harness's own copy is the host's and is not importable from a package's dist.
});
