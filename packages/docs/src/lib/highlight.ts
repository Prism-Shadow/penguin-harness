/**
 * Syntax highlighting for fenced code blocks, via Shiki.
 *
 * Built from `shiki/core` with only the languages this site actually writes, and with the
 * JavaScript RegExp engine rather than Oniguruma — that drops the WASM payload entirely,
 * and every grammar below was checked to highlight correctly under it. The highlighter is
 * created once, lazily, on the first code block: everything here lives behind a dynamic
 * import so it becomes its own chunk instead of weighing down the first paint.
 *
 * Both themes are baked into one output using Shiki's dual-theme CSS variables, so the
 * light/dark toggle is a CSS switch (see styles.css) and never re-highlights.
 */
import type { HighlighterCore } from "shiki/core";

/**
 * Grammar loaders, written out one static import each: Vite only rewrites a dynamic
 * import it can read literally, so `import(\`shiki/langs/${lang}.mjs\`)` would survive
 * into the browser as a bare specifier and throw at runtime.
 */
const LOADERS = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  json: () => import("shiki/langs/json.mjs"),
};

/** Fence language -> Shiki grammar. Anything absent renders unhighlighted. */
const GRAMMARS: Record<string, keyof typeof LOADERS> = {
  ts: "typescript",
  typescript: "typescript",
  bash: "shellscript",
  sh: "shellscript",
  shell: "shellscript",
  powershell: "powershell",
  ps1: "powershell",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  markdown: "markdown",
  json: "json",
  // Shiki has no JSON Lines grammar; each line is JSON, so the JSON one reads correctly.
  jsonl: "json",
};

let highlighter: Promise<HighlighterCore> | null = null;

function loadHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
      langs: Object.values(LOADERS).map((load) => load()),
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

/** Whether a fence language has a grammar — lets a caller skip the async path entirely. */
export function isHighlightable(language: string): boolean {
  return language.toLowerCase() in GRAMMARS;
}

/** Highlighted HTML for a fenced block, or null when the language has no grammar. */
export async function highlight(code: string, language: string): Promise<string | null> {
  const lang = GRAMMARS[language.toLowerCase()];
  if (!lang) return null;
  try {
    const shiki = await loadHighlighter();
    return shiki.codeToHtml(code, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
    });
  } catch {
    // A grammar that fails to load must not blank the page: fall back to plain text.
    return null;
  }
}
