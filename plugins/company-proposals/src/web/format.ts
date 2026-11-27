/**
 * Time formatting for these pages, in the language on screen. The Web App's own formatters are
 * handed over through the web-plugin bridge already following the app's language (the host re-binds
 * them on every dictionary switch), so this file only carries the two-argument shape the pages were
 * written against — `formatRelativeShort(iso, locale)` — and passes through; the locale argument is
 * accepted and ignored, the way the host's binding makes it redundant.
 */
import { formatDateTime as dateTime, formatRelativeShort as relativeShort } from "@prismshadow/penguin-web-plugin";

export function formatDateTime(iso: string): string {
  return dateTime(iso);
}

export function formatRelativeShort(iso: string, _locale?: "zh" | "en"): string {
  return relativeShort(iso);
}
