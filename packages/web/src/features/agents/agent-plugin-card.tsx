/**
 * One plugin's card on the Agent settings Plugins sub-page: the Plugins page's card
 * (`EntityCard`), filled for this one Agent.
 *
 * - The plugin's tile, its display name (the plugin's name on hover) and its short description;
 *   a plugin gone from the library has only its name, and says why it cannot be updated.
 * - The facts line: the npm version, the plugin's status on this Agent — its glyph in the
 *   status's tone, the word in muted ink, the meaning on hover — with the marks of its MCP
 *   servers when they wait for vault keys or a sign-in, and what of it the card is about: the
 *   parts on the Agent for an installed plugin, the parts the library ships for an available one.
 * - The tags: its category, and whether the build ships it or an admin installed it here.
 * - The actions: Install for an available plugin; Update while an installed one is behind the
 *   library or missing a part; the owner's Uninstall, the glyph alone at the card's width.
 *
 * A click on the card's body opens the detail, as its title does; a press on an action is the
 * action's alone.
 */
import type { ReactNode } from "react";
import { EntityCard, EntityCardAction, ICONS, ICON_GAP, StatusMark } from "@prismshadow/penguin-ui";
import type { ToneName } from "@prismshadow/penguin-ui";
import { cardBodyClick } from "../../lib/card-open";
import { S } from "../../lib/strings";
import {
  McpServerMarks,
  PluginTag,
  pluginMcpState,
  rowBuiltin,
  rowIcon,
  rowInstalledOnServer,
  rowShortDescription,
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

/** The parts a card summarises: the Agent's own for a plugin on it, the library's for one to install. */
export function partSummaryOf(entry: AgentPluginGroup): string {
  if (entry.status === "available" && entry.plugin !== null) {
    const { skills, hooks, mcpServers, workbenches } = entry.plugin;
    return S.agentPlugins.partSummary(
      skills.length,
      hooks.length > 0,
      mcpServers.length,
      workbenches?.length ?? 0,
    );
  }
  const { skills, hooks, mcpServers, workbenches } = entry.parts;
  return S.agentPlugins.partSummary(
    skills.length,
    hooks.length > 0,
    mcpServers.length,
    workbenches.length,
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
    <span className={`inline-flex shrink-0 items-center ${ICON_GAP.row}`}>
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

/**
 * A plugin's actions, on its card (`words="wide"`: the glyph alone at a card's width, the word
 * as its tooltip; the main action always worded) or in its detail's footer (`"always"`).
 */
export function agentPluginActions(
  entry: AgentPluginGroup,
  title: string,
  isOwner: boolean,
  actions: AgentPluginActions,
  where: "card" | "footer",
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
        words={where === "card" ? "wide" : "always"}
        busy={busy}
        disabled={disabled}
        onClick={() => actions.uninstall(entry)}
      />,
    );
  }
  return out;
}

export function AgentPluginCard({
  entry,
  row,
  title,
  locale,
  categoryTitle,
  installs,
  isOwner,
  actions,
  onOpen,
}: {
  entry: AgentPluginGroup;
  /** The library's row of the plugin; undefined once it left the library. */
  row: PluginRow | undefined;
  title: string;
  locale: "zh" | "en";
  /** The library category's title; undefined once the plugin left the library. */
  categoryTitle: string | undefined;
  installs: AgentInstalls | undefined;
  isOwner: boolean;
  actions: AgentPluginActions;
  onOpen: () => void;
}) {
  const version = row === undefined ? undefined : rowVersion(row);
  const summary = partSummaryOf(entry);
  const meta: ReactNode[] = [];
  if (version !== undefined) {
    meta.push(
      <span key="version" className="shrink-0 font-mono">
        v{version}
      </span>,
    );
  }
  meta.push(<StatusWithMcp key="status" entry={entry} installs={installs} isOwner={isOwner} />);
  if (summary !== "") {
    meta.push(
      <span key="parts" className="min-w-0 truncate">
        {summary}
      </span>,
    );
  }
  const tags: ReactNode[] = [];
  if (categoryTitle !== undefined) tags.push(<PluginTag key="category">{categoryTitle}</PluginTag>);
  if (row !== undefined && rowBuiltin(row)) {
    tags.push(
      <PluginTag key="builtin" title={S.plugins.libraryBuiltinHint}>
        {S.plugins.builtin}
      </PluginTag>,
    );
  }
  if (row !== undefined && rowInstalledOnServer(row)) {
    tags.push(
      <PluginTag key="installed" title={S.plugins.installedOnServerHint}>
        {S.plugins.installedOnServer}
      </PluginTag>,
    );
  }
  return (
    <EntityCard
      framed={false}
      data-plugin={entry.name}
      lead={
        <SkillTile
          icon={row === undefined ? undefined : rowIcon(row)}
          name={entry.name}
          fallback={ICONS.puzzle}
          size={36}
          glyph={20}
        />
      }
      title={title}
      titleHint={entry.name}
      description={
        row === undefined
          ? S.agentPlugins.statusHint["not-in-library"]
          : rowShortDescription(row, locale)
      }
      meta={meta}
      tags={tags}
      actions={agentPluginActions(entry, title, isOwner, actions, "card")}
      onOpen={onOpen}
      onBodyClick={cardBodyClick(onOpen)}
    />
  );
}
