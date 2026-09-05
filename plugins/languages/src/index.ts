/**
 * @prismshadow/penguin-plugin-languages — syntax highlighting for five more languages.
 *
 * A PLUGIN PACKAGE, not part of the harness: a deployment lists it in plugins.json and the
 * harness resolves it from the installation (see the server's plugin/loader.ts). It compiles
 * against the type-only `@prismshadow/penguin-core/plugin` surface and carries no runtime
 * dependency on the harness.
 *
 * The Web App resolves its bundled grammars at build time, so no install can grow that set.
 * What this package does instead is hand the server five TextMate grammars, which the App
 * fetches and loads into the same Shiki core as a bundled one (see the server's languages/
 * floor). A grammar is DATA — a document Shiki's JS regex engine interprets — so nothing on
 * that path evaluates anything shipped here.
 *
 * ## Why these five
 *
 * They are the largest ecosystems with no grammar in the App's bundled set, which carries the
 * languages a session most often shows and stops there deliberately: the full Shiki bundle costs
 * an oniguruma WASM chunk and a 332-grammar registry on the first code block of a conversation.
 * An extension is how a deployment pays that cost only for what it actually reads.
 *
 * ## Where the grammars come from
 *
 * `@shikijs/langs`, the same package the App's own grammars come from, so a grammar loaded here
 * is the exact document the bundled path would have loaded and is known to compile under the JS
 * regex engine. Each is re-exported, not re-authored — upstream attribution and licensing ride
 * with that package (MIT, with each grammar's own upstream notice).
 */
import csharp from "@shikijs/langs/csharp";
import dart from "@shikijs/langs/dart";
import kotlin from "@shikijs/langs/kotlin";
import swift from "@shikijs/langs/swift";
import typst from "@shikijs/langs/typst";
import type {
  LanguageContribution,
  LanguageGrammar,
  Plugin,
} from "@prismshadow/penguin-core/plugin";

/**
 * A `@shikijs/langs` module exports an ARRAY: a grammar plus whatever it embeds. These five
 * embed nothing, so each array holds exactly one document — asserted at registration rather
 * than assumed, because an upstream grammar that grows an embedded language would otherwise
 * silently register only its first half.
 */
type ShikiGrammar = { name: string; scopeName: string; aliases?: string[]; fileTypes?: string[] };

interface Contribution {
  displayName: string;
  /** Fence info strings beyond the id, and file extensions, where the grammar states neither. */
  aliases?: string[];
  extensions?: string[];
  bundle: readonly unknown[];
}

/**
 * The five, with the metadata the App needs BEFORE a grammar loads. Aliases and file types come
 * from the grammar itself where it declares them (`aliases`, `fileTypes`) and are stated here
 * only where it does not — Swift and Dart declare no aliases, and Typst declares no fileTypes.
 */
const CONTRIBUTIONS: Record<string, Contribution> = {
  typst: { displayName: "Typst", extensions: ["typ"], bundle: typst },
  swift: { displayName: "Swift", bundle: swift },
  kotlin: { displayName: "Kotlin", bundle: kotlin },
  csharp: { displayName: "C#", bundle: csharp },
  dart: { displayName: "Dart", extensions: ["dart"], bundle: dart },
};

/** Build one contribution: the metadata half, and the grammar the module binds. */
function toContribution(
  id: string,
  entry: Contribution,
): { data: LanguageContribution; grammar: LanguageGrammar } {
  if (entry.bundle.length !== 1) {
    throw new Error(
      `grammar bundle for ${id} holds ${entry.bundle.length} documents, expected exactly one`,
    );
  }
  const grammar = entry.bundle[0] as ShikiGrammar;
  if (grammar.name !== id) {
    // Shiki resolves a language by the grammar's own name; a mismatch would load a grammar the
    // App then cannot highlight with.
    throw new Error(`grammar for ${id} names itself ${grammar.name}`);
  }
  const aliases = [...new Set([...(grammar.aliases ?? []), ...(entry.aliases ?? [])])];
  const extensions = [...new Set([...(grammar.fileTypes ?? []), ...(entry.extensions ?? [])])];
  return {
    data: {
      language: id,
      displayName: entry.displayName,
      ...(aliases.length > 0 ? { aliases } : {}),
      ...(extensions.length > 0 ? { extensions } : {}),
    },
    grammar,
  };
}

/** Every language this package contributes. Exported so a test can assert the set directly. */
export function languageContributions(): Array<{
  id: string;
  data: LanguageContribution;
  grammar: LanguageGrammar;
}> {
  return Object.entries(CONTRIBUTIONS).map(([id, entry]) => ({
    id: `languages.${id}`,
    ...toContribution(id, entry),
  }));
}

/**
 * The plugin: one module, whose manifest is package.json#penguin.modules[0] (one entry per
 * language on the LanguagesModule.grammars slot); this default export binds each grammar by
 * that contribution id. Created per App, so a hot swap gets the grammars of the plugins the
 * push actually carried.
 */
const plugin: Plugin = {
  modules: {
    Languages: {
      create: () => ({
        api: {},
        bind: Object.fromEntries(languageContributions().map((c) => [c.id, c.grammar])),
      }),
    },
  },
};
export default plugin;
