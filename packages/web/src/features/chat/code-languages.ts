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
 *
 * The tables are Maps, not objects: the keys are file extensions and fence info strings, and a
 * plain object would resolve `constructor` or `__proto__` through Object.prototype to a function or
 * an object where a language id is expected (React throws when that reaches a text node).
 *
 * Extensions add languages on top of these tables at RUNTIME (see registerRuntimeLanguages): the
 * bundled set is resolved by the bundler and cannot grow by installing anything, so a contributed
 * grammar arrives from the server instead and is registered here before its first fence is met.
 */

/** Shiki resolves these without a grammar. Unmapped file extensions land here to get the themed background. */
const PLAIN_TEXT_IDS = new Set(["text", "plaintext", "txt"]);

/** Canonical Shiki language id -> grammar chunk. */
export const LANGUAGE_LOADERS = new Map<string, () => Promise<unknown>>(
  Object.entries({
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
  }),
);

/**
 * Alias -> canonical id, mirroring the `aliases` each grammar declares. Shiki registers those
 * aliases itself, but only once the grammar is loaded — and the fence info string (```ts) is
 * exactly what decides which grammar to load, so the mapping has to exist beforehand. A Shiki
 * upgrade that adds an alias needs a row here, or that fence silently stops highlighting.
 */
export const LANGUAGE_ALIASES = new Map(
  Object.entries({
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
  }),
);

/** File extension -> language id; anything unlisted is plain text with the theme's background. */
const LANGUAGE_BY_EXTENSION = new Map(
  Object.entries({
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
  }),
);

/** The id CodeBlock's `language` prop takes for an unhighlighted-but-themed block. */
export const PLAIN_TEXT_LANGUAGE = "text";

export function languageForExtension(ext: string): string {
  const key = ext.toLowerCase();
  return LANGUAGE_BY_EXTENSION.get(key) ?? RUNTIME_BY_EXTENSION.get(key) ?? PLAIN_TEXT_LANGUAGE;
}

/**
 * Fence info string / language prop -> the id to highlight with, or undefined when nothing here
 * covers it (the caller then renders the code unhighlighted). An empty language means an
 * unannotated fence, which renders as plain text rather than nothing.
 */
export function resolveLanguage(language: string): string | undefined {
  const id = language.trim().toLowerCase();
  if (!id || PLAIN_TEXT_IDS.has(id)) return PLAIN_TEXT_LANGUAGE;
  const canonical = LANGUAGE_ALIASES.get(id) ?? RUNTIME_ALIASES.get(id) ?? id;
  if (LANGUAGE_LOADERS.has(canonical)) return canonical;
  return RUNTIME_LANGUAGES.has(canonical) ? canonical : undefined;
}

/** True for ids Shiki highlights without loading a grammar. */
export function isPlainTextLanguage(id: string): boolean {
  return PLAIN_TEXT_IDS.has(id);
}

// ---------------------------------------------------------------------------
// Languages contributed by extensions
// ---------------------------------------------------------------------------

/** One language the server reported (GET /api/languages); the grammar is fetched per id. */
export interface RuntimeLanguage {
  id: string;
  displayName: string;
  aliases?: string[];
  extensions?: string[];
}

/**
 * Registered languages, by canonical id. A separate table from LANGUAGE_LOADERS rather than an
 * insertion into it: the bundled entries are dynamic imports the bundler resolved, these are
 * URLs the browser fetches, and highlighter.ts loads them by different means.
 */
const RUNTIME_LANGUAGES = new Map<string, RuntimeLanguage>();
const RUNTIME_ALIASES = new Map<string, string>();
const RUNTIME_BY_EXTENSION = new Map<string, string>();

/** Bumped on every registration; CodeBlock subscribes so a block already on screen re-highlights. */
let runtimeGeneration = 0;
const listeners = new Set<() => void>();

/**
 * Adopt the languages the server reported. Replaces the previous set rather than merging: the
 * listing is the whole truth about what this App offers, and an extension removed by a hot push
 * has to stop being offered.
 *
 * A bundled id always wins a collision. The bundled grammar is the one whose chunk is already
 * built and tested against this Shiki version; letting an extension shadow `typescript` would
 * trade that for whatever it shipped, silently.
 */
export function registerRuntimeLanguages(languages: readonly RuntimeLanguage[]): void {
  RUNTIME_LANGUAGES.clear();
  RUNTIME_ALIASES.clear();
  RUNTIME_BY_EXTENSION.clear();
  for (const language of languages) {
    const id = language.id.trim().toLowerCase();
    if (id === "" || LANGUAGE_LOADERS.has(id) || PLAIN_TEXT_IDS.has(id)) continue;
    RUNTIME_LANGUAGES.set(id, language);
    for (const alias of language.aliases ?? []) {
      const key = alias.trim().toLowerCase();
      if (key !== "" && !LANGUAGE_ALIASES.has(key) && !LANGUAGE_LOADERS.has(key)) {
        RUNTIME_ALIASES.set(key, id);
      }
    }
    for (const ext of language.extensions ?? []) {
      const key = ext.trim().toLowerCase().replace(/^\./, "");
      if (key !== "" && !LANGUAGE_BY_EXTENSION.has(key)) RUNTIME_BY_EXTENSION.set(key, id);
    }
  }
  runtimeGeneration += 1;
  for (const listener of listeners) listener();
}

/** Subscribe to registrations (useSyncExternalStore's contract). Returns the unsubscribe. */
export function subscribeToRuntimeLanguages(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current generation — the snapshot half of useSyncExternalStore. */
export function runtimeLanguageGeneration(): number {
  return runtimeGeneration;
}

/** True when `id` is one an extension contributed, so highlighter.ts fetches its grammar. */
export function isRuntimeLanguage(id: string): boolean {
  return RUNTIME_LANGUAGES.has(id);
}

/** Every registered language, for a picker or a test. */
export function runtimeLanguages(): RuntimeLanguage[] {
  return [...RUNTIME_LANGUAGES.values()];
}
