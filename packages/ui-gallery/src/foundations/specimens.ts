/**
 * Specimen text for the Foundations boards and `/fonts`, from the package fixtures' type specimens
 * (the "Build a Claude Code docs expert" session the product screenshots use). Both languages
 * render regardless of the chrome language where a board sets them side by side — CJK legibility
 * is judged in every theme.
 */
import { FIXTURES } from "../../../ui/src/fixtures";
import type { TypeSpecimens } from "../../../ui/src/fixtures";

export interface Specimen extends TypeSpecimens {
  /** A dense UI line (the fixtures' `ui`), named for where the old pages used it. */
  short: string;
}

const specimen = (lang: "en" | "zh"): Specimen => ({
  ...FIXTURES[lang].specimens,
  short: FIXTURES[lang].specimens.ui,
});

export const SPECIMENS: Readonly<Record<"en" | "zh", Specimen>> = {
  en: specimen("en"),
  zh: specimen("zh"),
};
