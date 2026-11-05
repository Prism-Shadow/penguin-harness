/**
 * The highlighter a public site hands its articles: the app's engine (`highlighter-core`, the
 * pure-JS Shiki core with both themes baked into one pass), run on the main thread and loaded on
 * the first block that needs it. A site's pages are short and static, so the Web App's worker
 * would cost more than it saves. Like every code surface in the package, `SiteCodeBlock` never
 * imports the engine; the host passes this (or any `CodeHighlighter`) to `SiteMarkdown`.
 */
import type { CodeHighlighter } from "../content/code-block/highlight-options";

export type { CodeHighlighter } from "../content/code-block/highlight-options";

export const highlightSiteCode: CodeHighlighter = (code, language, options) =>
  import("../content/code-block/highlighter-core").then(({ highlight }) =>
    highlight(code, language, options),
  );
