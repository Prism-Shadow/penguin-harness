/**
 * One plugin's card on the Plugins page — every plugin wears the same one, a library plugin of
 * Skills and hooks and a server module such as an Agent Sandbox backend alike: a rounded icon
 * tile (the plugin's own icon, else the puzzle piece) centred against its title (the package's
 * display name, else the plugin's name) and the one-line description (the "no description"
 * placeholder, in the same muted ink, when the package carries none), a metadata line
 * `v<npm version> · <status> · used by N agents` (the last for a plugin with Skills or hooks
 * only), and a tag line — the category (outside the category's own section), "built in", where
 * a module runs. The card body opens the detail dialog; the actions sit beside it, light icon
 * buttons whose words show once the card is wide enough:
 *
 * - Skills / hooks / MCP servers (any member): the update nudge while an Agent is behind (the
 *   plugins trail's last stop, so it carries the dot), quick start, and "manage installs" — a
 *   dialog listing every Agent of the Project with Install / Installed (Uninstall on hover) /
 *   Update. Installing a plugin with a stdio MCP server on an Agent that lacks it asks first,
 *   showing the command it runs on this server, and an update's confirmation shows it too (the
 *   reinstall writes the servers again). Beside an Agent whose copy of the plugin's MCP
 *   servers waits for vault values or a sign-in, marks say so, and the Project owner gets Set up,
 *   which writes those values into the Agent's vault.
 * - A server module: Install, or Remove, for an admin only; a member reads the card and its
 *   dialog, with no way in to change the server.
 *
 * The dialog's footer repeats the same actions with their words, after Export — the package as
 * a zip another server imports, for any member whenever its package is on this server — and,
 * for an admin, Delete on a package an admin installed on the server.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { AgentSummary, PluginItem, QuickStartItem } from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  Button,
  ConfirmModal,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Modal,
  StatusIcon,
  UpdateDot,
  toastError,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { downloadArchive } from "../agents/archive-download";
import { useLocale } from "../../state/locale";
import { agentDisplayName } from "../../state/project";
import { SkillTile } from "../skills/skill-icon-view";
import { MetaLine, PluginDetailModal, moduleOnThisServer } from "./plugin-detail";
import type { PluginRow } from "./plugin-groups";
import { McpServerMarks, McpSetUpModal, StdioInstallBody } from "./plugin-mcp";
import {
  PluginTag,
  StatusMark,
  rowBuiltin,
  rowInstalledOnServer,
  rowIcon,
  rowShortDescription,
  rowTitle,
  rowVersion,
  statusHint,
} from "./plugin-marks";
import {
  changedParts,
  installNeedsConfirm,
  pluginMcpState,
  stdioServers,
  type InstalledMap,
  type LibraryUsage,
  type PluginStatus,
} from "./plugin-status";

/** "Manage installs" button icon: the arrow landing in its tray. */
const INSTALL_ICON = ICONS.download;

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
  /** Every Agent of the Project, for the manage-installs dialog. */
  agents: readonly AgentSummary[];
  installed: InstalledMap;
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
  /** Another row's is: one at a time, so this one is held rather than queued. */
  blocked: boolean;
  onQuickStart: (plugin: PluginItem) => void;
  /** Deletes a package an admin installed on the server (the card has asked first). */
  onDeletePlugin: (plugin: PluginItem) => Promise<void>;
  onToggleInstall: (agentId: string, plugin: PluginItem, on: boolean) => Promise<boolean>;
  onUpdateOutdated: (name: string, agentIds: string[]) => Promise<void>;
  /** Asks to install (true) or remove (false) the server module; the page confirms first. */
  onModuleApply: (install: boolean) => void;
  /** An Agent's vault changed under the plugin's MCP servers (Set up saved): its servers are read again. */
  onMcpChanged: (agentId: string) => void;
}

export function PluginCard(props: PluginCardProps) {
  const { row, status, usage, categoryTitle, agents, installed } = props;
  const { locale } = useLocale();
  const plugin = row.library;
  const [detailOpen, setDetailOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  // Agents pending an update confirmation (null = none): an update is an overwriting reinstall,
  // so it is confirmed against the list of parts it rewrites before it runs.
  const [pendingUpdate, setPendingUpdate] = useState<string[] | null>(null);
  const [updating, setUpdating] = useState(false);
  // Agent pending an uninstall confirmation (null = none): uninstalling deletes the installed
  // files, local edits included.
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);
  // Delete-from-server waiting for its confirmation, and running.
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Agent pending the stdio confirm (null = none): installing runs a command on this server.
  const [pendingStdio, setPendingStdio] = useState<string | null>(null);
  // Agent whose Set up form is open (null = none).
  const [setUpAgent, setSetUpAgent] = useState<string | null>(null);
  const nameOf = (agentId: string) => {
    const agent = agents.find((a) => a.agentId === agentId);
    return agent ? agentDisplayName(agent) : agentId;
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
  const uninstallAgent =
    pendingUninstall !== null ? agents.find((a) => a.agentId === pendingUninstall) : undefined;

  const archiveUrl = pluginArchiveUrl(row);
  const exportPlugin = async (url: string) => {
    try {
      await downloadArchive(url, row.name);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  /** The card's actions: icon buttons on the card, labelled buttons in the dialog's footer. */
  const actions = (where: "card" | "footer"): ReactNode[] => {
    const out: ReactNode[] = [];
    const look = where === "card" ? "h-8 shrink-0" : "shrink-0";
    const words = (text: string) =>
      where === "card" ? <span className="hidden @3xl:inline">{text}</span> : <span>{text}</span>;
    // The dialog's first: what any member may take away — the package itself.
    if (where === "footer" && archiveUrl !== null) {
      out.push(
        <Button
          key="export"
          size="sm"
          className={look}
          aria-label={`${S.plugins.exportPlugin} ${row.name}`}
          title={S.plugins.exportPluginHint}
          onClick={() => void exportPlugin(archiveUrl)}
        >
          <GlyphIcon d={ICONS.download} size={ICON_SIZE.iconButton} />
          {words(S.plugins.exportPlugin)}
        </Button>,
      );
    }
    if (plugin !== undefined && behind.length > 0) {
      // Light (secondary): an update nudge, not the card's primary action. The last stop on the
      // plugins trail, so on the card it carries the dot itself, straddling the button's corner.
      out.push(
        <Button
          key="update"
          size="sm"
          variant="secondary"
          className={`relative ${look}`}
          aria-label={`${S.plugins.updateOutdated(behind.length)} ${plugin.name}`}
          title={S.plugins.updateOutdated(behind.length)}
          onClick={() => setPendingUpdate(behind)}
        >
          <GlyphIcon d={ICONS.rotateCw} size={ICON_SIZE.iconButton} />
          {words(S.plugins.updateOutdated(behind.length))}
          {where === "card" && (
            <UpdateDot
              size="inline"
              position="right-0.5 top-0.5 -translate-y-1/2 translate-x-1/2"
            />
          )}
        </Button>,
      );
    }
    if (plugin !== undefined && libraryQuickStart(plugin) !== null) {
      out.push(
        <Button
          key="quick"
          size="sm"
          className={look}
          aria-label={`${S.skills.quickInvoke} ${plugin.name}`}
          title={S.plugins.quickStartHint}
          disabled={!props.canQuickStart}
          onClick={() => props.onQuickStart(plugin)}
        >
          <GlyphIcon d={ICONS.paperPlane} size={ICON_SIZE.iconButton} />
          {words(S.skills.quickInvoke)}
        </Button>,
      );
    }
    if (plugin !== undefined) {
      out.push(
        <Button
          key="manage"
          size="sm"
          className={look}
          aria-label={`${S.skills.manageInstall} ${plugin.name}`}
          title={S.skills.manageInstall}
          onClick={() => setInstallOpen(true)}
        >
          <GlyphIcon d={INSTALL_ICON} size={ICON_SIZE.iconButton} />
          {words(S.skills.manageInstall)}
        </Button>,
      );
    }
    const mod = row.module;
    if (mod !== undefined && props.isAdmin) {
      // Not listed: Install. Listed: Remove — and, in the all-machines view of a module listed
      // for some machines only, Install too, which asks every machine to run it.
      const verbs: boolean[] = [
        ...(mod.state === "none" || mod.state === "elsewhere" ? [true] : []),
        ...(mod.state !== "none" ? [false] : []),
      ];
      for (const install of verbs) {
        const label = install
          ? props.busy
            ? S.plugins.installing
            : S.plugins.install
          : S.plugins.uninstall;
        out.push(
          <Button
            key={install ? "module-install" : "module-remove"}
            size="sm"
            className={look}
            aria-label={`${label} ${row.name}`}
            aria-busy={props.busy}
            title={install ? label : (mod.removeBlocked ?? label)}
            disabled={props.busy || props.blocked || (!install && mod.removeBlocked !== undefined)}
            onClick={() => props.onModuleApply(install)}
          >
            {props.busy ? (
              <StatusIcon state="running" />
            ) : (
              <GlyphIcon d={install ? INSTALL_ICON : ICONS.trash} size={ICON_SIZE.iconButton} />
            )}
            {words(label)}
          </Button>,
        );
      }
    }
    // An admin's package of Skills or hooks leaves the server from its dialog; a server module's
    // Remove above does the same for one with modules.
    if (where === "footer" && props.isAdmin && plugin?.source === "installed") {
      out.push(
        <Button
          key="delete"
          size="sm"
          className={look}
          aria-label={`${S.plugins.deletePlugin} ${plugin.package}`}
          disabled={deleting}
          onClick={() => setPendingDelete(true)}
        >
          <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
          {words(S.plugins.deletePlugin)}
        </Button>,
      );
    }
    return out;
  };

  const cardActions = actions("card");
  const footerActions = actions("footer");
  const tags: ReactNode[] = [];
  if (props.showCategory) tags.push(<PluginTag key="category">{categoryTitle}</PluginTag>);
  if (rowBuiltin(row)) {
    tags.push(
      <PluginTag
        key="builtin"
        title={plugin !== undefined ? S.plugins.libraryBuiltinHint : S.plugins.builtinHint}
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
  if (row.module?.onlyOn !== undefined) {
    tags.push(
      <PluginTag key="only-on">{S.plugins.onlyOn(row.module.onlyOn.join(", "))}</PluginTag>,
    );
  }
  return (
    <div className="@container flex items-center gap-3 rounded-md p-4 transition-colors hover:bg-gray-100/70 dark:hover:bg-gray-800/60">
      <button
        type="button"
        onClick={() => setDetailOpen(true)}
        className="min-w-0 flex-1 text-left"
      >
        {/* The icon centred across the name and the description, one line each. */}
        <div className="flex items-center gap-3">
          <SkillTile
            icon={rowIcon(row)}
            name={row.name}
            fallback={ICONS.puzzle}
            size={36}
            glyph={20}
          />
          <div className="min-w-0 flex-1">
            {/* The package's display name, else the plugin's name (its id), set in the UI font as
                a title; monospace is kept for what is code — the specifier on hover, the version. */}
            <span
              className="block truncate text-sm font-semibold"
              data-tooltip={row.module?.specifier ?? row.name}
              data-tooltip-content="code"
            >
              {rowTitle(row, locale)}
            </span>
            <p
              className="mt-0.5 truncate text-xs leading-5 text-gray-500 dark:text-gray-400"
              data-tooltip={description}
              data-tooltip-content="text"
            >
              {description}
            </p>
          </div>
        </div>
        <div className="mt-2.5">
          <MetaLine>
            {version !== undefined && <span className="shrink-0 font-mono">v{version}</span>}
            <StatusMark status={status} hint={hint} />
            {usage !== null && (
              <span className="min-w-0 truncate">
                {S.plugins.usedByAgents(usage.usedBy.length)}
              </span>
            )}
          </MetaLine>
        </div>
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">{tags}</div>
        )}
      </button>
      {cardActions.length > 0 && (
        <div className="flex shrink-0 items-center justify-center gap-1.5">{cardActions}</div>
      )}

      {detailOpen && (
        <PluginDetailModal
          row={row}
          head={{
            status,
            statusHint: hint,
            categoryTitle,
            usedBy: usage === null ? null : usage.usedBy.length,
          }}
          footer={footerActions.length > 0 ? <>{footerActions}</> : null}
          onClose={() => setDetailOpen(false)}
        />
      )}
      {plugin !== undefined && installOpen && (
        <Modal
          open
          title={S.skills.manageInstallTitle(title)}
          onClose={() => setInstallOpen(false)}
        >
          <div className="space-y-1">
            {agents.length === 0 && (
              <p className="py-1.5 text-xs text-gray-400">{S.common.loading}</p>
            )}
            {agents.map((a) => (
              <InstallRow
                key={a.agentId}
                agentId={a.agentId}
                name={agentDisplayName(a)}
                installed={usage?.usedBy.includes(a.agentId) ?? false}
                outdated={behind.includes(a.agentId)}
                mcp={pluginMcpState(plugin, installed.get(a.agentId))}
                isOwner={props.isOwner}
                onToggle={(on) => {
                  // Install runs directly, unless it brings a stdio server: that runs a command on
                  // this server, so it confirms first. Uninstall deletes the installed files, so it
                  // confirms too.
                  if (!on) setPendingUninstall(a.agentId);
                  else if (installNeedsConfirm(plugin, installed.get(a.agentId))) {
                    setPendingStdio(a.agentId);
                  } else void props.onToggleInstall(a.agentId, plugin, true);
                }}
                onUpdate={() => setPendingUpdate([a.agentId])}
                onSetUp={() => setSetUpAgent(a.agentId)}
              />
            ))}
          </div>
        </Modal>
      )}
      {plugin !== undefined && pendingUpdate !== null && (
        <ConfirmModal
          open
          title={S.plugins.updateConfirmTitle(title)}
          tone="primary"
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
            <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {pendingUpdate.map((agentId) => {
                const target = agents.find((a) => a.agentId === agentId);
                return (
                  <li key={agentId} className="px-3 py-1.5 text-xs">
                    <span className="block truncate">
                      {target ? agentDisplayName(target) : agentId}
                    </span>
                    {changedParts(plugin, installed.get(agentId)).map((part) => (
                      <span
                        key={`${part.kind}:${part.name}`}
                        className="mt-0.5 flex items-center justify-between gap-3 text-gray-500 dark:text-gray-400"
                      >
                        {part.kind === "hooks" ? (
                          <span className="min-w-0 truncate">{S.plugins.detailHooks}</span>
                        ) : part.kind === "mcp" ? (
                          <span className="min-w-0 truncate">
                            <span className="font-mono">{part.name}</span> (
                            {S.plugins.updatePartMcp})
                          </span>
                        ) : (
                          <span className="min-w-0 truncate font-mono">{part.name}</span>
                        )}
                        {part.kind === "mcp" ? (
                          <span className="shrink-0">{S.plugins.updatePartReplaced}</span>
                        ) : (
                          <span className="shrink-0 font-mono">
                            {part.installed || "?"} → {part.library}
                          </span>
                        )}
                      </span>
                    ))}
                  </li>
                );
              })}
            </ul>
            {/* The reinstall writes the plugin's stdio servers again — perhaps one the Agent did
                not carry, or a changed command: what each runs here is said before it does. */}
            {stdioServers(plugin).length > 0 && <StdioInstallBody plugin={plugin} />}
          </div>
        </ConfirmModal>
      )}
      {plugin !== undefined && pendingDelete && (
        <ConfirmModal
          open
          title={S.plugins.deleteConfirmTitle(plugin.package)}
          confirmLabel={S.plugins.deletePlugin}
          cancelLabel={S.common.cancel}
          busy={deleting}
          onClose={() => setPendingDelete(false)}
          onConfirm={() => {
            setDeleting(true);
            void props.onDeletePlugin(plugin).finally(() => {
              setDeleting(false);
              setPendingDelete(false);
              setDetailOpen(false);
            });
          }}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.plugins.deleteConfirmBody(plugin.package)}
          </p>
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
            const agentId = pendingUninstall;
            setPendingUninstall(null);
            void props.onToggleInstall(agentId, plugin, false);
          }}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.plugins.uninstallConfirmBody(
              title,
              uninstallAgent ? agentDisplayName(uninstallAgent) : pendingUninstall,
              plugin.mcpServers.length > 0,
            )}
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
            const agentId = pendingStdio;
            setPendingStdio(null);
            void props.onToggleInstall(agentId, plugin, true);
          }}
        >
          <StdioInstallBody
            plugin={plugin}
            lead={S.plugins.installStdioTitle(title, nameOf(pendingStdio))}
          />
        </ConfirmModal>
      )}
      {plugin !== undefined && setUpAgent !== null && props.projectId !== null && (
        <McpSetUpModal
          projectId={props.projectId}
          agentId={setUpAgent}
          agentName={nameOf(setUpAgent)}
          title={title}
          plugin={plugin}
          onClose={() => setSetUpAgent(null)}
          onSaved={() => props.onMcpChanged(setUpAgent)}
        />
      )}
    </div>
  );
}

/**
 * One Agent row in the "manage installs" dialog: an Agent without the plugin shows "Install";
 * one with it shows "Installed", switching to "Uninstall" on hover (the same button carries the
 * uninstall); a copy the server lists as behind additionally shows "Update" (reinstall =
 * update). Install and uninstall go through the page's optimistic updates, rolling back on
 * failure. Where the Agent carries the plugin's MCP servers, marks beside its name say what
 * they wait for — vault values, a sign-in — and a Project owner gets Set up for the values.
 */
export function InstallRow({
  agentId,
  name,
  installed,
  outdated,
  mcp,
  isOwner,
  onToggle,
  onUpdate,
  onSetUp,
}: {
  agentId: string;
  name: string;
  installed: boolean;
  outdated: boolean;
  /** What the plugin's MCP servers on this Agent wait for; null when it carries none. */
  mcp: { missingKeys: string[]; signIn: boolean } | null;
  isOwner: boolean;
  onToggle: (on: boolean) => void;
  onUpdate: () => void;
  onSetUp: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/60">
      <AgentAvatar id={agentId} name={name} size={22} className="shrink-0 rounded" />
      <span
        className="min-w-0 flex-1 truncate text-sm"
        data-tooltip={agentId}
        data-tooltip-content="text"
      >
        {name}
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
          aria-label={`${S.plugins.setUp} ${agentId}`}
          onClick={onSetUp}
        >
          {S.plugins.setUp}
        </Button>
      )}
      {installed && outdated && (
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          aria-label={`${S.skills.updateAction} ${agentId}`}
          onClick={onUpdate}
        >
          {S.skills.updateAction}
        </Button>
      )}
      {installed ? (
        // group: on hover the button's copy switches "Installed" → "Uninstall" (the same button carries the uninstall action).
        <Button
          size="sm"
          variant="ghost"
          className="group shrink-0"
          aria-label={`${S.skills.uninstall} ${agentId}`}
          onClick={() => onToggle(false)}
        >
          <span className="group-hover:hidden">{S.skills.installed}</span>
          <span className="hidden text-red-600 group-hover:inline dark:text-red-400">
            {S.skills.uninstall}
          </span>
        </Button>
      ) : (
        <Button
          size="sm"
          className="shrink-0"
          aria-label={`${S.skills.install} ${agentId}`}
          onClick={() => onToggle(true)}
        >
          {S.skills.install}
        </Button>
      )}
    </div>
  );
}

/**
 * The body of a server module's install or removal confirm: what it does to the server, naming
 * the plugin (the compact confirm card renders no title), then — in small, quiet type, not a
 * warning box — what it costs the runs in progress.
 */
export function ModuleApplyBody({ install, name }: { install: boolean; name: string }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        {install ? S.plugins.applyConfirmInstallBody(name) : S.plugins.applyConfirmRemoveBody(name)}
      </p>
      <p className="text-xs text-fg-muted">{S.plugins.applyConfirmWarning(install)}</p>
    </div>
  );
}
