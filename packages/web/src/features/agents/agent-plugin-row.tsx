/**
 * One plugin's row on the Agent settings Plugins sub-page: the shared list row (`ListRow`), the
 * shape of a hook package's row on the Hooks sub-page, kept to one line.
 *
 * - The plugin's tile, then its display name with — right after it — its status on this Agent:
 *   the glyph in the status's tone, the word in muted ink, the meaning on hover; and the marks of
 *   its MCP servers while they wait for vault keys or a sign-in. No description and no tags: the
 *   detail says the rest.
 * - The npm version, quiet, then the actions: Install for an available plugin; Update while an
 *   installed one is behind the library or missing a part; the owner's Uninstall, the glyph alone
 *   as on a hook package's row.
 *
 * The name is the row's button: it opens the detail. A press on an action is the action's alone.
 */
import type { ReactNode } from "react";
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
import { S } from "../../lib/strings";
import {
  McpServerMarks,
  pluginMcpState,
  rowIcon,
  rowVersion,
  type AgentInstalls,
  type AgentPluginGroup,
  type AgentPluginStatus,
  type PluginRow,
} from "../plugins";
import { SkillTile } from "../skills";
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

/**
 * The status mark, and right after it the marks of the plugin's MCP servers on this Agent while
 * they wait for vault keys (who sets them, said on hover) or a sign-in.
 */
export function StatusWithMcp({
  entry,
  installs,
  isOwner,
}: {
  entry: AgentPluginGroup;
  installs: AgentInstalls | undefined;
  isOwner: boolean;
}) {
  const mcp = entry.plugin === null ? null : pluginMcpState(entry.plugin, installs);
  return (
    // The status word reads as a quiet fact beside the name, as it does on a facts line.
    <span className={`inline-flex shrink-0 items-center ${ICON_GAP.row} text-xs text-fg-muted`}>
      <AgentStatusMark status={entry.status} />
      {mcp !== null && (mcp.missingKeys.length > 0 || mcp.signIn) && (
        <McpServerMarks
          keys={mcp.missingKeys}
          where={isOwner ? S.plugins.mcpSetUpWhere : S.plugins.mcpSetUpByOwner}
          signIn={mcp.signIn}
        />
      )}
    </span>
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
  if (entry.status === "update" || entry.status === "incomplete") {
    out.push(
      <EntityCardAction
        key="update"
        variant="secondary"
        glyph={ICONS.rotateCw}
        label={S.skills.updateAction}
        name={`${S.skills.updateAction} ${title}`}
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
): ReactNode {
  const busy = actions.running === entry.name;
  const disabled = actions.running !== null;
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
      {(entry.status === "update" || entry.status === "incomplete") &&
        worded(ICONS.rotateCw, S.skills.updateAction, () => actions.update(entry))}
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
  installs,
  isOwner,
  actions,
  onOpen,
}: {
  entry: AgentPluginGroup;
  /** The library's row of the plugin; undefined once it left the library. */
  row: PluginRow | undefined;
  title: string;
  installs: AgentInstalls | undefined;
  isOwner: boolean;
  actions: AgentPluginActions;
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
          // One line of text beside it: the tile is a size down from the two-line rows'.
          size={28}
          glyph={16}
        />
      }
      title={title}
      titleTrail={<StatusWithMcp entry={entry} installs={installs} isOwner={isOwner} />}
      meta={version === undefined ? undefined : `v${version}`}
      trailing={rowActions(entry, title, isOwner, actions)}
      onClick={onOpen}
    />
  );
}
