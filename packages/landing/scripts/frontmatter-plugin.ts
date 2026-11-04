/**
 * The Vite plugin behind the blog index: an import of `<post>.md?frontmatter` is the post's
 * frontmatter record (`{ title, date, … }`), parsed at build time, so the list and the home page
 * read every post's metadata without shipping a single post body.
 *
 * The parse is the shared `parseFrontmatter`, the same one the post page and the content tests
 * use. It is imported by relative path: Vite bundles a config's relative imports, while a bare
 * `@prismshadow/penguin-ui/site` would be left for Node to load from TypeScript source.
 *
 * Shared by the Vite config and the vitest config, so the tests read the same index the site
 * does. The transform needs no plugin context, which keeps it structurally valid for both
 * configs' plugin types.
 */
import { parseFrontmatter } from "../../ui/src/components/site/markdown-text";

const FRONTMATTER_IMPORT = /\.md\?frontmatter$/;

export function blogFrontmatter(): {
  name: string;
  enforce: "pre";
  transform: (code: string, id: string) => { code: string; map: null } | null;
} {
  return {
    name: "penguin:blog-frontmatter",
    enforce: "pre",
    transform: (code, id) =>
      FRONTMATTER_IMPORT.test(id)
        ? { code: `export default ${JSON.stringify(parseFrontmatter(code).meta)};`, map: null }
        : null,
  };
}
