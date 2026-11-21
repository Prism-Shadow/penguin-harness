/**
 * The marks a plugin's card and its detail dialog share: the status glyph with its word, the tag
 * pills (and the card's set of them, which an Agent's plugin row shows too), and the reading of a
 * row — its title, icon, version, descriptions and the package's own details (author, license,
 * links) — library and server-module plugins alike, so the two kinds read as one family.
 *
 * What a package does not carry stays missing rather than invented: no display name reads as the
 * plugin's name, no description as the "no description" placeholder (in muted ink in the dialog),
 * and a homepage or repository a browser cannot safely open is no link at all.
 *
 * Status follows the house rule for status chrome, drawn by the UI package's `StatusMark`: the
 * glyph carries the tone, the word beside it stays muted ink (never red text), and the hover
 * sentence says what the status means for this plugin — the failure reason, the machines it runs
 * on, how many Agents are behind.
 */
import { Badge, ICONS, StatusMark, type ToneName } from "@prismshadow/penguin-ui";
import type { ReactNode } from "react";
import type { IconRef } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { localizedText } from "../../lib/skill-use";
import type { PluginRow } from "./plugin-groups";
import type {
  AgentModuleMark,
  AgentModuleMarkKind,
  LibraryUsage,
  PluginStatus,
} from "./plugin-status";

/** The glyph of each status: done, waiting, a fault, stopped, elsewhere, or not yet there. */
const STATUS_GLYPH: Record<PluginStatus, string> = {
  installed: ICONS.checkCircle,
  update: ICONS.rotateCw,
  awaiting: ICONS.hand,
  restart: ICONS.hourglass,
  failed: ICONS.alertCircle,
  incompatible: ICONS.alertCircle,
  stopped: ICONS.stopCircle,
  "not-here": ICONS.server,
  available: ICONS.download,
};

/** What each status means, as a tone: settled well, unfinished, failed — or none, receding. */
const STATUS_TONE: Record<PluginStatus, ToneName | undefined> = {
  installed: "success",
  update: "attention",
  awaiting: "attention",
  restart: "attention",
  failed: "danger",
  incompatible: "attention",
  stopped: undefined,
  "not-here": undefined,
  available: undefined,
};

/** A plugin's status as the UI package's mark: its glyph in its tone, its word, `hint` on hover. */
export function PluginStatusMark({ status, hint }: { status: PluginStatus; hint: string }) {
  const tone = STATUS_TONE[status];
  return (
    <StatusMark
      glyph={STATUS_GLYPH[status]}
      {...(tone !== undefined ? { tone } : {})}
      label={S.plugins.status[status]}
      hint={hint}
      data-testid="plugin-status"
    />
  );
}

/**
 * The hover sentence of a row's status. A library status counted with Agents on a machine out of
 * reach says how many it counted as last seen: the status stands while the machine is away, and
 * the sentence is where that is admitted.
 */
export function statusHint(
  row: PluginRow,
  status: PluginStatus,
  usage: LibraryUsage | null,
): string {
  const mod = row.module;
  const lastSeen = usage?.lastSeen?.length ?? 0;
  const seen = (hint: string) =>
    lastSeen > 0 ? `${hint}${S.plugins.statusHint.lastSeenOn(lastSeen)}` : hint;
  switch (status) {
    case "update":
      return seen(S.plugins.statusHint.update(usage?.behind.length ?? 0));
    case "installed":
      return mod !== undefined
        ? S.plugins.statusHint.moduleInstalled
        : seen(S.plugins.statusHint.libraryInstalled);
    case "available":
      return mod !== undefined
        ? S.plugins.statusHint.moduleAvailable
        : S.plugins.statusHint.libraryAvailable;
    case "restart":
      return S.plugins.statusHint.restart;
    case "incompatible":
      return S.plugins.stateDisabled;
    case "failed":
      return S.plugins.statusHint.failed(mod?.error ?? "");
    case "not-here":
      return S.plugins.statusHint.unsynced;
    case "awaiting":
      return S.plugins.statusHint.awaiting;
    case "stopped":
      return S.plugins.statusHint.stopped;
  }
}

/**
 * The glyph and tone of each mark a server module gets on an Agent, by what it means: off and
 * stopped recede (settled, nothing running), an ask waiting for the administrator and a listing
 * waiting for a restart are unfinished, a failed load is a fault. Shape tells the two unfinished
 * ones apart — a raised hand for an ask, the hourglass for a restart — and so do their words. Off
 * is the lifted plug, apart from the server glyph that leads the detail's line and the Enable
 * action.
 */
const MODULE_MARK: Record<AgentModuleMarkKind | "running", { glyph: string; tone?: ToneName }> = {
  running: { glyph: ICONS.checkCircle, tone: "success" },
  off: { glyph: ICONS.plugLifted },
  awaiting: { glyph: ICONS.hand, tone: "attention" },
  stopped: { glyph: ICONS.stopCircle },
  failed: { glyph: ICONS.alertCircle, tone: "danger" },
  restart: { glyph: ICONS.hourglass, tone: "attention" },
};

/** What a server module's mark means, on hover: why it does not run, and what that leaves. */
function moduleHint(mark: AgentModuleMark | null, onMachine: boolean): string {
  const hint = S.agentPlugins.module.hint;
  if (mark === null) return hint.running;
  switch (mark.kind) {
    case "off":
      return onMachine && mark.action === null ? hint.offOnMachine : hint.off;
    case "awaiting":
      return hint.awaiting;
    case "stopped":
      return hint.stopped;
    case "failed":
      return hint.failed(mark.reason ?? "");
    case "restart":
      return hint.restart;
  }
}

/**
 * A server module's state on an Agent's server, as the UI package's status mark. `words` picks
 * the wording: `row` names the module in its words (「服务端模块未启用」), for a row where it
 * stands beside the plugin's own status; `fact` gives the state alone, for the detail's line that
 * is already named after the module. `mark` null is a module that runs.
 */
export function ModuleStatusMark({
  mark,
  onMachine,
  words,
}: {
  mark: AgentModuleMark | null;
  onMachine: boolean;
  words: "row" | "fact";
}) {
  const kind = mark?.kind ?? "running";
  const { glyph, tone } = MODULE_MARK[kind];
  return (
    <StatusMark
      glyph={glyph}
      {...(tone !== undefined ? { tone } : {})}
      label={
        words === "row" && kind !== "running"
          ? S.agentPlugins.module.mark[kind]
          : S.agentPlugins.module.state[kind]
      }
      hint={moduleHint(mark, onMachine)}
      data-testid="module-status"
    />
  );
}

/** One tag on a row's tag line: a category, "built in", where it runs. */
export function PluginTag({
  children,
  title,
  id,
}: {
  children: ReactNode;
  title?: string;
  id?: string;
}) {
  return (
    <Badge variant="soft" tooltip={title} {...(id !== undefined ? { id } : {})}>
      {children}
    </Badge>
  );
}

/**
 * A row's tags, the one set the Plugins page's card and an Agent's plugin row both show: its
 * category, "built in", "installed on server", "link" and "shared by all machines", each where it
 * applies and with its hover sentence. The category is left out without `categoryTitle` (a card in
 * its category's own section, whose head names it); `sharedTagId` is the shared tag's id, for a
 * control it describes.
 */
export function pluginTags(
  row: PluginRow,
  { categoryTitle, sharedTagId }: { categoryTitle?: string | undefined; sharedTagId?: string } = {},
): ReactNode[] {
  const tags: ReactNode[] = [];
  if (categoryTitle !== undefined) {
    tags.push(<PluginTag key="category">{categoryTitle}</PluginTag>);
  }
  if (rowBuiltin(row)) {
    tags.push(
      <PluginTag
        key="builtin"
        title={row.library !== undefined ? S.plugins.libraryBuiltinHint : S.plugins.builtinHint}
      >
        {S.plugins.builtin}
      </PluginTag>,
    );
  }
  if (rowInstalledOnServer(row)) {
    tags.push(
      <PluginTag key="installed" title={S.plugins.installedOnServerHint}>
        {S.plugins.installedOnServer}
      </PluginTag>,
    );
  }
  const linked = rowLinked(row);
  if (linked !== null) {
    tags.push(
      <PluginTag key="linked" title={S.plugins.linkedHint(linked.linkPath)}>
        {S.plugins.linkedTag}
      </PluginTag>,
    );
  }
  if (row.module?.shared === true) {
    tags.push(
      <PluginTag key="shared" id={sharedTagId} title={S.plugins.sharedHint}>
        {S.plugins.sharedTag}
      </PluginTag>,
    );
  }
  return tags;
}

/** The icon a row is drawn with, when it has one: the library plugin's, else the index entry's. */
export function rowIcon(row: PluginRow): IconRef | undefined {
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
    (part.state === "active" ||
      part.state === "pending" ||
      part.state === "failed" ||
      part.state === "disabled")
  );
}

/** Whether the row's package is a local directory linked in (`penguin plugin link`), and where it points. */
export function rowLinked(row: PluginRow): { linkPath: string } | null {
  const part = row.module;
  return part?.linked === true ? { linkPath: part.linkPath ?? "" } : null;
}

/**
 * What a row is called: the package's display name in the UI language, from the library or
 * the module's registry entry, falling back to its name.
 */
export function rowTitle(row: PluginRow, locale: "zh" | "en"): string {
  const plugin = row.library ?? row.module?.entry;
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
