/**
 * Vite config: React SPA + Tailwind CSS 4.
 *
 * Dev server listens on 7365; `/api` is proxied to the **development** backend (127.0.0.1:7368 --
 * `pnpm dev:server`, deliberately not the installed server's 7364, which is routinely running at the
 * same time). Honors PORT so overriding the backend port moves the proxy with it, and
 * PENGUIN_API_PROXY overrides the whole target. SSE (text/event-stream) passes through http-proxy
 * transparently, no special config needed.
 * The vitest config is kept separate in vitest.config.ts (its embedded vite 5 types conflict with this
 * package's vite 7 plugin types, hence the separate file to avoid the clash).
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

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
 * Drops the `woff` and `truetype` fallbacks from a KaTeX stylesheet, leaving each `@font-face` with
 * its woff2 source alone.
 *
 * KaTeX ships twenty faces in three formats and lists all three in every `src`, so Vite — which
 * emits an asset for each URL a stylesheet references — copies sixty font files into the bundle.
 * The forty non-woff2 ones are ~800KB that nothing can request: woff2 has been supported by every
 * browser this SPA runs in since 2016, and the desktop shell is Chromium. A browser somehow without
 * it now falls back to the `serif` at the end of KaTeX's own font stack rather than failing.
 *
 * Exported for the unit test: a silent miss here (a Vite id format change, a KaTeX release that
 * reorders `src`) costs bundle size without breaking anything, so nothing would otherwise notice.
 */
export function dropNonWoff2FontSources(css: string): string {
  return css.replace(/\s*,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, "");
}

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
  plugins: [react(), tailwindcss(), katexWoff2Only()],
  server: {
    // Fixed PenguinHarness dev port (stands alone — vite configs cannot import core TS,
    // so the numbers are literals here; the allocation table lives in core's internal/ports.ts).
    port: 7365,
    proxy: {
      "/api": {
        target: apiProxyTarget(),
        changeOrigin: false,
        // The terminal stream (/api/terminals/:id/stream) is a WebSocket upgrade; without
        // this the proxy answers the handshake itself and the terminal never connects.
        ws: true,
      },
    },
  },
});
