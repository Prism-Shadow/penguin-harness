/**
 * Builds the pet page's document script — `ui/widget.ts` — into `ui/dist/widget.js`, the file
 * widget.html loads. Same target the dialog bundle's build uses: a module a modern browser runs
 * (the frame is the app's own Chromium/WebKit), a stable unhashed name, no `clean` — the dialog
 * build has just emptied `ui/dist/` and written its own two files beside which this one lands.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["ui/widget.ts"],
  format: ["esm"],
  target: "es2022",
  outDir: "ui/dist",
  clean: false,
});
