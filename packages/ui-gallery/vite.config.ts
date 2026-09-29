/**
 * Vite config: the component gallery (React SPA + Tailwind CSS 4), a local dev tool.
 *
 * `@prismshadow/penguin-ui` resolves to the live `packages/ui/src` through the workspace link;
 * `penguinUi()` emits the bundled fonts' licence texts beside a build (imported by relative path,
 * see its doc comment). Port 7372 is fixed and strict: screenshot runs and
 * quoted feedback links name it, so a silently shifted port would point them at the wrong server.
 * BASE_PATH lets a static build be served under a subpath (the docs site's precedent).
 *
 * The demos, screens and fixtures live in `packages/ui/src`, outside this Vite root, which the dev
 * server's file watcher does not cover by default — so a newly added `*.demo.tsx` would reach
 * neither the demo glob nor Tailwind's class scan until a restart. The plugin below watches it.
 * The vitest config stays separate (vitest's embedded vite types conflict with vite 7's).
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { penguinUi } from "../ui/src/vite-plugin";

function watchPackageSource(): Plugin {
  const uiSrc = fileURLToPath(new URL("../ui/src/", import.meta.url));
  const stylesheet = fileURLToPath(new URL("./src/styles.css", import.meta.url));
  return {
    name: "penguin:gallery-watch-ui",
    configureServer(server) {
      server.watcher.add(uiSrc);
      // Tailwind rescans a stylesheet's sources only when that stylesheet is transformed again, and
      // a file added outside the Vite root does not trigger that — the new demo would render
      // without its utility classes until a restart. Invalidate the stylesheet and reload instead.
      server.watcher.on("add", (file) => {
        if (!file.startsWith(uiSrc) || !/\.(tsx?|css)$/.test(file)) return;
        for (const mod of server.moduleGraph.getModulesByFile(stylesheet) ?? []) {
          server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss(), penguinUi(), watchPackageSource()],
  // Never inline a font, as in the web app: a small slice would otherwise sit in the stylesheet as
  // a data: URI, whatever theme is shown.
  build: { assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined) },
  // Fixed PenguinHarness dev port; the allocation table lives in core's internal/ports.ts.
  server: { port: 7372, strictPort: true },
  preview: { port: 7372, strictPort: true },
});
