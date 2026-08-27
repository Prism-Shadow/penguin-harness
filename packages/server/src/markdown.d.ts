/**
 * Markdown imported as text.
 *
 * The builtin registry inlines each backend package's own README.md rather than keeping a
 * second copy of the prose (see extension/builtin-readmes.ts). esbuild's `text` loader —
 * configured in tsup.config.ts for the bundle and mirrored by a transform in
 * vitest.config.ts — turns such an import into a string; this declaration is what tells
 * `tsc` the same thing.
 */
declare module "*.md" {
  const content: string;
  export default content;
}
