import { defineConfig } from "tsup";

export default defineConfig({
  // Two entries: the plugin the harness loads, and the launcher it hands each confined
  // command — a separate process, because a command runs as ANOTHER account and the
  // harness's own process cannot change who it is.
  entry: ["src/index.ts", "src/launch.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
  // koffi carries per-platform binaries and resolves them itself; it stays a dependency.
  external: ["koffi"],
});
