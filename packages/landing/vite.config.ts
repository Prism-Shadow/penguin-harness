/**
 * Vite config: static landing page (React SPA + Tailwind CSS 4).
 *
 * BASE_PATH is injected by the GitHub Pages workflow ("/" — the site is served from the
 * custom apex domain https://penguin.ooo/); local dev and previews also default to "/".
 * Blog posts are local Markdown files read at build time, so the built site is fully static — no
 * server or CMS involved. Their frontmatter becomes the blog index in the main bundle
 * (`blogFrontmatter`, scripts/frontmatter-plugin.ts); each body is a chunk of its own, loaded
 * when its post is opened (src/lib/blog.ts).
 *
 * The home page frames the component gallery at `/gallery/`, which only the assembled site
 * serves. In dev, `/gallery/` is passed through to the gallery's own dev server, run under that
 * base beside this one (`BASE_PATH=/gallery/ pnpm dev:gallery`; see README).
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { blogFrontmatter } from "./scripts/frontmatter-plugin";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [blogFrontmatter(), react(), tailwindcss()],
  // Fixed PenguinHarness dev ports (stand alone — only the main server default is
  // shared, as DEFAULT_SERVER_PORT in core; vite configs cannot import core TS): this
  // server's, and the gallery's, whose frames the home page shows.
  server: {
    port: 7366,
    proxy: { "/gallery/": { target: "http://localhost:7372", ws: true } },
  },
  // Preview serves the assembled site, whose gallery is in dist/gallery: no pass-through (the
  // preview server would otherwise inherit the dev one's).
  preview: { proxy: {} },
});
