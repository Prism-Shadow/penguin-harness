/**
 * Budgets on screen versus budgets on the wire.
 *
 * A budget is a MONTHLY cap — one calendar month in the organization's timezone — and the
 * server both stores it (in `org_chart.yaml`) and returns it in USD. The reader, though,
 * chooses the currency this App writes money in (state/theme.ts), so a budget box speaks that
 * currency and these helpers do the two conversions around it: what was typed becomes USD on
 * save, and what is stored becomes the reader's currency when the box is filled in.
 *
 * The rate is the App's one fixed rate (USD_TO_CNY) and a stored amount is rounded to cents,
 * so an amount typed in CNY and read back can land a fraction of a fen away from what was
 * typed. That is why a box in CNY says underneath it what it is actually going to store.
 */
import { USD_TO_CNY } from "../../state/theme";
import type { Currency } from "../../state/theme";
import type { Strings } from "../../lib/strings";

/** The symbol each currency writes its amounts with (the same two lib/format spells). */
const CURRENCY_SYMBOL: Record<Currency, string> = { USD: "$", CNY: "¥" };

/** Cents: the precision a stored budget is kept at, and what both directions round to. */
function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What a budget box holds, as the server stores it: null for an empty box (unbounded), the
 * amount in USD otherwise.
 *
 * Text that is not a non-negative number also reads as an empty box. Every caller validates
 * first (`isBudgetText`) and never reaches that branch — silently lifting a cap because of a
 * typo is exactly what the validation is there to prevent.
 */
export function toStoredUsd(text: string, currency: Currency): number | null {
  const t = text.trim();
  if (t === "") return null;
  const typed = Number(t);
  if (!Number.isFinite(typed) || typed < 0) return null;
  return cents(currency === "CNY" ? typed / USD_TO_CNY : typed);
}

/**
 * The other direction: a stored USD amount as the text a box starts with, in the reader's
 * currency. An unbounded budget starts the box empty.
 */
export function fromStoredUsd(usd: number | null | undefined, currency: Currency): string {
  if (usd == null || !Number.isFinite(usd)) return "";
  return String(cents(currency === "CNY" ? usd * USD_TO_CNY : usd));
}

/** True while a budget box holds something usable: empty (unbounded), or a non-negative number. */
export function isBudgetText(text: string): boolean {
  const t = text.trim();
  return t === "" || Number(t) >= 0;
}

/** The unit that follows a budget box: the reader's currency, and the period the cap covers. */
export function unitLabel(currency: Currency, strings: Strings): string {
  return strings.company.budgetUnit(CURRENCY_SYMBOL[currency]);
}
