/**
 * A plugin's UI copy: its own `zh` and `en` tables, read through a live view that follows the
 * Web App's language.
 *
 * The Web App's dictionary is a live binding swapped on a language change, after which the whole
 * tree remounts (packages/web/src/state/locale.tsx); the same call tells this module the new
 * language (`setWebLocale`), so a plugin's table read at render time is always in the language
 * on screen. Type the `en` table by the `zh` one (`const en: typeof zh = …`), as the Web App's
 * two dictionaries do: a key missing on one side, or a function that changed its parameters, is a
 * type error rather than a gap at runtime.
 *
 * A table may carry `apiErrors`: the plugin's own error codes and their words. The Web App's
 * `apiErrorText` reads its own code table first and these after it, so an error a plugin's
 * routes answer with is said in the user's language wherever the app shows it.
 */

export type WebLocale = "zh" | "en";

let locale: WebLocale = "zh";

/** The language on screen. */
export function webLocale(): WebLocale {
  return locale;
}

/** The Web App's side: called with every dictionary switch. */
export function setWebLocale(next: WebLocale): void {
  locale = next;
}

type CodeTexts = Readonly<Record<string, string>>;

const errorTables: Array<Readonly<Record<WebLocale, CodeTexts>>> = [];

/** The Web App's side: a plugin's words for `code` in the language on screen, if any table has them. */
export function contributedErrorText(code: string): string | undefined {
  for (const table of errorTables) {
    const text = table[locale][code];
    if (text !== undefined) return text;
  }
  return undefined;
}

/**
 * The live view of a plugin's tables: every property read answers from the table of the language
 * on screen. Read it at render time; a value copied out at load time keeps that moment's language.
 */
export function defineStrings<T extends { apiErrors?: CodeTexts }>(tables: {
  zh: T;
  en: NoInfer<T>;
}): T {
  const { zh, en } = tables;
  if (zh.apiErrors !== undefined && en.apiErrors !== undefined) {
    errorTables.push({ zh: zh.apiErrors, en: en.apiErrors });
  }
  const current = (): T => (locale === "en" ? en : zh);
  return new Proxy(zh, {
    get: (_target, key) => Reflect.get(current(), key),
    has: (_target, key) => Reflect.has(current(), key),
  });
}
