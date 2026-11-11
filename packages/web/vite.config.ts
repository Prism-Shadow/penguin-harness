/**
 * Vite config: React SPA + Tailwind CSS 4.
 *
 * Dev server listens on 7365; `/api` and a machine's `/server/<machineId>/api` are proxied to the
 * **development** backend (127.0.0.1:7368 -- `pnpm dev:server`, deliberately not the installed
 * server's 7364, which is routinely running at the same time). Honors PORT so overriding the backend
 * port moves the proxy with it, and PENGUIN_API_PROXY overrides the whole target. SSE
 * (text/event-stream) passes through http-proxy transparently, no special config needed.
 * The vitest config is kept separate in vitest.config.ts (its embedded vite 5 types conflict with this
 * package's vite 7 plugin types, hence the separate file to avoid the clash).
 *
 * `penguinUi()` emits the licence texts of the shared UI package's bundled fonts beside the build
 * (`fonts-licenses/`) and copies the package's built Workbench runtime in as `workbench-runtime/`,
 * which the server serves to TSX Workbench pages: build `@prismshadow/penguin-ui` before this
 * package. It is imported by relative path on purpose — see its module doc.
 *
 * The dev server sends the server's page Content-Security-Policy (`WEB_APP_CSP`, imported by
 * relative path from the server's dependency-free `http/page-csp.ts`, which the config bundle
 * inlines), so the two cannot drift.
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { dropNonWoff2FontSources, penguinUi } from "../ui/src/vite-plugin";
import { WEB_APP_CSP } from "../server/src/http/page-csp";

/**
 * Resolves the `/api` proxy target: PENGUIN_API_PROXY replaces it outright, otherwise the
 * development backend on PORT — the same variable `pnpm dev:server` binds — defaulting to 7368.
 *
 * Empty counts as unset, as everywhere else PORT is read in this repo (server/src/config.ts,
 * cli/src/commands/serve.ts, scripts/run-with-env.mjs). Here `??` would be actively harmful: an
 * exported-but-empty `PORT=` yields `http://127.0.0.1:` — port 80 — and every /api call would be
 * answered by whatever happens to listen there, silently and without an error, which is the exact
 * wrong-backend failure this default exists to prevent.
 *
 * Takes the environment as an argument so the resolution can be unit-tested (a vite config's
 * `server.proxy` cannot be exercised without starting a dev server).
 */
export function apiProxyTarget(env: Record<string, string | undefined> = process.env): string {
  return env.PENGUIN_API_PROXY || `http://127.0.0.1:${env.PORT || "7368"}`;
}

/**
 * The calls the page addresses to one machine, `/server/<machineId>/api/…`
 * (src/lib/server-context.ts). The backend forwards them to that machine; the dev server only has
 * to hand them on. Without this entry Vite answered them itself: a GET came back as the SPA's
 * index.html with status 200 and anything else as an empty 404, so every request to a machine
 * failed with an unparseable answer under `pnpm dev` and nowhere else.
 *
 * A pattern rather than the `/server/` prefix, so that only API paths are taken from the SPA.
 */
export const MACHINE_API_PATH = "^/server/[^/]+/api(?:/|$)";

/**
 * The dev server's proxy table: the backend's own API, and its API for each machine. Takes the
 * environment as an argument for the same reason {@link apiProxyTarget} does.
 */
export function devProxy(env: Record<string, string | undefined> = process.env) {
  const target = apiProxyTarget(env);
  return {
    "/api": {
      target,
      changeOrigin: false,
      // The terminal stream (/api/terminals/:id/stream) is a WebSocket upgrade; without
      // this the proxy answers the handshake itself and the terminal never connects.
      ws: true,
    },
    [MACHINE_API_PATH]: { target, changeOrigin: false },
  };
}

// The gallery's config and this package's tests import it from here.
export { dropNonWoff2FontSources };

/**
 * Applies {@link dropNonWoff2FontSources} to KaTeX's stylesheet before Vite resolves the `url()`s
 * in it into emitted assets, which is what `enforce: "pre"` buys — by the time the `vite:css`
 * transform runs, the fallback URLs must already be gone or their files are copied regardless.
 */
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
  plugins: [penguinUi({ workbenchRuntime: true }), react(), tailwindcss(), katexWoff2Only()],
  // The module classes (`module.ts`, web-root.ts) use standard decorators, which no browser
  // runs yet. The production build lowers them for its browser target; the dev server
  // transforms for `esnext` by default and would pass them through as a syntax error.
  esbuild: { target: "es2022" },
  build: {
    // Never inline a font. Vite turns any asset under 4 KB into a data: URI, and a font slice the
    // stylesheet references would then ride inside the one render-blocking CSS file for every
    // session, whatever its theme. As its own file it is fetched only when some text needs it.
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
  },
  // The highlighting worker loads its themes and each grammar with a dynamic import, so its
  // bundle has to be code-split — and Vite's default worker format, IIFE, cannot be. Without this
  // the build fails outright rather than shipping something subtly wrong, which is the good case.
  worker: { format: "es" },
  server: {
    // Fixed PenguinHarness dev port (stands alone — vite configs cannot import core TS,
    // so the numbers are literals here; the allocation table lives in core's internal/ports.ts).
    port: 7365,
    // Cross-origin requests to /api are the server's to answer, not Vite's: the Chrome extension
    // pairs from its own chrome-extension:// origin through this port, and Vite's default CORS
    // rule (localhost pages only) answered its preflight itself and refused it, so the request
    // never reached the server's pairing route. Off, the preflight is proxied like everything else.
    cors: false,
    // The server's page policy, so a violation shows during development, not first in a build.
    headers: { "Content-Security-Policy": WEB_APP_CSP },
    proxy: devProxy(),
  },
});
