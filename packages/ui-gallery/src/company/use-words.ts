/** The prototype's words in the framed app's language. */
import { useLocale } from "../../../web/src/state/locale";
import { zh } from "./words";
import type { Words } from "./words";
import { en } from "./words-en";

export function useWords(): Words {
  return useLocale().locale === "zh" ? zh : en;
}
