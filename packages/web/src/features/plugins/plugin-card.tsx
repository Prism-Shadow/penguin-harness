/**
 * One plugin's card on the Plugins page — every plugin wears the same one, a library plugin of
 * Skills and hooks and a server module such as an Agent Sandbox backend alike: a rounded icon
 * tile (the plugin's own icon, else the puzzle piece) centred against its title (the package's
 * display name, else the plugin's name) and the one-line description (the "no description"
 * placeholder, in the same muted ink, when the package carries none), a metadata line
 * `v<npm version> · <status> · used by N agents` (the last for a plugin with Skills or hooks
 * only), and a tag line (plugin-marks.tsx `pluginTags`, the set an Agent's plugin row shows too) —
 * the category (outside the category's own section), "built in", where a module runs. The card
 * body opens the detail dialog; the actions sit beside it, light icon buttons whose words show
 * once the card is wide enough:
 *
 * - Skills / hooks / MCP servers (any member): the update nudge while an Agent is behind (the
 *   plugins trail's last stop, so it carries the dot), quick start, and "manage installs" — a
 *   dialog listing every Agent of the Project with Install / Installed (Uninstall on hover, for
 *   the Project owner, whose alone an uninstall is) / Update: this server's and each machine's own in one list, a machine's named `[SSH: alias]`
 *   after the Agent's name, every action on such a row going to that machine. A machine out of
 *   reach keeps its rows, greyed and inert with the reason, as it last answered; an Agent whose
 *   installs have not been answered yet keeps its row too, its Install held until they are.
 *   Installing a plugin with a stdio MCP server on an Agent that lacks it asks first, showing the
 *   command it runs on the Agent's server, and an update's confirmation shows it too (the
 *   reinstall writes the servers again). Beside an Agent whose copy of the plugin's MCP
 *   servers waits for vault values or a sign-in, marks say so, and the Project owner gets Set up,
 *   which writes those values into the Agent's vault. The list's first row, 「新建空白 Agent」,
 *   opens the Create agent dialog over it, prefilled with the plugin (blank-agent.tsx); the new
 *   Agent then joins the list.
 * - A server module: Install, or Remove, for an admin only; a member reads the card and its
 *   dialog, with no way in to change the server.
 *
 * The dialog's footer repeats the same actions with their words, after Export — the package as
 * a zip another server imports, for any member whenever its package is on this server — and,
 * for an admin, Delete on a package an admin installed on the server.
 *
 * Until this server has said what its own Agents hold (or, for a module, what its tables list),
 * the status and "used by" on the metadata line are fixed-width placeholders, so the first answer
 * replaces a bar rather than a word.
 *
 * The card, its buttons, its status mark and its facts line are the UI package's (`EntityCard`,
 * `EntityCardAction`, `StatusMark` through plugin-marks.tsx, `MetaLine`); this module fills them
 * for one plugin and owns its dialogs.
 */
import { useId, useState, type ReactNode } from "react";

import type { AgentSummary, PluginItem, QuickStartItem } from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  Button,
  ConfirmModal,
  EntityCard,
  EntityCardAction,
  GlyphIcon,
  ICON_SIZE,
  ICONS,
  Modal,
  Pill,
  Skeleton,
} from "@prismshadow/penguin-ui";
import type { InstallStage } from "../../api/endpoints";
import { toneInk } from "../../lib/tone";
import * as api from "../../api/endpoints";
import { useAgentAvatarSrc } from "../../lib/agent-avatar";
import { S } from "../../lib/strings";
import { cardBodyClick } from "../../lib/card-open";
import { downloadArchive } from "../agents/archive-download";
import { useLocale } from "../../state/locale";
import { agentDisplayName } from "../../state/project";
import { SkillTile } from "../skills";
import { PluginDetailModal, moduleOnThisServer } from "./plugin-detail";
import type { PluginRow } from "./plugin-groups";
import { McpServerMarks, McpSetUpModal, StdioInstallBody } from "./plugin-mcp";
import {
  PluginStatusMark,
  pluginTags,
  rowIcon,
  rowShortDescription,
  rowTitle,
  rowVersion,
  statusHint,
} from "./plugin-marks";
import {
  installNeedsConfirm,
  pluginMcpState,
  stdioServers,
  type InstalledMap,
  type LibraryUsage,
  type PluginStatus,
} from "./plugin-status";
import { PluginUpdateParts } from "./plugin-update-parts";
import { BlankAgentDialog, BlankAgentRow, type BlankAgentSource } from "./blank-agent";
import { toastApiError } from "../../lib/toast-api-error";

/** "Manage installs" button icon: the arrow landing in its tray. */
const INSTALL_ICON = ICONS.download;

/**
 * An Agent a library plugin can be installed on: one of this server's, or a machine's own.
 * `key` is what the page's install map and a usage's lists name it by (lib/agent-location.ts
 * `agentKey`): the id for this server's, so two machines' `default_agent`s stay two rows.
 */
export interface InstallTarget {
  key: string;
  agent: AgentSummary;
  /** The machine the Agent lives on, where installing it runs; null for this server. */
  machine: InstallMachine | null;
}

/** The machine an install target lives on, as the dialog reads it. */
export interface InstallMachine {
  machineId: string;
  /** Its ssh alias, written after the Agent's name. */
  label: string;
  /**
   * Whether its Agents can be acted on right now: connected, and its list answered in this page
   * load (lib/machine-agent-lists.ts). Absent reads as live.
   */
  live?: boolean;
  /** Why it is not live, in words; null while a connected machine's first answer is awaited. */
  reason?: string | null;
}

/**
 * A library plugin's quick start: what its package.json's `penguin.quick_start` declares, else its
 * first skill invoked by name (the prompt read at click time, in the UI language); null for a
 * plugin with neither.
 */
export function libraryQuickStart(
  plugin: Pick<PluginItem, "skills" | "quickStart">,
): QuickStartItem | null {
  if (plugin.quickStart !== undefined) return plugin.quickStart;
  const skill = plugin.skills[0];
  return skill === undefined
    ? null
    : { prompt: S.skills.quickInvokeText(skill.name), skills: [skill.name] };
}

/** Where a row's package downloads as a zip — a library plugin's, or a server module's on this server — or null when its package is not here. */
export function pluginArchiveUrl(row: PluginRow): string | null {
  if (row.library !== undefined) return api.libraryPluginArchiveUrl(row.library.name);
  if (row.module !== undefined && moduleOnThisServer(row.module)) {
    return api.registryPluginArchiveUrl(row.module.specifier);
  }
  return null;
}

export interface PluginCardProps {
  /** The surrounding group owns the card surface when false. */
  framed?: boolean;
  row: PluginRow;
  status: PluginStatus;
  /** The Agents its Skills and hooks are on; null for a server module alone. */
  usage: LibraryUsage | null;
  categoryTitle: string;
  /**
   * Whether the card's tags name its category: not inside a category's own section, whose title
   * already does. The detail dialog names it either way.
   */
  showCategory: boolean;
  /** Every Agent a library plugin can go on, for the manage-installs dialog, in the Agents page's order. */
  targets: readonly InstallTarget[];
  /** The manage-installs dialog's 「新建空白 Agent」 row (blank-agent.tsx); absent, the list has none. */
  blankAgent?: BlankAgentSource | null;
  installed: InstalledMap;
  /** Targets whose installs are not known yet (not answered, or failed): their rows wait. */
  unknown?: ReadonlySet<string>;
  /** Targets whose installs could not be read, with the failure in words. */
  failed?: ReadonlyMap<string, string>;
  /**
   * This server has not said yet what its own Agents (or, for a module, its tables) hold: the
   * status and "used by" are placeholders rather than a guess that the answer would overturn.
   */
  pending?: boolean;
  /** Whether there is a current Agent for quick start to open a draft on. */
  canQuickStart: boolean;
  /** Only an admin changes what the server runs. */
  isAdmin: boolean;
  /** The reader owns the Project: the vault is theirs to write, so Set up is too. */
  isOwner: boolean;
  /** The Project the Set up form writes an Agent's vault in; null before one is chosen. */
  projectId: string | null;
  /** This row's module install or removal is running. */
  busy: boolean;
  /** The install under way is a channel download: bytes received so far, the total when known. */
  progress?: { received: number; total: number | null } | null;
  /** The step the install under way has reached, as its stream says (api/endpoints.ts). */
  stage?: InstallStage | null;
  /** Another row's is: one at a time, so this one is held rather than queued. */
  blocked: boolean;
  /** The last server install of this row failed: why, said under the card with what to do next. */
  failure?: string | null;
  onDismissFailure?: () => void;
  /** The failure's next steps: the Plugin Sources settings, and the zip import. */
  onOpenSources?: () => void;
  onImportFile?: () => void;
  /** Uninstalls it from the server (admin; the page confirms first, naming the Agents that lose it). */
  onServerUninstall?: () => void;
  /**
   * An Install in the Agent dialog of a plugin that is not on the server yet: the page installs it
   * on the server first (an admin) or asks an admin to (a member), then on the Agent.
   */
  onInstallBeforeServer?: (key: string) => Promise<void>;
  /** The Agent dialog's row whose install-before-server is running, and the words it shows. */
  agentBusy?: { key: string; label: string } | null;
  onQuickStart: (plugin: PluginItem) => void;
  /** `key` names an install target (see {@link InstallTarget}). */
  onToggleInstall: (key: string, plugin: PluginItem, on: boolean) => Promise<boolean>;
  onUpdateOutdated: (name: string, keys: string[]) => Promise<void>;
  /** Asks to install (true) or remove (false) the server module; the page confirms first. */
  onModuleApply: (install: boolean) => void;
  /** An Agent's vault changed under the plugin's MCP servers (Set up saved): its servers are read again. */
  onRepair?: (() => void) | null;
  onMcpChanged: (key: string) => void;
}

export function PluginCard(props: PluginCardProps) {
  const { row, status, usage, categoryTitle, targets, installed } = props;
  const { locale } = useLocale();
  const avatarSrc = useAgentAvatarSrc();
  const sharedId = useId();
  const plugin = row.library;
  const [detailOpen, setDetailOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  // The Create agent dialog over the manage-installs list, opened by its first row.
  const [blankOpen, setBlankOpen] = useState(false);
  // Agents pending an update confirmation (null = none): an update is an overwriting reinstall,
  // so it is confirmed against the list of parts it rewrites before it runs.
  const [pendingUpdate, setPendingUpdate] = useState<string[] | null>(null);
  const [updating, setUpdating] = useState(false);
  // Agent pending an uninstall confirmation (null = none): uninstalling deletes the installed
  // files, local edits included.
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);
  // Agent pending the stdio confirm (null = none): installing runs a command on this server.
  const [pendingStdio, setPendingStdio] = useState<string | null>(null);
  // Agent whose Set up form is open (null = none).
  const [setUpAgent, setSetUpAgent] = useState<string | null>(null);
  const targetOf = (key: string) => targets.find((t) => t.key === key);
  /** An install target's name, its machine after it as the dialog lists it. */
  const nameOf = (key: string) => {
    const target = targetOf(key);
    if (target === undefined) return key;
    const name = agentDisplayName(target.agent);
    return target.machine === null ? name : `${name} ${S.chat.machineTag(target.machine.label)}`;
  };
  /** Where an install on these targets runs commands: the one machine they share, or this server. */
  const machineOf = (keys: readonly string[]): string | undefined => {
    const labels = new Set(keys.map((key) => targetOf(key)?.machine?.label ?? null));
    const [only] = labels;
    return labels.size === 1 && only !== null && only !== undefined ? only : undefined;
  };

  const hint = statusHint(row, status, usage);
  const version = rowVersion(row);
  const description = rowShortDescription(row, locale);
  // What the dialogs below call the plugin: what its card does.
  const title = rowTitle(row, locale);
  const behind = usage?.behind ?? [];

  const confirmUpdate = async () => {
    if (pendingUpdate === null || plugin === undefined) return;
    setUpdating(true);
    await props.onUpdateOutdated(plugin.name, pendingUpdate);
    setUpdating(false);
    setPendingUpdate(null);
  };

  // Where the package stands on this server, by kind (05 「插件库」 「安装模型」): built in (the build
  // ships it — never uninstalled from the server), on the server (an admin put it there, or a
  // Project lists its module), or not here yet.
  const builtIn =
    row.module?.shipped === true || (plugin !== undefined && plugin.source !== "installed");
  const onServer =
    !builtIn &&
    (plugin?.source === "installed" || (row.module !== undefined && row.module.state !== "none"));
  /** Not on the server yet, and the build's offline archive says it carries Agent content. */
  const preServerAgent =
    plugin === undefined && !builtIn && row.module?.entry?.offline?.library === true;
  const archiveUrl = pluginArchiveUrl(row);
  const exportPlugin = async (url: string) => {
    try {
      await downloadArchive(url, row.name);
    } catch (e) {
      toastApiError(e);
    }
  };

  /**
   * The card's actions: on the card their words show once it is wide (the glyph alone before
   * that), in the dialog's footer always.
   */
  const actions = (where: "card" | "footer"): ReactNode[] => {
    const out: ReactNode[] = [];
    const words = where === "card" ? "wide" : "always";
    // The dialog's first: what any member may take away — the package itself.
    if (where === "footer" && archiveUrl !== null) {
      out.push(
        <EntityCardAction
          key="export"
          glyph={ICONS.download}
          label={S.plugins.exportPlugin}
          name={`${S.plugins.exportPlugin} ${row.name}`}
          hint={S.plugins.exportPluginHint}
          words={words}
          onClick={() => void exportPlugin(archiveUrl)}
        />,
      );
    }
    if (plugin !== undefined && behind.length > 0) {
      // Light (secondary): an update nudge, not the card's primary action. The last stop on the
      // plugins trail, so on the card it carries the dot itself, straddling the button's corner.
      out.push(
        <EntityCardAction
          key="update"
          variant="secondary"
          glyph={ICONS.rotateCw}
          label={S.plugins.updateOutdated(behind.length)}
          name={`${S.plugins.updateOutdated(behind.length)} ${plugin.name}`}
          words={words}
          dot={where === "card"}
          onClick={() => setPendingUpdate(behind)}
        />,
      );
    }
    if (plugin !== undefined && libraryQuickStart(plugin) !== null) {
      out.push(
        <EntityCardAction
          key="quick"
          glyph={ICONS.paperPlane}
          label={S.skills.quickInvoke}
          name={`${S.skills.quickInvoke} ${plugin.name}`}
          hint={S.plugins.quickStartHint}
          words={words}
          disabled={!props.canQuickStart}
          onClick={() => props.onQuickStart(plugin)}
        />,
      );
    }
    // The two installs, each with its own control (05 「插件库」 「安装模型」): the Agent's — any
    // member, for a plugin with Agent content, even before it is on the server when the build
    // carries it offline — and the server's.
    if (plugin !== undefined || preServerAgent) {
      out.push(
        <EntityCardAction
          key="agent"
          glyph={ICONS.robot}
          label={S.plugins.installModel.installAgent}
          name={`${S.plugins.installModel.installAgent} ${row.name}`}
          words={words}
          disabled={!onServer && props.blocked}
          onClick={() => setInstallOpen(true)}
        />,
      );
    }
    const mod = row.module;
    const words_ = S.plugins.installModel;
    // A download reports itself: the percent while the total is known, a pulse before that;
    // the other steps say which one the stream reached. npm's own fetches stay "installing".
    const total = props.progress?.total ?? null;
    const percent =
      props.progress != null && total !== null && total > 0
        ? Math.floor((props.progress.received / total) * 100)
        : null;
    const stepWords =
      props.progress != null
        ? S.plugins.downloading(percent)
        : props.stage?.stage === "loading"
          ? words_.loading
          : props.stage?.stage === "installing" && props.stage.source === "offline"
            ? words_.fromOffline
            : words_.installing;
    /** A member's server control: held, saying why. */
    const memberHold = props.isAdmin ? {} : { disabled: true, hint: words_.adminOnly };
    if (builtIn) {
      // Shipped with the build: never uninstalled from the server. A server module of it is
      // enabled or disabled for this Project (its listing), by an admin.
      if (mod !== undefined && props.isAdmin) {
        const install = mod.state === "none";
        const label = install
          ? props.busy
            ? stepWords
            : words_.enableModule
          : words_.disableModule;
        const blockedWhy = install ? undefined : mod.removeBlocked;
        out.push(
          <EntityCardAction
            key={install ? "module-install" : "module-remove"}
            glyph={ICONS.server}
            label={label}
            name={`${label} ${row.name}`}
            {...(blockedWhy !== undefined ? { hint: blockedWhy } : {})}
            words={props.busy ? "always" : words}
            busy={props.busy}
            aria-describedby={
              !install && mod.shared === true ? `${sharedId}-tag ${sharedId}-hint` : undefined
            }
            disabled={props.blocked || blockedWhy !== undefined}
            onClick={() => props.onModuleApply(install)}
          />,
        );
      }
    } else if (!onServer && mod !== undefined) {
      const label = props.busy ? stepWords : words_.installServer;
      out.push(
        <EntityCardAction
          key="server-install"
          glyph={ICONS.server}
          label={label}
          name={`${label} ${row.name}`}
          // Under way, the step is said in words at every width: a spinner alone says nothing.
          words={props.busy ? "always" : words}
          busy={props.busy}
          disabled={props.blocked}
          onClick={() => props.onModuleApply(true)}
          {...memberHold}
        />,
      );
    } else if (onServer) {
      const label = words_.uninstallServer;
      out.push(
        <EntityCardAction
          key="server-uninstall"
          glyph={ICONS.trash}
          label={label}
          name={`${label} ${row.name}`}
          words={words}
          busy={props.busy}
          disabled={props.blocked || props.onServerUninstall === undefined}
          onClick={() => props.onServerUninstall?.()}
          {...memberHold}
        />,
      );
    }
    if (props.onRepair != null && row.module?.unsatisfied !== undefined) {
      out.push(
        <EntityCardAction
          key="repair"
          glyph={ICONS.sparkles}
          label={S.plugins.repair}
          name={`${S.plugins.repair} ${row.name}`}
          words={words}
          disabled={props.busy || props.blocked}
          onClick={props.onRepair}
        />,
      );
    }
    return out;
  };

  const cardActions = actions("card");
  const footerActions = actions("footer");
  const tags = pluginTags(row, {
    categoryTitle: props.showCategory ? categoryTitle : undefined,
    sharedTagId: `${sharedId}-tag`,
  });
  return (
    <EntityCard
      {...(props.framed !== undefined ? { framed: props.framed } : {})}
      data-plugin={row.name}
      lead={
        <SkillTile
          icon={rowIcon(row)}
          name={row.name}
          fallback={ICONS.puzzle}
          size={36}
          glyph={20}
        />
      }
      // The package's display name, else the plugin's name (its id), set in the UI font as a
      // title; monospace is kept for what is code — the specifier on hover, the version.
      title={rowTitle(row, locale)}
      titleHint={row.module?.specifier ?? row.name}
      description={description}
      {...(props.failure != null
        ? {
            note: (
              <InstallFailureNote
                reason={props.failure}
                onOpenSources={props.onOpenSources}
                onImportFile={props.isAdmin ? props.onImportFile : undefined}
                onDismiss={props.onDismissFailure}
              />
            ),
          }
        : row.module?.unsatisfied !== undefined
          ? {
              note:
                row.module.state === "disabled"
                  ? row.module.unsatisfied
                  : S.plugins.runsPartly(row.module.unsatisfied),
            }
          : {})}
      meta={[
        version !== undefined && (
          <span key="version" className="shrink-0 font-mono">
            v{version}
          </span>
        ),
        props.pending === true ? (
          <Skeleton key="status" className="h-3 w-16 shrink-0" />
        ) : (
          <PluginStatusMark key="status" status={status} hint={hint} />
        ),
        usage !== null &&
          (props.pending === true ? (
            <Skeleton key="used-by" className="h-3 w-24 shrink-0" />
          ) : (
            <span key="used-by" className="min-w-0 truncate" data-testid="plugin-used-by">
              {S.plugins.usedByAgents(usage.usedBy.length)}
            </span>
          )),
      ]}
      tags={tags}
      actions={cardActions}
      onOpen={() => setDetailOpen(true)}
      onBodyClick={cardBodyClick(() => setDetailOpen(true))}
    >
      {row.module?.shared === true && (
        <span id={`${sharedId}-hint`} className="sr-only">
          {S.plugins.sharedHint}
        </span>
      )}

      {detailOpen && (
        <PluginDetailModal
          row={row}
          head={{
            status: <PluginStatusMark status={status} hint={hint} />,
            categoryTitle,
            usedBy: usage === null ? null : usage.usedBy.length,
          }}
          footer={footerActions.length > 0 ? <>{footerActions}</> : null}
          onClose={() => setDetailOpen(false)}
        />
      )}
      {installOpen && (plugin !== undefined || preServerAgent) && (
        <Modal
          open
          title={S.plugins.installModel.installAgentTitle(title)}
          onClose={() => {
            setInstallOpen(false);
            setBlankOpen(false);
          }}
        >
          {/* How the Agent installs relate to the server, said before any click. */}
          {!builtIn && (
            <p className="mb-2 text-xs text-fg-muted">
              {onServer
                ? S.plugins.installModel.onServer
                : props.isAdmin
                  ? S.plugins.installModel.notOnServerAdmin
                  : S.plugins.installModel.notOnServerMember}
            </p>
          )}
          <div className="space-y-1">
            {/* A blank Agent is created with the plugin, so the row needs the library's copy. */}
            {props.blankAgent != null && plugin !== undefined && (
              <BlankAgentRow
                disabled={props.projectId === null}
                onOpen={() => setBlankOpen(true)}
              />
            )}
            {targets.length === 0 && (
              <p className="py-1.5 text-xs text-gray-400">{S.common.loading}</p>
            )}
            {plugin === undefined &&
              targets.map((t) => (
                <InstallRow
                  key={t.key}
                  agentId={t.agent.agentId}
                  name={agentDisplayName(t.agent)}
                  avatarSrc={avatarSrc(t.agent.agentId, t.machine?.machineId ?? null)}
                  machine={t.machine?.label ?? null}
                  installed={false}
                  outdated={false}
                  mcp={null}
                  // Before the server has it, only this server's Agents can take it: a machine's
                  // Agent installs from that machine's own server.
                  held={
                    t.machine !== null
                      ? { reason: S.plugins.installModel.machineFirst, off: true, busy: false }
                      : props.agentBusy != null && props.agentBusy.key !== t.key
                        ? { reason: props.agentBusy.label, off: false, busy: false }
                        : null
                  }
                  {...(props.agentBusy?.key === t.key ? { busyLabel: props.agentBusy.label } : {})}
                  isOwner={props.isOwner}
                  onToggle={(on) => {
                    if (on) void props.onInstallBeforeServer?.(t.key);
                  }}
                  onUpdate={() => {}}
                  onSetUp={() => {}}
                />
              ))}
            {plugin !== undefined &&
              targets.map((t) => (
                <InstallRow
                  key={t.key}
                  agentId={t.agent.agentId}
                  name={agentDisplayName(t.agent)}
                  avatarSrc={avatarSrc(t.agent.agentId, t.machine?.machineId ?? null)}
                  machine={t.machine?.label ?? null}
                  installed={usage?.usedBy.includes(t.key) ?? false}
                  outdated={behind.includes(t.key)}
                  mcp={pluginMcpState(plugin, installed.get(t.key))}
                  held={heldRow(t, props.unknown, props.failed)}
                  isOwner={props.isOwner}
                  onToggle={(on) => {
                    // Install runs directly, unless it brings a stdio server: that runs a command on
                    // the Agent's server, so it confirms first. Uninstall deletes the installed
                    // files, so it confirms too.
                    if (!on) setPendingUninstall(t.key);
                    else if (installNeedsConfirm(plugin, installed.get(t.key))) {
                      setPendingStdio(t.key);
                    } else void props.onToggleInstall(t.key, plugin, true);
                  }}
                  onUpdate={() => setPendingUpdate([t.key])}
                  onSetUp={() => setSetUpAgent(t.key)}
                />
              ))}
          </div>
        </Modal>
      )}
      {/* A sibling of the list's dialog rather than inside it, so the list's panel never handles
          the create dialog's keys; opened later, it sits on top and takes the first Escape. */}
      {plugin !== undefined && installOpen && blankOpen && props.blankAgent != null && (
        <BlankAgentDialog
          plugin={plugin}
          title={title}
          projectId={props.projectId}
          source={props.blankAgent}
          onClose={() => setBlankOpen(false)}
        />
      )}
      {plugin !== undefined && pendingUpdate !== null && (
        <ConfirmModal
          open
          title={S.plugins.updateConfirmTitle(title)}
          tone="primary"
          // Wide enough for a Skill's name beside its `old → new` versions, read whole.
          widthClass="sm:max-w-lg"
          confirmLabel={S.skills.updateAction}
          cancelLabel={S.common.cancel}
          busy={updating}
          onClose={() => setPendingUpdate(null)}
          onConfirm={() => void confirmUpdate()}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {S.plugins.updateConfirmWarning(title)}
            </p>
            {/* Per Agent, the parts the reinstall rewrites, old → new, so it is clear exactly what gets overwritten. */}
            <PluginUpdateParts
              plugin={plugin}
              agents={pendingUpdate.map((key) => ({
                key,
                name: nameOf(key),
                installs: installed.get(key),
              }))}
            />
            {/* The reinstall writes the plugin's stdio servers again — perhaps one the Agent did
                not carry, or a changed command: what each runs here is said before it does. */}
            {stdioServers(plugin).length > 0 && (
              <StdioInstallBody plugin={plugin} machine={machineOf(pendingUpdate)} />
            )}
          </div>
        </ConfirmModal>
      )}
      {plugin !== undefined && pendingUninstall !== null && (
        <ConfirmModal
          open
          title={S.plugins.uninstallConfirmTitle(title)}
          confirmLabel={S.skills.uninstall}
          cancelLabel={S.common.cancel}
          onClose={() => setPendingUninstall(null)}
          onConfirm={() => {
            const key = pendingUninstall;
            setPendingUninstall(null);
            void props.onToggleInstall(key, plugin, false);
          }}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.plugins.uninstallConfirmBody(
              title,
              nameOf(pendingUninstall),
              plugin.mcpServers.length > 0,
            )}
            {(plugin.workbenches?.length ?? 0) > 0 && ` ${S.plugins.uninstallWorkbenchRecords}`}
          </p>
        </ConfirmModal>
      )}
      {plugin !== undefined && pendingStdio !== null && (
        <ConfirmModal
          open
          title={S.plugins.installStdioTitle(title, nameOf(pendingStdio))}
          tone="primary"
          glyph={ICONS.terminalPrompt}
          confirmLabel={S.skills.install}
          cancelLabel={S.common.cancel}
          onClose={() => setPendingStdio(null)}
          onConfirm={() => {
            const key = pendingStdio;
            setPendingStdio(null);
            void props.onToggleInstall(key, plugin, true);
          }}
        >
          <StdioInstallBody
            plugin={plugin}
            lead={S.plugins.installStdioTitle(title, nameOf(pendingStdio))}
            machine={machineOf([pendingStdio])}
          />
        </ConfirmModal>
      )}
      {plugin !== undefined && setUpAgent !== null && props.projectId !== null && (
        <McpSetUpModal
          projectId={props.projectId}
          agentId={targetOf(setUpAgent)?.agent.agentId ?? setUpAgent}
          machineId={targetOf(setUpAgent)?.machine?.machineId ?? null}
          agentName={nameOf(setUpAgent)}
          title={title}
          plugin={plugin}
          onClose={() => setSetUpAgent(null)}
          onSaved={() => props.onMcpChanged(setUpAgent)}
        />
      )}
    </EntityCard>
  );
}

/** Why a target's row cannot act right now, or null when it can (see {@link InstallRow}'s `held`). */
function heldRow(
  target: InstallTarget,
  unknown: ReadonlySet<string> | undefined,
  failed: ReadonlyMap<string, string> | undefined,
): RowHold | null {
  const machine = target.machine;
  if (machine !== null && machine.live === false) {
    return {
      reason: machine.reason ?? S.plugins.waitingFor(machine.label),
      off: true,
      busy: false,
    };
  }
  if (unknown?.has(target.key) !== true) return null;
  const failure = failed?.get(target.key);
  if (failure !== undefined) return { reason: failure, off: false, busy: false };
  return {
    reason: machine === null ? S.common.loading : S.plugins.waitingFor(machine.label),
    off: false,
    busy: true,
  };
}

/** A row held from acting: why, whether its machine is out of reach, and whether it is being asked. */
export interface RowHold {
  reason: string;
  /** The machine cannot be acted on: the row is greyed, as the Agents page greys its cards. */
  off: boolean;
  /** The Agent's installs are being asked for: the Install button says it is busy. */
  busy: boolean;
}

/**
 * One Agent row in the "manage installs" dialog: an Agent without the plugin shows "Install";
 * one with it shows "Installed", switching to "Uninstall" on hover for the Project owner (the
 * same button carries the uninstall, which the server takes from the owner alone) and a plain
 * label for anyone else; a copy the server lists as behind additionally shows "Update" (reinstall =
 * update). Install and uninstall go through the page's optimistic updates, rolling back on
 * failure. Where the Agent carries the plugin's MCP servers, marks beside its name say what
 * they wait for — vault values, a sign-in — and a Project owner gets Set up for the values. A
 * machine's Agent names its machine after its name, the way a machine's Workspace group does.
 *
 * A held row keeps its place and its last state, every button disabled with the reason as its
 * hint: a machine out of reach greys the row; an Agent whose installs are still unknown shows
 * Install, held, until they are answered — never "not installed" on the strength of no answer.
 */
export function InstallRow({
  agentId,
  name,
  avatarSrc,
  machine = null,
  installed,
  outdated,
  mcp,
  held = null,
  busyLabel,
  isOwner,
  onToggle,
  onUpdate,
  onSetUp,
}: {
  agentId: string;
  name: string;
  /** The Agent's own picture, when it has one (lib/agent-avatar.ts). */
  avatarSrc?: string | undefined;
  /** The ssh alias of the machine the Agent lives on; null for this server. */
  machine?: string | null;
  installed: boolean;
  outdated: boolean;
  /** What the plugin's MCP servers on this Agent wait for; null when it carries none. */
  mcp: { missingKeys: string[]; signIn: boolean } | null;
  /** Why the row cannot act right now; null when it can. */
  held?: RowHold | null;
  /** The row's install is running: its button holds, saying which step it is at. */
  busyLabel?: string;
  isOwner: boolean;
  onToggle: (on: boolean) => void;
  onUpdate: () => void;
  onSetUp: () => void;
}) {
  /** Who the row's buttons act on, for their names: two machines' Agents can share an id. */
  const who = machine === null ? agentId : `${agentId} ${S.chat.machineTag(machine)}`;
  /** A held row's buttons: disabled, the reason as their hint. */
  const hold =
    held === null
      ? {}
      : { disabled: true, title: held.reason, "data-tooltip-extra": true as const };
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/60 ${held?.off === true ? "opacity-60" : ""}`}
    >
      <AgentAvatar id={agentId} size={22} className="shrink-0 rounded" src={avatarSrc} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className="min-w-0 truncate text-sm"
          data-tooltip={agentId}
          data-tooltip-extra
          data-tooltip-content="text"
        >
          {name}
        </span>
        {machine !== null && (
          <span className="shrink-0 font-mono text-xs text-gray-400 dark:text-gray-500">
            {S.chat.machineTag(machine)}
          </span>
        )}
      </span>
      {mcp !== null && (
        <McpServerMarks
          keys={mcp.missingKeys}
          where={isOwner ? S.plugins.mcpSetUpWhere : S.plugins.mcpSetUpByOwner}
          signIn={mcp.signIn}
        />
      )}
      {mcp !== null && isOwner && mcp.missingKeys.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          aria-label={`${S.plugins.setUp} ${who}`}
          onClick={onSetUp}
          {...hold}
        >
          {S.plugins.setUp}
        </Button>
      )}
      {installed && outdated && (
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          aria-label={`${S.skills.updateAction} ${who}`}
          onClick={onUpdate}
          {...hold}
        >
          {S.skills.updateAction}
        </Button>
      )}
      {installed && !isOwner ? (
        <Pill tone="success">{S.skills.installed}</Pill>
      ) : installed ? (
        // group: on hover the button's copy switches "Installed" → "Uninstall" (the same button
        // carries the uninstall action) — not on a held row, whose button does nothing.
        <Button
          size="sm"
          variant="ghost"
          className={`shrink-0 ${held === null ? "group" : ""}`}
          aria-label={`${S.skills.uninstall} ${who}`}
          onClick={() => onToggle(false)}
          {...hold}
        >
          <span className="group-hover:hidden">{S.skills.installed}</span>
          {held === null && (
            <span className="hidden text-red-600 group-hover:inline dark:text-red-400">
              {S.skills.uninstall}
            </span>
          )}
        </Button>
      ) : (
        <Button
          size="sm"
          className="shrink-0"
          aria-label={`${S.skills.install} ${who}`}
          onClick={() => onToggle(true)}
          {...hold}
          {...(busyLabel !== undefined ? { disabled: true } : {})}
          {...(held?.busy === true || busyLabel !== undefined ? { "aria-busy": true } : {})}
        >
          {busyLabel ?? S.skills.install}
        </Button>
      )}
    </div>
  );
}

/**
 * Why a server install failed, under the card that was clicked, with what to do next instead of a
 * dead end (05 「插件库」 「安装从不卡住」): another registry or mirror in Plugin Sources, or a zip
 * import (an admin's). Attention ink with its mark, never red text; it stays until dismissed or
 * the next attempt.
 */
export function InstallFailureNote({
  reason,
  onOpenSources,
  onImportFile,
  onDismiss,
}: {
  reason: string;
  onOpenSources?: (() => void) | undefined;
  onImportFile?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
}) {
  const words = S.plugins.installModel;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="install-failure">
      <span className={`inline-flex min-w-0 items-baseline gap-1 ${toneInk.attention}`}>
        <GlyphIcon
          d={ICONS.triangleAlert}
          size={ICON_SIZE.inlineGlyph}
          className="shrink-0 self-center"
        />
        <span className="min-w-0 break-words">{words.failedNote(reason)}</span>
      </span>
      {onOpenSources !== undefined && (
        <Button variant="link" size="sm" onClick={onOpenSources}>
          {words.sourcesSettings}
        </Button>
      )}
      {onImportFile !== undefined && (
        <Button variant="link" size="sm" onClick={onImportFile}>
          {words.importFromFile}
        </Button>
      )}
      {onDismiss !== undefined && (
        <Button variant="link" size="sm" onClick={onDismiss}>
          {words.dismiss}
        </Button>
      )}
    </span>
  );
}

/**
 * The body of a server install's confirm, or of a built-in module's enable or disable: what it
 * does, naming the plugin (the compact confirm card renders no title), then — in small, quiet
 * type, not a warning box — what it costs the runs in progress.
 */
export function ModuleApplyBody({
  mode,
  name,
}: {
  mode: "install" | "enable" | "disable";
  name: string;
}) {
  const words = S.plugins.installModel;
  return (
    <div className="space-y-2 text-sm">
      <p>
        {mode === "install"
          ? S.plugins.applyConfirmInstallBody(name)
          : mode === "enable"
            ? words.enableBody(name)
            : words.disableBody(name)}
      </p>
      <p className="text-xs text-fg-muted">{S.plugins.applyConfirmWarning(mode !== "disable")}</p>
    </div>
  );
}
