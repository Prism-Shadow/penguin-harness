/**
 * Prices as the models page prints them. Pricing is always stored in USD per million tokens; the
 * display currency is the user's setting, and conversion happens only for display and input, at
 * the App's one fixed rate (USD_TO_CNY).
 */
import { USD_TO_CNY } from "../../state/theme";
import type { Currency } from "../../state/theme";

export const CURRENCY_SYMBOL: Record<Currency, string> = { USD: "$", CNY: "¥" };

/** Trailing-zero-trimmed display/input value (keeps up to 4 decimal places): absorbs floating-point noise from USD<->CNY(x7) round trips. */
export function trim4(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return String(Math.round(v * 1e4) / 1e4);
}

/** USD/million-token string -> display string in the selected currency (with symbol). */
export function displayPrice(usdStr: string, currency: Currency): string {
  const n = Number(usdStr || "0");
  const v = currency === "CNY" ? n * USD_TO_CNY : n;
  return `${CURRENCY_SYMBOL[currency]}${trim4(v)}`;
}

/**
 * A derived USD figure — one that is not a price anyone typed, such as a blend of two — in the
 * selected currency to three significant figures: `$4.38`, `$0.179`, `¥30.6`. The four decimals
 * displayPrice keeps are for the stored prices it echoes back; on a computed figure they would be
 * noise that reads as precision.
 */
export function roughPrice(usd: number, currency: Currency): string {
  const v = currency === "CNY" ? usd * USD_TO_CNY : usd;
  return `${CURRENCY_SYMBOL[currency]}${Number(v.toPrecision(3))}`;
}
