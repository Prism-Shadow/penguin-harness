/**
 * Which language a reply is written in: the text fallback words its blocks in it, and the checker
 * prints its rubric in it. The reply's own text decides — the lines outside fences, with inline
 * code and bare URLs taken out, since neither is the language the reader reads.
 */
import { fenceLineSet, scanFences, splitLines } from "./fences.js";
import type { A2uiLang, A2uiLangOption } from "./types.js";

const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu;
const LATIN = /\p{Script=Latin}/gu;

/** zh when CJK characters are at least half as many as Latin letters outside the fences. */
export function detectLang(markdown: string): A2uiLang {
  const fenced = fenceLineSet(scanFences(markdown));
  const text = splitLines(markdown)
    .filter((_, i) => !fenced.has(i + 1))
    .join(" ")
    .replace(/`+[^`]*`+/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  return cjk > 0 && cjk * 2 >= latin ? "zh" : "en";
}

/** The language asked for, or the reply's own when the option is `auto` or missing. */
export function resolveLang(markdown: string, lang?: A2uiLangOption): A2uiLang {
  return lang !== undefined && lang !== "auto" ? lang : detectLang(markdown);
}
