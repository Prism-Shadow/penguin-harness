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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Fixed PenguinHarness dev port (stands alone — vite configs cannot import core TS,
    // so the numbers are literals here; the allocation table lives in core's internal/ports.ts).
    port: 7365,
    proxy: {
      "/api": {
        target: process.env.PENGUIN_API_PROXY ?? `http://127.0.0.1:${process.env.PORT ?? "7368"}`,
        changeOrigin: false,
      },
    },
  },
});
