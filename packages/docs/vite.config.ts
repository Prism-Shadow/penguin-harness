/**
 * Vite config: static docs site (React SPA + Tailwind CSS 4), a sibling of the
 * landing page but its own package so either site can evolve independently.
 *
 * BASE_PATH is injected by the GitHub Pages workflow as "/docs/" (the site lives at the
 * custom apex domain https://penguin.ooo/) — the docs build is copied into the landing
 * dist under docs/ so both sites ship as one Pages artifact (see scripts/build-site.mjs
 * at the repo root). Local dev defaults to "/".
 * Doc pages are local Markdown files imported at build time via import.meta.glob
 * (?raw), so the built site is fully static — no server or CMS involved.
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  // Fixed PenguinHarness dev port (stands alone — only the main server default is
  // shared, as DEFAULT_SERVER_PORT in core; vite configs cannot import core TS).
  server: { port: 7367 },
});
