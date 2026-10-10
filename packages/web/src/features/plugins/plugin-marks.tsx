/**
 * The marks a plugin's card and its detail dialog share: the status glyph with its word, the tag
 * pills, and the reading of a row — its title, icon, version, descriptions and the package's own
 * details (author, license, links) — library and server-module plugins alike, so the two kinds
 * read as one family.
 *
 * What a package does not carry stays missing rather than invented: no display name reads as the
 * plugin's name, no description as the "no description" placeholder (in muted ink in the dialog),
 * and a homepage or repository a browser cannot safely open is no link at all.
 *
 * Status follows the house rule for status chrome: the glyph carries the tone, the word beside
 * it stays muted ink (never red text), and the hover sentence says what the status means for
 * this plugin — the failure reason, the machines it runs on, how many Agents are behind.
 */
import { Badge, GlyphIcon, ICONS, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { toneInk, type Tone } from "../../lib/tone";
import { localizedText } from "../chat/skill-use";
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
 * Whether an admin installed the row's package on this server — by name, link or zip — rather
 * than the build shipping it: an installed library package, or a server module this server
 * holds that the build does not ship.
 */
export function rowInstalledOnServer(row: PluginRow): boolean {
  if (row.library?.source === "installed") return true;
  const part = row.module;
  return (
    part !== undefined &&
    !part.shipped &&
    (part.state === "active" || part.state === "pending" || part.state === "failed")
  );
}

/**
 * What a row is called: the library plugin's display name in the UI language (package.json's
 * `penguin.title` / `title_zh`), else its name — which a module-only row always shows.
 */
export function rowTitle(row: PluginRow, locale: "zh" | "en"): string {
  const plugin = row.library;
  return plugin === undefined
    ? row.name
    : localizedText(locale, plugin.title || row.name, plugin.titleZh);
}

/** A description as shown: the package's own text, or the placeholder when it carries none. */
const orPlaceholder = (text: string): string =>
  text.trim() === "" ? S.plugins.noDescription : text;

/**
 * A row's one-line description in the UI language: the short one where there is one, the full
 * one otherwise — in Chinese, either Chinese text before either English one — the placeholder
 * without any; a shipped package no index knows says so.
 */
export function rowShortDescription(row: PluginRow, locale: "zh" | "en"): string {
  const texts = row.library ?? row.module?.entry;
  if (texts === undefined) return S.plugins.shippedNoEntry;
  return orPlaceholder(
    locale === "zh"
      ? texts.shortDescriptionZh ||
          texts.descriptionZh ||
          texts.shortDescription ||
          texts.description
      : texts.shortDescription || texts.description,
  );
}

/** A row's full description in the UI language as the package carries it; null when no index knows the package. */
function ownDescription(row: PluginRow, locale: "zh" | "en"): string | null {
  if (row.library !== undefined) {
    return localizedText(locale, row.library.description, row.library.descriptionZh);
  }
  const entry = row.module?.entry;
  return entry === undefined ? null : localizedText(locale, entry.description, entry.descriptionZh);
}

/** Whether {@link rowDescription} shows text of the row's own rather than the placeholder. */
export function rowHasDescription(row: PluginRow, locale: "zh" | "en"): boolean {
  return ownDescription(row, locale)?.trim() !== "";
}

/** A row's full description in the UI language, the placeholder when the package carries none. */
export function rowDescription(row: PluginRow, locale: "zh" | "en"): string {
  const text = ownDescription(row, locale);
  return text === null ? S.plugins.shippedNoEntry : orPlaceholder(text);
}

/** npm's `github:<owner>/<repo>` shorthand for a repository, optionally `#<ref>`. */
const GITHUB_SHORTHAND = /^github:([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)(?:#\S*)?$/;

/**
 * A link a browser can open for a URL as a package.json writes it (`homepage`, `repository`):
 * `git+https://…/r.git` loses its `git+` and `.git`, `github:o/r` becomes the repository's page.
 * Anything that is not http(s) after that — `javascript:`, `ssh:`, `file:` — is null: no link.
 */
export function webLink(url: string | undefined): string | null {
  if (url === undefined) return null;
  const value = url.trim();
  const shorthand = GITHUB_SHORTHAND.exec(value);
  let parsed: URL;
  try {
    parsed = new URL(
      shorthand !== null ? `https://github.com/${shorthand[1]}` : value.replace(/^git\+/, ""),
    );
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  parsed.pathname = parsed.pathname.replace(/\.git$/, "");
  return parsed.href;
}

/** What the detail dialog says of a row's package besides its name: who wrote it, its license, where it lives. */
export interface PluginDetails {
  author?: string;
  license?: string;
  /** A link a browser can open (see {@link webLink}). */
  homepage?: string;
  repository?: string;
}

/**
 * A row's package details: the library plugin's own (its package.json), else its index entry's
 * (the first of its authors), field by field; a link only where {@link webLink} makes one.
 */
export function rowDetails(row: PluginRow): PluginDetails {
  const plugin = row.library;
  const entry = row.module?.entry;
  return {
    author: plugin?.author || entry?.authors[0] || undefined,
    license: plugin?.license || entry?.license || undefined,
    homepage: webLink(plugin?.homepage) ?? webLink(entry?.homepage) ?? undefined,
    repository: webLink(plugin?.repository) ?? webLink(entry?.repository) ?? undefined,
  };
}
