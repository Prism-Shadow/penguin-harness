/**
 * The marks a plugin's card and its detail dialog share: the status glyph with its word, the tag
 * pills, and the reading of a row's icon, version and descriptions — library and server-module
 * plugins alike, so the two kinds read as one family.
 *
 * Status follows the house rule for status chrome: the glyph carries the tone, the word beside
 * it stays muted ink (never red text), and the hover sentence says what the status means for
 * this plugin — the failure reason, the machines it runs on, how many Agents are behind.
 */
import { Badge, GlyphIcon, ICONS, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { toneInk, type Tone } from "../../lib/tone";
import { localizedShortText, localizedText } from "../chat/skill-use";
import type { PluginRow } from "./plugin-groups";
import type { LibraryUsage, PluginStatus } from "./plugin-status";

/** The glyph of each status: done, waiting, a fault, elsewhere, or not yet there. */
const STATUS_GLYPH: Record<PluginStatus, string> = {
  installed: ICONS.checkCircle,
  update: ICONS.rotateCw,
  restart: ICONS.hourglass,
  failed: ICONS.alertCircle,
  "not-here": ICONS.server,
  available: ICONS.download,
};

/** What each status means, as a tone: settled well, unfinished, failed, or receding. */
const STATUS_TONE: Record<PluginStatus, Tone> = {
  installed: "success",
  update: "attention",
  restart: "attention",
  failed: "danger",
  "not-here": "muted",
  available: "muted",
};

/** The status glyph in its tone and the status word in muted ink; `hint` is the hover sentence. */
export function StatusMark({ status, hint }: { status: PluginStatus; hint: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center ${ICON_GAP.tight}`}
      data-tooltip={hint}
      data-tooltip-content="text"
    >
      <GlyphIcon
        d={STATUS_GLYPH[status]}
        size={ICON_SIZE.inlineGlyph}
        className={toneInk[STATUS_TONE[status]]}
      />
      <span>{S.plugins.status[status]}</span>
    </span>
  );
}

/** The hover sentence of a row's status. */
export function statusHint(
  row: PluginRow,
  status: PluginStatus,
  usage: LibraryUsage | null,
): string {
  const mod = row.module;
  switch (status) {
    case "update":
      return S.plugins.statusHint.update(usage?.behind.length ?? 0);
    case "installed":
      return mod !== undefined
        ? S.plugins.statusHint.moduleInstalled
        : S.plugins.statusHint.libraryInstalled;
    case "available":
      return mod !== undefined
        ? S.plugins.statusHint.moduleAvailable
        : S.plugins.statusHint.libraryAvailable;
    case "restart":
      return S.plugins.statusHint.restart;
    case "failed":
      return S.plugins.statusHint.failed(mod?.error ?? "");
    case "not-here":
      return mod?.state === "elsewhere"
        ? S.plugins.statusHint.elsewhere((mod.onlyOn ?? []).join(", "))
        : S.plugins.statusHint.unsynced;
  }
}

/** One tag on a row's tag line: a category, "built in", where it runs. */
export function PluginTag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <Badge variant="soft" tooltip={title}>
      {children}
    </Badge>
  );
}

/** The raw icon.svg a row is drawn with, when it has one: the library plugin's, else the index entry's. */
export function rowIcon(row: PluginRow): string | undefined {
  return row.library?.icon ?? row.module?.entry?.icon;
}

/** The version a row shows: the plugin's npm version (the library's), else the index entry's. */
export function rowVersion(row: PluginRow): string | undefined {
  return row.library?.version ?? row.module?.entry?.version;
}

/** Whether the build ships the row's package (a library plugin always; a module when shipped). */
export function rowBuiltin(row: PluginRow): boolean {
  return row.library?.source === "builtin" || row.module?.shipped === true;
}

/**
 * A row's one-line description in the UI language: the short one where there is one, the full
 * one otherwise; a shipped package no index knows says so.
 */
export function rowShortDescription(row: PluginRow, locale: "zh" | "en"): string {
  if (row.library !== undefined) return localizedShortText(locale, row.library);
  const entry = row.module?.entry;
  if (entry === undefined) return S.plugins.shippedNoEntry;
  return locale === "zh"
    ? (entry.shortDescriptionZh ??
        entry.descriptionZh ??
        entry.shortDescription ??
        entry.description)
    : (entry.shortDescription ?? entry.description);
}

/** A row's full description in the UI language. */
export function rowDescription(row: PluginRow, locale: "zh" | "en"): string {
  if (row.library !== undefined) {
    return localizedText(locale, row.library.description, row.library.descriptionZh);
  }
  const entry = row.module?.entry;
  if (entry === undefined) return S.plugins.shippedNoEntry;
  return localizedText(locale, entry.description, entry.descriptionZh);
}
