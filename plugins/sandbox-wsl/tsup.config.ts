import { defineConfig } from "tsup";

export default defineConfig({
  // Two entries: the plugin the harness loads, and the launcher each confined command becomes —
  // a small Node process that runs wsl.exe and keeps WSL's own console warnings out of the
  // command's stderr.
  entry: ["src/index.ts", "src/launch.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
});
