/**
 * The shared UI package's accessibility fallbacks in the app's words. The package never reads the
 * app's dictionaries; `LocaleProvider` hands it these instead, per interface language, so a close
 * cross or a "Copied" announcement speaks the language the rest of the page does.
 *
 * Each value is read from the dictionary itself rather than from the live `S`, so the two objects
 * are built once and keep their identity across renders.
 */
import type { UiStrings } from "@prismshadow/penguin-ui";
import { zh } from "./strings";
import type { Strings } from "./strings";
import { en } from "./strings-en";

/** One dictionary's words for every `UiStrings` key. */
export function uiStringsOf(dict: Strings): UiStrings {
  return {
    close: dict.common.close,
    copied: dict.common.copied,
    loading: dict.common.loading,
    showPassword: dict.auth.showPassword,
    hidePassword: dict.auth.hidePassword,
    clearSearch: dict.chat.searchClear,
    moreInfo: dict.common.moreInfo,
    moreInfoAbout: dict.common.moreInfoAbout,
    notifications: dict.common.notifications,
    dismiss: dict.common.dismiss,
    copyCode: dict.chat.copyCode,
  };
}

const UI_STRINGS = { zh: uiStringsOf(zh), en: uiStringsOf(en) } as const;

/** The package's words for an interface language. */
export function uiStringsFor(locale: "zh" | "en"): UiStrings {
  return UI_STRINGS[locale];
}
