/**
 * Company mode says it is a beta, in the two shapes that fact takes in the shell.
 *
 * The tag — the package's `BetaBadge` in this app's words, a mini "Beta" mark riding at the
 * top-right of "Company" in the Development | Company work-mode switch, which is the one control
 * that names the mode itself and is in view on every page of both modes. The switch
 * (`Segmented`) pins it out of flow and folds its text into the option's accessible name.
 *
 * The notice — the sentence a person gets the first time they switch this browser into the
 * mode (state/company.tsx's `setWorkMode`), and the once-only decision behind it. The flag
 * lives in localStorage rather than in the user's preferences because it is about this
 * browser having shown a toast, not about the user: a second browser is a second first time,
 * and a preferences round trip would decide it too late to toast on the click that caused it.
 */
import { BetaBadge } from "@prismshadow/penguin-ui";
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

/** The beta tag on the "Company" option, its tooltip saying what the beta means. */
export function CompanyBetaBadge() {
  return <BetaBadge label={S.company.beta} title={S.company.betaTitle} />;
}
