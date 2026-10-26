import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  // One target for every package here (packages/cli/test/tsup-target.test.ts), matching
  // engines.node. Current browsers parse the syntax Node 24 does.
  target: "node24",
  sourcemap: true,
};

const browserDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist", "browser");

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      // The records: the envelope, every payload, their guards and builders. Core re-exports
      // this entry and the markers from its root.
      records: "src/records/index.ts",
      // The message markers' producers and parsers.
      markers: "src/markers/index.ts",
    },
    // The package runs in Node 24 and in browsers: nothing Node-specific is resolved or injected,
    // and it has no runtime dependency to bundle.
    platform: "neutral",
    dts: true,
    // The two builds run side by side: each cleans its own output only.
    clean: ["!browser/**"],
  },
  {
    ...shared,
    // The browser build: the root entry as one ES module with nothing to resolve, for a page to
    // import by URL (the server serves it to Workbench pages).
    entry: { amsp: "src/index.ts" },
    outDir: "dist/browser",
    platform: "browser",
    splitting: false,
    dts: false,
    clean: true,
    // The same module as a string (`@prismshadow/amsp/browser-source`), for a server that hands
    // it to pages. A server that is bundled into one file (the desktop app, a hot-pushed build)
    // carries no node_modules to read `amsp.js` from, but a bundler inlines an import; so the
    // bytes travel as one, written from the file just built so the two never differ. Its types
    // are the committed browser-source.d.ts: the declaration build above removes every .d.ts
    // under dist/ when it starts, which can be after this has run.
    onSuccess: async () => {
      const code = await fs.readFile(path.join(browserDir, "amsp.js"), "utf8");
      await fs.writeFile(
        path.join(browserDir, "source.js"),
        `/** dist/browser/amsp.js, the browser build, as text. */\nexport const BROWSER_SOURCE = ${JSON.stringify(code)};\n`,
      );
    },
  },
]);
