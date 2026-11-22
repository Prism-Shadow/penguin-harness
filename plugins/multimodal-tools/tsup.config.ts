import { defineConfig } from "tsup";

// The server module and its pure-JS dependencies (hono, MMSP's credentials table) are bundled
// into dist/: a shipped plugin runs what it carries, and shares only core's types with the host.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  sourcemap: true,
});
