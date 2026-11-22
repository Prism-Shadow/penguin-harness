/**
 * The Content-Security-Policy of the Web App's own page: every HTML document the static host
 * serves (`index.html` and each SPA-fallback answer, src/app.ts), and the dev server's pages
 * (packages/web/vite.config.ts imports this file by relative path, so the two cannot drift).
 *
 * Defence in depth for theme packs and any stylesheet that gets injected. An imported pack is
 * CSS and fonts that run in every browser that picks it; the pack validator is the gate, and
 * this only narrows what such a stylesheet could still load:
 *
 * - `font-src 'self' data:`: fonts from this origin (the bundled faces, a pack's files) or
 *   inline; a stylesheet cannot hand the font engine a file from another host.
 * - `style-src 'self' 'unsafe-inline'`: stylesheets from this origin; inline `<style>` and
 *   `style` attributes stay allowed, since the highlighter, Mermaid, xterm and the boot
 *   script's wallpaper all write them.
 * - `object-src 'none'`: no plugin content.
 * - `base-uri 'self'`: an injected `<base>` cannot re-point the page's relative URLs elsewhere.
 *
 * Deliberately absent:
 *
 * - `img-src`, because the chat renders remote images (and a stylesheet's `background-image`
 *   rides on it, which is why the validator, not this header, closes that leak).
 * - `script-src` and `default-src`: a script policy needs its own audit — the boot script is
 *   inline, and Workbench frames and the built-in browser have to keep working.
 *
 * Scope: a response header governs only the document it arrives with. Workbench pages, plugin
 * pages and Workspace previews are documents with their own responses, and this policy does
 * not reach them. A frame with no response of its own (`srcdoc`, `about:blank`, `blob:`)
 * inherits it, by the browser's rules.
 */
export const WEB_APP_CSP =
  "font-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'";
