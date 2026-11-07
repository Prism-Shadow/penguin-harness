/**
 * Builds the pet's dialog — `ui/src/panel.tsx` and its sheet — into `ui/dist/panel.js` +
 * `ui/dist/panel.css`, the two files widget.js fetches the first time the dialog is opened.
 *
 * A library build with the runtime bundled in: the plugin's `ui/` is a directory of static files
 * the server serves as they are (http/routes/plugin-ui.ts), so React and the shared UI package
 * have to travel inside the bundle rather than be resolved at run time. React is therefore a
 * devDependency of this package, never a runtime one — a builtin plugin may declare no runtime
 * dependency but a native module (scripts/build-plugins.mjs).
 *
 * The entry file names are stable and unhashed on purpose: widget.js names them itself
 * (`import("./dist/panel.js")`), and every file under `ui/` is cached for good under the
 * `?v=<stamp>` the server puts on the document's URL.
 *
 * `penguinUi()` — the package's Vite plugin that emits the bundled fonts' licences — is not
 * called here: this sheet loads no font files (the theme's system stacks are what it draws with),
 * so there are no font licences to carry beside it.
 */
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // `vite build` is run from the package directory, but everything below is relative to this
  // file's own (ui/): one root, whichever directory it is started from.
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tailwindcss()],
  // .tsx is compiled by esbuild; the runtime transform is the one React 19 needs, and no Babel
  // pass is wanted in a production library build.
  esbuild: { jsx: "automatic" },
  build: {
    lib: {
      entry: "src/panel.tsx",
      formats: ["es"],
      fileName: "panel",
      cssFileName: "panel",
    },
    outDir: "dist",
    emptyOutDir: true,
    // A module a modern browser runs: the frame is the app's own Chromium/WebKit, never an
    // older guest.
    target: "es2022",
    rollupOptions: {
      output: {
        // A stable file name (no content hash): the URL is what widget.js imports, and the
        // `?v=` stamp — not the name — is what makes the file cacheable for good.
        entryFileNames: "[name].js",
        // React's and the UI package's licence texts stay in the bundle.
        legalComments: "inline",
      },
    },
  },
});
