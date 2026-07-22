/**
 * Vite config: React SPA + Tailwind CSS 4.
 *
 * Dev server listens on 7365; `/api` is proxied to the local Web server (defaults to 127.0.0.1:7364,
 * overridable via PENGUIN_API_PROXY). SSE (text/event-stream) passes through http-proxy transparently, no
 * special config needed.
 * The vitest config is kept separate in vitest.config.ts (its embedded vite 5 types conflict with this
 * package's vite 7 plugin types, hence the separate file to avoid the clash).
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Fixed PenguinHarness dev port (stands alone — only the main server default is
    // shared, as DEFAULT_SERVER_PORT in core; vite configs cannot import core TS).
    port: 7365,
    proxy: {
      "/api": {
        target: process.env.PENGUIN_API_PROXY ?? "http://127.0.0.1:7364",
        changeOrigin: false,
      },
    },
  },
});
