/**
 * Which languages the code viewer can highlight, and how a fence info string or a file extension
 * resolves to one. Pure lookup tables — no Shiki import, so this is safe to pull into the main
 * bundle; the grammars themselves are behind the dynamic imports in LANGUAGE_LOADERS and only
 * materialize as separate chunks when highlighter.ts actually loads one.
 *
 * The list is explicit rather than "whatever Shiki bundles" because the full bundle costs an
 * oniguruma WASM chunk and a 332-grammar registry on the first code block of a conversation (see
 * highlighter.ts). Adding a language means a loader entry plus, where the grammar declares aliases
 * of its own, the alias rows that route a fence info string to it.
 */

/** Shiki resolves these without a grammar. Unmapped file extensions land here to get the themed background. */
const PLAIN_TEXT_IDS = new Set(["text", "plaintext", "txt"]);

/** Canonical Shiki language id -> grammar chunk. */
export const LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsx: () => import("@shikijs/langs/jsx"),
  log: () => import("@shikijs/langs/log"),
  markdown: () => import("@shikijs/langs/markdown"),
  php: () => import("@shikijs/langs/php"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
};

/**
 * Alias -> canonical id, mirroring the `aliases` each grammar declares. Shiki registers those
 * aliases itself, but only once the grammar is loaded — and the fence info string (```ts) is
 * exactly what decides which grammar to load, so the mapping has to exist beforehand. A Shiki
 * upgrade that adds an alias needs a row here, or that fence silently stops highlighting.
 */
export const LANGUAGE_ALIASES: Record<string, string> = {
  "c++": "cpp",
  bash: "shellscript",
  cjs: "javascript",
  cts: "typescript",
  js: "javascript",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  properties: "ini",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shellscript",
  shell: "shellscript",
  ts: "typescript",
  yml: "yaml",
  zsh: "shellscript",
};

/** File extension -> language id; anything unlisted is plain text with the theme's background. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  md: "markdown",
  py: "python",
  rb: "ruby",
  php: "php",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  sh: "shellscript",
  bash: "shellscript",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  conf: "ini",
  xml: "xml",
  sql: "sql",
  log: "log",
};

/** The id CodeBlock's `language` prop takes for an unhighlighted-but-themed block. */
export const PLAIN_TEXT_LANGUAGE = "text";

export function languageForExtension(ext: string): string {
  return LANGUAGE_BY_EXTENSION[ext.toLowerCase()] ?? PLAIN_TEXT_LANGUAGE;
}

/**
 * Fence info string / language prop -> the id to highlight with, or null when nothing here covers
 * it (the caller then renders the code unhighlighted). An empty language means an unannotated
 * fence, which renders as plain text rather than nothing.
 */
export function resolveLanguage(language: string): string | null {
  const id = language.trim().toLowerCase();
  if (!id || PLAIN_TEXT_IDS.has(id)) return PLAIN_TEXT_LANGUAGE;
  const canonical = LANGUAGE_ALIASES[id] ?? id;
  return canonical in LANGUAGE_LOADERS ? canonical : null;
}

/** True for ids Shiki highlights without loading a grammar. */
export function isPlainTextLanguage(id: string): boolean {
  return PLAIN_TEXT_IDS.has(id);
}
