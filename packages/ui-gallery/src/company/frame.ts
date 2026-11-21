/**
 * The framed prototype's contract with the page around it, pure, so it is unit-tested. The
 * document is `company.html`; like the framed app it takes its theme, mode and language from the
 * URL (app/frame.ts seeds them into its own storage), and one more parameter of its own:
 *
 *   company.html?start=week&theme=modern&mode=light&lang=zh[&embed=1]
 *
 * `start` picks the state it opens in: `fresh`, before the first sentence, or `week`, a company
 * a week in (the default). `embed=1` makes it the guest of the page that frames it, as for the
 * framed app (app/guest-frame.ts).
 */
import type { EmbeddedPrefs } from "../app/frame";

export const COMPANY_FRAME_PATH = "/company.html";

export const COMPANY_STARTS = ["week", "fresh"] as const;
export type CompanyStart = (typeof COMPANY_STARTS)[number];

/** The frame's URL for a page outside the gallery: the start, the theme, the mode, the language. */
export function companyFrameSrc(base: string, prefs: EmbeddedPrefs, start: CompanyStart): string {
  const params = new URLSearchParams();
  params.set("start", start);
  params.set("theme", prefs.theme);
  params.set("mode", prefs.mode);
  params.set("lang", prefs.lang);
  params.set("embed", "1");
  return `${base}${COMPANY_FRAME_PATH}?${params.toString()}`;
}

export interface CompanyParams {
  start: CompanyStart;
  lang: "en" | "zh";
  embedded: boolean;
}

/** What the document reads back from its own URL; anything unknown opens the week in English. */
export function parseCompanyParams(search: string): CompanyParams {
  const params = new URLSearchParams(search);
  return {
    start: params.get("start") === "fresh" ? "fresh" : "week",
    lang: params.get("lang") === "zh" ? "zh" : "en",
    embedded: params.get("embed") === "1",
  };
}
