/**
 * The languages of one App: what plugins contributed through `LanguagesModule.grammars`.
 *
 * A node of the tree rather than a module singleton, for the reason every other plugin floor
 * is one: a hot swap builds a new App from the manifests it loaded then, so a language whose
 * plugin a push removed stops being served instead of lingering until the process restarts.
 *
 * The metadata is the contribution's static half and the grammar its code half, so the listing
 * can be answered without touching a grammar — tens to hundreds of kilobytes each.
 */
import {
  Interface,
  Module,
  Provide,
  type ClassCtx,
  type Slot,
} from "@prismshadow/penguin-core/kernel";
import type { LanguageContribution, LanguageGrammar } from "@prismshadow/penguin-core/plugin";
import type { LanguageSummary } from "../api/types.js";

export interface LanguagesSlots {
  /** One language: its metadata here, its TextMate grammar bound by the contributor. */
  grammars: Slot<LanguageContribution, LanguageGrammar>;
}

export class LanguageService {
  private readonly languages = new Map<
    string,
    { summary: LanguageSummary; grammar: LanguageGrammar }
  >();

  constructor(
    contributed: ReadonlyArray<{ data: LanguageContribution; grammar: LanguageGrammar }>,
  ) {
    for (const { data, grammar } of contributed) {
      const id = data.language.trim();
      if (id === "") continue;
      // Last contribution wins rather than a duplicate error: two plugins offering the same
      // language is an operator's configuration, not a bug the server should refuse to boot over.
      this.languages.set(id, {
        summary: {
          id,
          displayName: data.displayName,
          ...(data.aliases === undefined ? {} : { aliases: data.aliases }),
          ...(data.extensions === undefined ? {} : { extensions: data.extensions }),
        },
        grammar,
      });
    }
  }

  /** The listing: no grammars, so the response stays small however many languages there are. */
  list(): LanguageSummary[] {
    return [...this.languages.values()]
      .map((l) => l.summary)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** One language's grammar, or null when nothing is contributed under that id. */
  grammar(id: string): LanguageGrammar | null {
    return this.languages.get(id)?.grammar ?? null;
  }
}

/** Languages: the mechanism LanguageService implements. */
export abstract class Languages extends Interface<{
  list(): LanguageSummary[];
  grammar(id: string): unknown | null;
}>() {}

@Module({})
export class LanguagesModule {
  @Provide() languages!: Languages;
  setup({ contributions }: ClassCtx) {
    this.languages = new LanguageService(
      (contributions.grammars ?? []).map((c) => ({
        data: c.data as unknown as LanguageContribution,
        grammar: c.code as LanguageGrammar,
      })),
    );
  }
}
