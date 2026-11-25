/**
 * One plugin's row on the Agent settings Plugins sub-page: the shared list row (`ListRow`), the
 * shape of a hook package's row on the Hooks sub-page.
 *
 * - The plugin's tile, then its display name with — right after it — its status on this Agent
 *   where the section does not already say it (Update available, Incomplete, Not in library: the
 *   glyph in the status's tone, the word in muted ink, the meaning on hover), the marks of its
 *   MCP servers while they wait for vault keys or a sign-in, and the Plugins page card's tags
 *   (`pluginTags`, each with its hover sentence; the category always, since the sub-page groups by
 *   installed and available rather than by category). The marks wrap under the name as a hook
 *   package's hook points do, and never truncate. A plugin that also ships server modules, whose
 *   module does not run on the Agent's server, has one more mark after the status: why it does
 *   not (off, awaiting the administrator, stopped by them, failed to load, waiting for a
 *   restart), said on hover.
 * - Under the name, the plugin's one-line description, read as the card reads it. A plugin gone
 *   from the library has none to read, and no line, as a hook package without one has none.
 * - The npm version, quiet, then the actions: Install for an available plugin; Update while an
 *   installed one is behind the library or missing a part; Enable server module, or Ask the
 *   administrator, while its module is off (plugin-status.ts `agentModuleMark`); the owner's
 *   Uninstall, the glyph alone as on a hook package's row.
 *
 * The name is the row's button: it opens the detail, and so does a click anywhere else on the row
 * that is not one of its controls (lib/card-open.ts). A press on an action is the action's alone.
 * A part's puzzle on another sub-page lands here: the plugin's row is marked for a moment.
 */
import type { ReactNode } from "react";
import type { PluginModuleStatus } from "@prismshadow/penguin-server/api";
import {
  Button,
  EntityCardAction,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  IconButton,
  ListRow,
  StatusMark,
} from "@prismshadow/penguin-ui";
import type { ToneName } from "@prismshadow/penguin-ui";
import { cardBodyClick } from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import {
  McpServerMarks,
  ModuleStatusMark,
  pluginMcpState,
  pluginTags,
  rowIcon,
  rowShortDescription,
  rowVersion,
  type AgentInstalls,
  type AgentModuleMark,
  type AgentPluginGroup,
  type AgentPluginStatus,
  type PluginRow,
} from "@prismshadow/penguin-web/internal";
import { SkillTile } from "@prismshadow/penguin-web/internal";
import type { AgentPluginActions } from "./agent-plugin-actions";

/** Each status's glyph, and its tone; a status without one recedes. */
const STATUS_MARK: Record<AgentPluginStatus, { glyph: string; tone?: ToneName }> = {
  installed: { glyph: ICONS.checkCircle, tone: "success" },
  update: { glyph: ICONS.rotateCw, tone: "attention" },
  incomplete: { glyph: ICONS.alertCircle, tone: "attention" },
  "not-in-library": { glyph: ICONS.server },
  available: { glyph: ICONS.download },
};

/** A plugin's status on this Agent: the UI package's status mark, the word and its meaning ours. */
export function AgentStatusMark({ status }: { status: AgentPluginStatus }) {
  const { glyph, tone } = STATUS_MARK[status];
  return (
    <StatusMark
      glyph={glyph}
      {...(tone !== undefined ? { tone } : {})}
      label={S.agentPlugins.status[status]}
      hint={S.agentPlugins.statusHint[status]}
    />
  );
}

/** A plugin's server module on the Agent's server: how it stands, and its mark while it does not run. */
export interface AgentModule {
  status: PluginModuleStatus;
  /** Null while the module runs there. */
  mark: AgentModuleMark | null;
  /** The Agent lives on a machine. */
  onMachine: boolean;
}

/** The statuses a row's section already names: Installed and Available say nothing more there. */
const SAID_BY_SECTION: ReadonlySet<AgentPluginStatus> = new Set(["installed", "available"]);

/**
 * The status mark, where it says more than the section the row sits in, and right after it the
 * marks of the plugin's MCP servers on this Agent while they wait for vault keys (who sets them,
 * said on hover) or a sign-in. Nothing when there is neither.
 */
export function StatusWithMcp({
  entry,
  installs,
  isOwner,
  module,
}: {
  entry: AgentPluginGroup;
  installs: AgentInstalls | undefined;
  isOwner: boolean;
  /** The plugin's server module, when it ships one. */
  module?: AgentModule | undefined;
}) {
  const mcp = entry.plugin === null ? null : pluginMcpState(entry.plugin, installs);
  const waiting = mcp !== null && (mcp.missingKeys.length > 0 || mcp.signIn);
  const status = !SAID_BY_SECTION.has(entry.status);
  const moduleMark = module?.mark ?? null;
  if (!status && !waiting && moduleMark === null) return null;
  return (
    // The status word reads as a quiet fact beside the name, as it does on a facts line.
    <span className={`inline-flex shrink-0 items-center ${ICON_GAP.row} text-xs text-fg-muted`}>
      {status && <AgentStatusMark status={entry.status} />}
      {module !== undefined && moduleMark !== null && (
        <ModuleStatusMark mark={moduleMark} onMachine={module.onMachine} words="row" />
      )}
      {mcp !== null && waiting && (
        <McpServerMarks
          keys={mcp.missingKeys}
          where={isOwner ? S.plugins.mcpSetUpWhere : S.plugins.mcpSetUpByOwner}
          signIn={mcp.signIn}
        />
      )}
    </span>
  );
}

/**
 * The action a plugin's server module offers, in words: Enable server module, or Ask the
 * administrator; nothing when the module runs or the viewer can do nothing about it. `variant`
 * is the caller's: a row's main action, or a quiet one on the detail's line.
 */
export function ModuleActionButton({
  entry,
  title,
  module,
  actions,
  variant = "secondary",
}: {
  entry: AgentPluginGroup;
  title: string;
  module: AgentModule | undefined;
  actions: AgentPluginActions;
  variant?: "secondary" | "ghost";
}) {
  const action = module?.mark?.action ?? null;
  if (module === undefined || action === null) return null;
  const label = action === "enable" ? S.agentPlugins.module.enable : S.agentPlugins.module.request;
  return (
    <Button
      size="sm"
      variant={variant}
      leading={
        <GlyphIcon
          d={action === "enable" ? ICONS.server : ICONS.hand}
          size={ICON_SIZE.iconButton}
        />
      }
      loading={actions.running === entry.name}
      disabled={actions.running !== null}
      aria-label={`${label} ${title}`}
      onClick={() => actions.askModule(entry, module.status)}
    >
      {label}
    </Button>
  );
}

/** A plugin's actions in its detail's footer, each with its word. */
export function agentPluginActions(
  entry: AgentPluginGroup,
  title: string,
  isOwner: boolean,
  actions: AgentPluginActions,
): ReactNode[] {
  const out: ReactNode[] = [];
  const busy = actions.running === entry.name;
  const disabled = actions.running !== null;
  if (entry.status === "available") {
    out.push(
      <EntityCardAction
        key="install"
        glyph={ICONS.download}
        label={S.skills.install}
        name={`${S.skills.install} ${title}`}
        words="always"
        busy={busy}
        disabled={disabled}
        onClick={() => actions.install(entry)}
      />,
    );
    return out;
  }
  const release = actions.releaseFor(entry);
  if (release || entry.status === "update" || entry.status === "incomplete") {
    const label = release ? S.plugins.updatePackageTo(release.to) : S.skills.updateAction;
    out.push(
      <EntityCardAction
        key="update"
        variant="secondary"
        glyph={ICONS.rotateCw}
        label={label}
        name={`${label} ${title}`}
        words="always"
        busy={busy}
        disabled={disabled}
        onClick={() => actions.update(entry)}
      />,
    );
  }
  if (isOwner) {
    out.push(
      <EntityCardAction
        key="uninstall"
        variant="danger"
        glyph={ICONS.trash}
        label={S.skills.uninstall}
        name={`${S.skills.uninstall} ${title}`}
        words="always"
        busy={busy}
        disabled={disabled}
        onClick={() => actions.uninstall(entry)}
      />,
    );
  }
  return out;
}

/**
 * A plugin's actions on its row: Install or Update in words, the row's main action, and the
 * owner's Uninstall as the glyph alone, as a hook package's row has it.
 */
function rowActions(
  entry: AgentPluginGroup,
  title: string,
  isOwner: boolean,
  actions: AgentPluginActions,
  module: AgentModule | undefined,
): ReactNode {
  const busy = actions.running === entry.name;
  const disabled = actions.running !== null;
  const release = actions.releaseFor(entry);
  const worded = (glyph: string, label: string, run: () => void) => (
    <Button
      size="sm"
      leading={<GlyphIcon d={glyph} size={ICON_SIZE.iconButton} />}
      loading={busy}
      disabled={disabled}
      aria-label={`${label} ${title}`}
      onClick={run}
    >
      {label}
    </Button>
  );
  return (
    <>
      {entry.status === "available" &&
        worded(ICONS.download, S.skills.install, () => actions.install(entry))}
      {(release || entry.status === "update" || entry.status === "incomplete") &&
        worded(
          ICONS.rotateCw,
          release ? S.plugins.updatePackageTo(release.to) : S.skills.updateAction,
          () => actions.update(entry),
        )}
      <ModuleActionButton entry={entry} title={title} module={module} actions={actions} />
      {isOwner && entry.status !== "available" && (
        <IconButton
          variant="danger"
          label={`${S.skills.uninstall} ${title}`}
          title={S.skills.uninstall}
          disabled={disabled}
          onClick={() => actions.uninstall(entry)}
        >
          <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
        </IconButton>
      )}
    </>
  );
}

export function AgentPluginRow({
  entry,
  row,
  title,
  categoryTitle,
  locale,
  installs,
  isOwner,
  actions,
  module,
  marked,
  onOpen,
}: {
  entry: AgentPluginGroup;
  /** The library's row of the plugin; undefined once it left the library. */
  row: PluginRow | undefined;
  title: string;
  /** The title of the library category the plugin is listed under, as the Plugins page names it. */
  categoryTitle: string | undefined;
  locale: "zh" | "en";
  installs: AgentInstalls | undefined;
  isOwner: boolean;
  actions: AgentPluginActions | undefined;
  /** The plugin's server module on the Agent's server, for a plugin the Agent carries that ships one. */
  module?: AgentModule | undefined;
  /** A part's puzzle just pointed here. */
  marked: boolean;
  onOpen: () => void;
}) {
  const version = row === undefined ? undefined : rowVersion(row);
  return (
    <ListRow
      as="li"
      leading={
        <SkillTile
          icon={row === undefined ? undefined : rowIcon(row)}
          name={entry.name}
          fallback={ICONS.puzzle}
        />
      }
      title={title}
      titleTrail={
        <>
          <StatusWithMcp entry={entry} installs={installs} isOwner={isOwner} module={module} />
          {row !== undefined && pluginTags(row, { categoryTitle })}
        </>
      }
      description={row === undefined ? undefined : rowShortDescription(row, locale)}
      meta={version === undefined ? undefined : `v${version}`}
      trailing={actions && rowActions(entry, title, isOwner, actions, module)}
      onClick={onOpen}
      onBodyClick={cardBodyClick(onOpen)}
      marked={marked}
    />
  );
}
