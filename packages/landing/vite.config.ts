/**
 * Vite config: static landing page (React SPA + Tailwind CSS 4).
 *
 * BASE_PATH is injected by the GitHub Pages workflow (e.g. "/penguin-harness/") so asset
 * URLs resolve under the project-pages subpath; local dev and previews default to "/".
 * Blog posts are local Markdown files imported at build time via import.meta.glob (?raw),
 * so the built site is fully static — no server or CMS involved.
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  server: { port: 7366 },
});
