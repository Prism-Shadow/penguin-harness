/**
 * Company mode says it is a beta, in the two shapes that fact takes in the shell.
 *
 * The tag — a mini 内测版 / Beta mark riding at the top-right of 「公司」 in the 开发 | 公司
 * work-mode switch, which is the one control that names the mode itself and is in view on
 * every page of both modes. A superscript rather than a `Badge`: it qualifies the word it
 * sits on instead of reporting a state, so it must not read as a status mark, and at that
 * size it must not push the switch's two options around either — segmented.tsx pins it out
 * of flow and folds its text into the option's accessible name.
 *
 * The notice — the sentence a person gets the first time they switch this browser into the
 * mode (state/company.tsx's `setWorkMode`), and the once-only decision behind it. The flag
 * lives in localStorage rather than in the user's preferences because it is about this
 * browser having shown a toast, not about the user: a second browser is a second first time,
 * and a preferences round trip would decide it too late to toast on the click that caused it.
 */
import { S } from "../../lib/strings";

/** The localStorage key remembering that this browser has shown the beta notice. */
export const BETA_NOTICE_KEY = "penguin.companyBetaNoticeShown";

/** Minimal storage surface (the subset of localStorage used here); tests inject an in-memory one. */
export interface BetaNoticeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Whether the beta notice is still owed in this browser.
 *
 * Storage that is missing or refuses to answer (a Node test with no localStorage, a browser
 * with site data blocked) means no notice rather than one on every switch: the sentence also
 * stands under the admin's master switch and in the docs, so the cost of skipping the toast
 * is smaller than the cost of repeating it forever.
 */
export function shouldShowBetaNotice(storage?: BetaNoticeStorage): boolean {
  try {
    return (storage ?? localStorage).getItem(BETA_NOTICE_KEY) !== "1";
  } catch {
    return false;
  }
}

/** Remembers that the notice has been shown; a storage that refuses only costs a repeat. */
export function markBetaNoticeShown(storage?: BetaNoticeStorage): void {
  try {
    (storage ?? localStorage).setItem(BETA_NOTICE_KEY, "1");
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/**
 * The tag itself: the smallest legible rung, in the muted ink and border that keep it from
 * reading as a status mark. The px size is deliberate — this is a superscript over a
 * `text-xs` option, and there is no rung below `text-xs` to step down to. Its host hides it
 * from the accessible name, so the tooltip is the only thing it says on its own, and it is a
 * `title` because the switch it rides on carries no `Tooltip` of any kind.
 */
export function BetaBadge() {
  return (
    <span
      title={S.company.betaTitle}
      className="whitespace-nowrap rounded-sm border border-gray-300 px-0.5 py-px text-[9px] font-medium leading-none text-gray-500 dark:border-gray-600 dark:text-gray-400"
    >
      {S.company.beta}
    </span>
  );
}
