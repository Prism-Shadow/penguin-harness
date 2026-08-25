import { defineConfig } from "tsup";
// Inlines this checkout's git identity into the artifact — see the helper's module doc:
// core's dist is what the server imports at run time, and a shipped bundle has no path back to the checkout it came from.
import { buildGitDefine } from "../../scripts/build-git-stamp.mjs";

export default defineConfig({
  // model-catalog gets its own entry point: pure data, no Node dependency, so web can bundle it directly via subpath import.
  entry: [
    "src/index.ts",
    "src/omnimessage/index.ts",
    // Message markers: their own entry so hosts (web/server/cli) can import the marker
    // producers and parsers without pulling the rest of the SDK surface.
    "src/omnimessage/markers/index.ts",
    "src/interfaces/index.ts",
    "src/state/model-catalog.ts",
    // Hot-update kernel: zero-dependency subpath so web can bundle it directly.
    "src/kernel/index.ts",
  ],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
  define: buildGitDefine(),
});
