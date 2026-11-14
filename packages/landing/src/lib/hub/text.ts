/**
 * Reading the hub's records in the reader's language, and the formats its pages share. Sources
 * write English and may add Chinese (`title` / `titleZh`); Chinese readers get the Chinese text
 * where there is one, everyone else the English.
 */
import type { SiteLocale } from "@prismshadow/penguin-ui/site";
import { S } from "../strings";

export const pick = (locale: SiteLocale, en: string, zh: string | undefined): string =>
  locale === "zh" && zh ? zh : en;

export const titleOf = (locale: SiteLocale, item: { title: string; titleZh?: string }): string =>
  pick(locale, item.title, item.titleZh);

/** A calendar date in the reader's language, from an ISO 8601 time. */
export function formatDay(iso: string, locale: SiteLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A count in millions or thousands, one decimal at most: 109.9M, 12K. */
export function formatCompact(value: number): string {
  // The unit is picked from the rounded figure, not the raw one: 999,500 rounds to 1000K, which
  // has to carry into 1.0M.
  const thousands = trim(value / 1e3);
  if (value >= 1e6 || Number(thousands) >= 1000) return `${trim(value / 1e6)}M`;
  if (Math.round(value) >= 1e3) return `${thousands}K`;
  return String(Math.round(value));
}

/** One decimal below 100, whole from there; 99.96 rounds to 100 and is whole too. */
const trim = (value: number) => {
  const tenth = value.toFixed(1);
  return Number(tenth) >= 100 ? String(Math.round(value)) : tenth;
};

/** One run's time: minutes under an hour, else hours to one decimal. */
export function formatDuration(ms: number): string {
  const t = S.hub.leaderboards;
  // Rounded before the unit is picked: 59.6 minutes rounds to 60, which reads as 1.0 h.
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes < 60 ? t.minutesShort(String(minutes)) : t.hoursShort((ms / 3_600_000).toFixed(1));
}

export const formatUsd = (value: number): string =>
  `$${value >= 100 ? Math.round(value) : value.toFixed(2)}`;

export const formatScore = (value: number): string => value.toFixed(1);
