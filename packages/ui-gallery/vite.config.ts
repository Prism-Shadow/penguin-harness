/**
 * Vite config: the component gallery (React SPA + Tailwind CSS 4), a local dev tool, plus the
 * framed Web App as a second page.
 *
 * Three documents come out of one build: `index.html`, the gallery site; `app.html`, the real
 * Web App mounted against an in-browser mock of its API (src/app); and `lib.html`, one component
 * library board made of the app's real components (src/library). The app's own source is
 * imported from `packages/web/src`; its network layer is swapped for the mock by
 * `mockWebNetwork()` (src/app/mock/vite-plugin.ts), and the two inline boot scripts — the
 * storage seed that gives a frame its own preferences, then the app's own pre-paint script,
 * generated from the package so neither can drift — are prepended to both framed documents at
 * serve and build time. The app's highlighting worker needs ES-format workers, as in the app's config,
 * and React is deduplicated so the app and the gallery never load two copies.
 *
 * `@prismshadow/penguin-ui` resolves to the live `packages/ui/src` through the workspace link;
 * `penguinUi()` emits the bundled fonts' licence texts beside a build. Port 7372 is fixed and
 * strict: screenshot runs and quoted feedback links name it. BASE_PATH lets a static build be
 * served under a subpath. The vitest config stays separate (vitest's embedded vite types
 * conflict with vite 7's).
 *
 * The package source and the app's live outside this Vite root, which the dev server's file
 * watcher does not cover by default; the plugin below watches both.
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { BOOT_SCRIPT } from "../ui/src/boot";
import { penguinUi } from "../ui/src/vite-plugin";
import { dropNonWoff2FontSources } from "../web/vite.config";
import { storageSeedScript } from "./src/app/frame";
import { mockWebNetwork } from "./src/app/mock/vite-plugin";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function watchPackageSources(): Plugin {
  const roots = [at("../ui/src/"), at("../web/src/")];
  const stylesheets = [
    at("./src/styles.css"),
    at("./src/app/app.css"),
    at("./src/library/library.css"),
  ];
  return {
    name: "penguin:gallery-watch-sources",
    configureServer(server) {
      for (const root of roots) server.watcher.add(root);
      // Tailwind rescans a stylesheet's sources only when that stylesheet is transformed again,
      // and a file added outside the Vite root does not trigger that — a new component would
      // render without its utility classes until a restart. Invalidate the sheets and reload.
      server.watcher.on("add", (file) => {
        if (!roots.some((root) => file.startsWith(root)) || !/\.(tsx?|css)$/.test(file)) return;
        for (const sheet of stylesheets) {
          for (const mod of server.moduleGraph.getModulesByFile(sheet) ?? []) {
            server.moduleGraph.invalidateModule(mod);
          }
        }
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}

/** The framed documents, which open with two inline scripts, in the order a frame needs them. */
const FRAME_DOCUMENTS = ["app.html", "lib.html"];

function frameDocument(): Plugin {
  const scripts = `${storageSeedScript()};${BOOT_SCRIPT}`;
  return {
    name: "penguin:gallery-frame-document",
    transformIndexHtml: {
      order: "pre",
      handler(_html, ctx) {
        if (!FRAME_DOCUMENTS.some((name) => ctx.filename.endsWith(name))) return;
        return [{ tag: "script", children: scripts, injectTo: "head-prepend" }];
      },
    },
  };
}

/** KaTeX's woff and truetype fallbacks stay out of the bundle, as in the app's own build. */
function katexWoff2Only(): Plugin {
  return {
    name: "penguin:katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/katex/dist/") || !id.includes(".css")) return null;
      const next = dropNonWoff2FontSources(code);
      return next === code ? null : { code: next, map: null };
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    mockWebNetwork(),
    react(),
    tailwindcss(),
    penguinUi(),
    katexWoff2Only(),
    frameDocument(),
    watchPackageSources(),
  ],
  resolve: { dedupe: ["react", "react-dom"] },
  build: {
    // Never inline a font, as in the web app: a small slice would otherwise sit in the
    // stylesheet as a data: URI, whatever theme is shown.
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
    rollupOptions: {
      input: { gallery: at("./index.html"), app: at("./app.html"), library: at("./lib.html") },
    },
  },
  worker: { format: "es" },
  // Fixed PenguinHarness dev port; the allocation table lives in core's internal/ports.ts.
  server: { port: 7372, strictPort: true },
  preview: { port: 7372, strictPort: true },
});
