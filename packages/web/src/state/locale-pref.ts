/**
 * The interface-language preference as cached in this browser (the account's copy is the truth,
 * lib/account-sync). Apart from the provider (locale.tsx) so the sync table can name the key
 * without pulling in React and both dictionaries.
 */
export type LangPref = "zh" | "en" | "system";

export const LANG_KEY = "penguin.lang";

/** The cached preference; anything unknown or unreadable follows the system, the default. */
export function readLangPref(storage?: Pick<Storage, "getItem">): LangPref {
  try {
    const stored = (storage ?? localStorage).getItem(LANG_KEY);
    return stored === "zh" || stored === "en" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}
