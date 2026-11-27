/**
 * One plugin in the market — every plugin is one, a library plugin of Skills and hooks and a
 * server module such as an Agent Sandbox backend alike — on one of three surfaces:
 *
 * - `card`, the market's grid, and `row`, its list (the UI package's `StoreCard`): the plugin's
 *   icon, its title (the package's display name, else the plugin's name) on one line, the
 *   one-line description, a short line of facts (the machine it came from, who uses it, its
 *   category outside its own section) and its one action button. No cover: the cover is the
 *   page's. A press on the card opens the plugin's page (`href`, `onOpen`).
 * - `page`, the plugin's own page (plugin-detail.tsx `PluginPageView`): the same button at the
 *   head of the page, with the page's secondary actions beside it.
 *
 * The button is the same on every surface (plugin-action.ts): Install while nothing of the plugin
 * is in use, the step and the staged bar while a server install of it runs (the install runs on
 * the button, not in a dialog), Retry once one failed, then Open, the Agents' count, Update or
 * its state as a server module. A press goes where the next decision is: the install steps
 * (plugin-install-flow.tsx) — on the server's page while the plugin is not there (an admin
 * installs it, a member asks an admin), else on choosing Agents: every Agent of the Project with
 * Add / Added (Uninstall, for the Project owner, whose alone an uninstall is) / Update, this
 * server's and each machine's own in one list, a machine's named `[SSH: alias]` after the Agent's
 * name, every action on such a row going to that machine. A machine out of reach keeps its rows,
 * greyed and inert with the reason, as it last answered; an Agent whose installs have not been
 * answered yet keeps its row too, its Add held until they are. The list's first row, 「新建空白
 * Agent」, opens the Create agent dialog over it, prefilled with the plugin (blank-agent.tsx).
 *   Installing a plugin with a stdio MCP server on an Agent that lacks it asks first, showing the
 *   command it runs on the Agent's server, and an update's confirmation shows it too (the
 *   reinstall writes the servers again). Beside an Agent whose copy of the plugin's MCP servers
 *   waits for vault values or a sign-in, marks say so, and the Project owner gets Set up.
 *
 * What changes the server itself sits on the page, an admin's, in its More menu: uninstalling the
 * plugin from the server (from every Agent first, which the market's confirm names) and disabling
 * a server module the build ships for this Project; any member may export the package there.
 * Fix with AI stands beside what this build cannot run of the plugin, on the page's note.
 *
 * Until this server has said what its own Agents hold (or, for a module, what its tables list),
 * the button is Install, held, rather than a count the first answer would overturn.
 */
import { useId, useState, type MouseEvent, type ReactNode } from "react";

import type {
  AgentSummary,
  PluginArt,
  PluginItem,
  QuickStartItem,
} from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  AppIconShape,
  Button,
  ConfirmModal,
  Dropdown,
  GlyphIcon,
  ICONS,
  InstallButton,
  Menu,
  MenuItem,
  STORE_ICON_PX,
  StoreCard,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { useAgentAvatarSrc } from "../../lib/agent-avatar";
import { S } from "../../lib/strings";
import { apiUrl } from "../../lib/server-context";
import { locatedAppKey } from "../../lib/app-center-path";
import { downloadArchive } from "../agents/archive-download";
import { useLocale } from "../../state/locale";
import { agentDisplayName } from "../../state/project";
import { SkillTile } from "../skills";
import { packageUpdate } from "./plugin-package-update";
import type { InstallStage } from "../../api/endpoints";
import { InstallProgress } from "./install-bar";
import { installPlan } from "./install-progress";
import {
  InstallFailureNote,
  InstallFlow,
  InstallIcon,
  type InstallFailure,
  type ServerStep,
} from "./plugin-install-flow";
import { actionSizes, pluginAction } from "./plugin-action";
import { PluginPageView, moduleOnThisServer } from "./plugin-detail";
import type { PluginRow } from "./plugin-groups";
import { marketIcon } from "./plugin-market";
import { McpServerMarks, McpSetUpModal, StdioInstallBody } from "./plugin-mcp";
import {
  PluginStatusMark,
  rowShortDescription,
  rowTitle,
  rowVersion,
  statusHint,
} from "./plugin-marks";
import {
  agentInstallable,
  pluginComplete,
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

/** The same target names the selected action and its confirmation. */
function installTargetLabel(name: string, id: string | null, machine: string | null): string {
  const label = id === null ? name : `${name} (${id})`;
  return machine === null ? label : `${label} ${S.chat.machineTag(machine)}`;
}

/** The plugin's icon in the install steps' head and at the head of its page, in px. */
const FLOW_ICON_PX = 44;
const PAGE_ICON_PX = 72;

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

/** The plugin's icon on the app icon's outline, the App Center's, at a surface's size. */
function PluginIcon({ row, art, size }: { row: PluginRow; art: PluginArt | null; size: number }) {
  return (
    <AppIconShape size={size}>
      <SkillTile
        icon={marketIcon(row, art)}
        name={row.name}
        fallback={ICONS.puzzle}
        size={size}
        glyph={Math.round(size * 0.5)}
      />
    </AppIconShape>
  );
}

export interface PluginCardProps {
  /** `card` (default): the market's grid. `row`: its list. `page`: the plugin's own page. */
  surface?: "card" | "row" | "page";
  currentAgentId?: string;
  /** The plugin's page, for its card's opener: an address, and how a press goes there. */
  href?: string;
  onOpen?: (event: MouseEvent<HTMLElement>) => void;
  /** The curation's art for the plugin's package: the page's cover and screenshots. */
  art?: PluginArt | null;
  /** The curation selects the plugin: the line over the page's title. */
  selected?: boolean;
  /**
   * Opens an app (`<agentId>/<workbench>`) of the plugin's installed on an Agent of this server;
   * absent, nothing offers "Open".
   */
  onOpenApp?: (appId: string) => void;
  row: PluginRow;
  status: PluginStatus;
  /** The Agents its Skills and hooks are on; null for a server module alone. */
  usage: LibraryUsage | null;
  categoryTitle: string;
  /** Whether the card's facts name its category: not inside its category's own section. */
  showCategory: boolean;
  /** Every Agent a library plugin can go on, in the Agents page's order: the Agents step. */
  targets: readonly InstallTarget[];
  /** The Agents step's 「新建空白 Agent」 row (blank-agent.tsx); absent, the list has none. */
  blankAgent?: BlankAgentSource | null;
  installed: InstalledMap;
  /** Targets whose installs are not known yet (not answered, or failed): their rows wait. */
  unknown?: ReadonlySet<string>;
  /** Targets whose installs could not be read, with the failure in words. */
  failed?: ReadonlyMap<string, string>;
  /**
   * This server has not said yet what its own Agents (or, for a module, its tables) hold: the
   * button is Install, held, rather than a guess that the answer would overturn.
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
  /** This row's server change (an install, an update, a removal) is running. */
  busy: boolean;
  /** The install under way is a channel download: bytes received so far, the total when known. */
  progress?: { received: number; total: number | null } | null;
  /** The step the server install under way has reached, as its stream says (api/endpoints.ts). */
  stage?: InstallStage | null;
  /** Another row's is: one at a time, so this one is held rather than queued. */
  blocked: boolean;
  /** The last server install of this row failed: why, and where it stopped. */
  failure?: InstallFailure | null;
  /** A server install of this row is written for another machine, which fetches it itself. */
  remoteInstall?: boolean;
  onDismissFailure?: () => void;
  /** The failure's next steps: the Plugin Sources settings, and the zip import. */
  onOpenSources?: () => void;
  onImportFile?: () => void;
  /** Installs it on the server (an admin), or enables a shipped module: the server step's press. */
  onInstallServer?: () => void;
  /** Asks an admin to install it on the server (a member). */
  onAskAdmin?: () => Promise<void>;
  /** Uninstalls it from the server (an admin; the market confirms first, naming who loses it). */
  onServerUninstall?: () => void;
  onQuickStart: (plugin: PluginItem) => void;
  /** `key` names an install target (see {@link InstallTarget}). */
  onToggleInstall: (key: string, plugin: PluginItem, on: boolean) => Promise<boolean>;
  onUpdateOutdated: (name: string, keys: string[]) => Promise<void>;
  /** Asks to install (true) or remove (false) the server module, or update it to a version; the market confirms first. */
  onModuleApply: (install: boolean, updateTo?: string) => void;
  /** Package updates apply to the machine whose registry supplied the card. */
  showPackageUpdates?: boolean;
  /** Opens Fix with AI for a module the build cannot fully run; null without. */
  onRepair?: (() => void) | null;
  /** An Agent's vault changed under the plugin's MCP servers (Set up saved): its servers are read again. */
  onMcpChanged: (key: string) => void;
}

export function PluginCard(props: PluginCardProps) {
  const { row, status, usage, categoryTitle, targets, installed } = props;
  const surface = props.surface ?? "card";
  const { locale } = useLocale();
  const avatarSrc = useAgentAvatarSrc();
  const sharedId = useId();
  const plugin = row.library;
  // The install steps; the page the button opens them on is theirs to choose.
  const [installOpen, setInstallOpen] = useState(false);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);
  // The Create agent dialog over the Agents step, opened by its first row.
  const [blankOpen, setBlankOpen] = useState(false);
  // The targets the plugin was added to since the steps opened: what their last page reports.
  const [addedKeys, setAddedKeys] = useState<readonly string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const closeInstall = () => {
    setInstallOpen(false);
    setSelectedTargetKey(null);
    setBlankOpen(false);
    setAddedKeys([]);
  };
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
  // Count names only for open steps or a confirmation, not for every card in the market.
  const duplicateNames = new Set<string>();
  if (installOpen || pendingUpdate !== null) {
    const seen = new Set<string>();
    for (const { agent } of targets) {
      const name = agentDisplayName(agent);
      if (seen.has(name)) duplicateNames.add(name);
      seen.add(name);
    }
  }
  const targetOf = (key: string) => targets.find((t) => t.key === key);
  /** An install target's name, its machine after it as the dialog lists it. */
  const nameOf = (key: string) => {
    const target = targetOf(key);
    if (target === undefined) return key;
    const name = agentDisplayName(target.agent);
    return installTargetLabel(
      name,
      duplicateNames.has(name) ? target.agent.agentId : null,
      target.machine?.label ?? null,
    );
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
  const currentId = props.currentAgentId;
  const selectedTarget =
    targets.find((target) => target.key === selectedTargetKey) ??
    targets.find((target) => target.key === currentId) ??
    targets[0];
  const onAgent =
    currentId !== undefined &&
    plugin !== undefined &&
    pluginComplete(plugin, installed.get(currentId));

  // Where the package stands on this server: built in (the build ships it — never uninstalled
  // from the server), on the server (an admin put it there, or a Project lists its module), or
  // not here yet.
  const builtIn =
    row.module?.shipped === true || (plugin !== undefined && plugin.source !== "installed");
  const onServer =
    !builtIn &&
    (plugin?.source === "installed" || (row.module !== undefined && row.module.state !== "none"));
  /** Not on the server yet, and the build's offline archive says it carries Agent content. */
  const preServerAgent =
    plugin === undefined && !builtIn && row.module?.entry?.offline?.library === true;
  /** It has something for Agents: two steps; a plugin of server modules alone has one. */
  const agentContent = (plugin !== undefined && agentInstallable(plugin)) || preServerAgent;
  const contentsKnown = plugin !== undefined || builtIn || row.module?.entry?.offline !== undefined;
  // An Agent can already have a shipped Skill while its Project has yet to list the module.
  const shippedHybrid = plugin?.modules === true && row.module?.shipped === true;
  /** The steps' server step, for this plugin and this reader. */
  function installServerStep(): ServerStep {
    if (shippedHybrid && row.module?.state !== "active") {
      if (row.module?.state !== "none") return "unavailable";
      return props.isAdmin ? "enable" : "held";
    }
    if (plugin !== undefined || onServer || (builtIn && row.module?.state !== "none"))
      return "done";
    if (props.isAdmin) return builtIn ? "enable" : "install";
    return !builtIn && (agentContent || !contentsKnown) ? "ask" : "held";
  }
  const serverStep = installServerStep();
  /** The stages a server install of this plugin has for this reader: the bar's segments. */
  const plan = installPlan({
    server: serverStep === "install" || serverStep === "enable" ? serverStep : "none",
    remote: props.remoteInstall === true,
    modules: row.module?.entry?.offline?.modules ?? null,
    agents: false,
  });
  /** Adds the plugin to a target; the steps' last page names the ones that took it. */
  const addTo = async (key: string, item: PluginItem) => {
    if (await props.onToggleInstall(key, item, true)) {
      setAddedKeys((keys) => (keys.includes(key) ? keys : [...keys, key]));
    }
  };

  const confirmUpdate = async () => {
    if (pendingUpdate === null || plugin === undefined) return;
    setUpdating(true);
    await props.onUpdateOutdated(plugin.name, pendingUpdate);
    setUpdating(false);
    setPendingUpdate(null);
  };

  const archivePath = pluginArchiveUrl(row);
  const archiveUrl =
    archivePath && row.origin?.live !== false ? apiUrl(archivePath, row.origin?.machineId) : null;
  const exportPlugin = async (url: string) => {
    try {
      await downloadArchive(url, row.name);
    } catch (e) {
      toastApiError(e);
    }
  };

  /**
   * The workbenches of the plugin that open here, by name: each installed from this plugin on an
   * Agent of this server (the first such Agent in the list), opening as the caller says (the
   * market: the App Center's window). Without `onOpenApp`, none does.
   */
  const openWorkbench = new Map<string, () => void>();
  const openApp = props.onOpenApp;
  for (const workbench of openApp === undefined ? [] : (plugin?.workbenches ?? [])) {
    const on = targets.find(
      (t) =>
        t.machine?.live !== false &&
        installed.get(t.key)?.workbenches?.get(workbench.name)?.plugin === plugin!.name,
    );
    if (on === undefined) continue;
    openWorkbench.set(workbench.name, () =>
      openApp!(locatedAppKey(on.agent.agentId, workbench.name, on.machine?.machineId)),
    );
  }
  const [firstOpen] = openWorkbench.values();

  // The one button, the same on the card, the row and the page (plugin-action.ts).
  const mod = row.module;
  const local = props.showPackageUpdates ? mod?.entry?.localInstall : undefined;
  const release = local ? packageUpdate(mod?.entry) : null;
  const agentPackage = plugin !== undefined && agentInstallable(plugin);
  const updateAgents = behind.filter((key) => !usage?.lastSeen?.includes(key));
  const count = props.pending === true ? 0 : (usage?.usedBy.length ?? 0);
  const failure = props.busy ? null : (props.failure ?? null);
  const action = pluginAction({
    pending: props.pending === true,
    run: props.busy
      ? { phase: "running", stage: props.stage ?? null, progress: props.progress ?? null }
      : failure !== null
        ? { phase: "failed", stage: failure.stage, progress: failure.progress }
        : null,
    blocked: props.blocked && !props.busy,
    isAdmin: props.isAdmin,
    server: serverStep,
    agentContent,
    onServer: agentPackage,
    shippedHybrid,
    agents: count,
    behind: plugin === undefined ? 0 : updateAgents.length,
    packageUpdate: release?.to ?? null,
    canOpen: firstOpen !== undefined,
    module: mod?.state,
    status,
  });
  const press = () => {
    if (action.kind === "package-update" && release !== null) props.onModuleApply(true, release.to);
    else if (action.kind === "update") setPendingUpdate(updateAgents);
    else if (action.kind === "open") firstOpen?.();
    else setInstallOpen(true);
  };
  const installable = serverStep === "install" || serverStep === "enable" || props.busy;
  const progressBar = props.busy ? (
    <InstallProgress
      plan={plan}
      phase="running"
      stage={props.stage}
      progress={props.progress}
      size="xs"
      label={S.plugins.installModel.progressLabel(title)}
    />
  ) : undefined;
  // On the page the next action takes the accent; in a grid of many, every button is the quiet
  // one, as a store's list of Get buttons is, so the names lead and no row of fills shouts.
  const button = (size: "sm" | "md", accent: boolean) => (
    <InstallButton
      size={size}
      label={action.label}
      // In a grid every card's button is one width, so the buttons of a row line up.
      sizes={actionSizes(action, installable || !accent)}
      variant={accent && action.primary ? "primary" : "secondary"}
      running={action.kind === "running"}
      progress={progressBar}
      disabled={action.disabled}
      aria-label={`${action.label} · ${title}`}
      {...(action.hint !== undefined ? { title: action.hint, "data-tooltip-extra": true } : {})}
      data-action={action.kind}
      onClick={press}
    />
  );
  const iconMark = props.busy ? "running" : failure !== null ? "failed" : null;
  const quickStart = plugin === undefined ? null : libraryQuickStart(plugin);
  /** What the finished steps offer first: the plugin's app, else its example. */
  const flowNext = () => {
    if (firstOpen !== undefined) {
      return {
        label: S.plugins.openApp,
        onClick: () => {
          closeInstall();
          firstOpen();
        },
      };
    }
    if (plugin !== undefined && quickStart !== null && onAgent && props.canQuickStart) {
      return {
        label: S.plugins.quickAction,
        onClick: () => {
          closeInstall();
          props.onQuickStart(plugin);
        },
      };
    }
    return null;
  };

  const dialogs = (
    <>
      {mod?.shared === true && (
        <span id={`${sharedId}-hint`} className="sr-only">
          {S.plugins.sharedHint}
        </span>
      )}
      {installOpen && (
        <InstallFlow
          title={title}
          icon={<PluginIcon row={row} art={props.art ?? null} size={FLOW_ICON_PX} />}
          iconSize={FLOW_ICON_PX}
          {...(description !== S.plugins.noDescription && description !== S.plugins.shippedNoEntry
            ? { description }
            : {})}
          {...(version !== undefined ? { version } : {})}
          steps={agentContent ? 2 : 1}
          plan={plan}
          remote={props.remoteInstall === true}
          added={addedKeys.map(nameOf)}
          next={flowNext()}
          contentsKnown={contentsKnown}
          server={serverStep}
          {...(shippedHybrid
            ? {
                agentPackageAvailable: true,
                moduleStatus:
                  mod?.state === "none" ? S.plugins.installModel.projectServiceOff : hint,
              }
            : {})}
          {...(row.origin?.label ? { machineLabel: row.origin.label } : {})}
          {...(onServer && props.isAdmin && props.onServerUninstall
            ? { onRemoveServer: props.onServerUninstall }
            : {})}
          busy={props.busy}
          blocked={props.blocked}
          progress={props.progress ?? null}
          stage={props.stage ?? null}
          failure={failure}
          {...(props.onDismissFailure !== undefined
            ? { onDismissFailure: props.onDismissFailure }
            : {})}
          {...(props.onOpenSources !== undefined ? { onOpenSources: props.onOpenSources } : {})}
          {...(props.isAdmin && props.onImportFile !== undefined
            ? { onImportFile: props.onImportFile }
            : {})}
          onServer={() => props.onInstallServer?.()}
          onAsk={() => props.onAskAdmin?.() ?? Promise.resolve()}
          agents={
            plugin === undefined ? null : (
              <>
                {props.blankAgent != null && (
                  <BlankAgentRow
                    disabled={props.projectId === null}
                    onOpen={() => setBlankOpen(true)}
                  />
                )}
                <div
                  role="radiogroup"
                  aria-label={S.plugins.installModel.chooseAgent}
                  className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line"
                >
                  {targets.length === 0 && (
                    <p className="px-3 py-1.5 text-xs text-fg-muted">{S.common.loading}</p>
                  )}
                  {targets.map((t) => (
                    <InstallRow
                      key={t.key}
                      agentId={t.agent.agentId}
                      radioGroup={sharedId}
                      targetKey={t.key}
                      selected={selectedTarget?.key === t.key}
                      onSelect={() => setSelectedTargetKey(t.key)}
                      name={agentDisplayName(t.agent)}
                      showId={duplicateNames.has(agentDisplayName(t.agent))}
                      avatarSrc={avatarSrc(t.agent.agentId, t.machine?.machineId ?? null)}
                      machine={t.machine?.label ?? null}
                      installed={usage?.usedBy.includes(t.key) ?? false}
                      outdated={behind.includes(t.key)}
                      mcp={pluginMcpState(plugin, installed.get(t.key))}
                      held={heldRow(t, props.unknown, props.failed)}
                      isOwner={props.isOwner}
                      onToggle={(on) => {
                        // Install runs directly, unless it brings a stdio server: that runs a
                        // command on the Agent's server, so it confirms first. Uninstall deletes
                        // the installed files, so it confirms too.
                        if (!on) setPendingUninstall(t.key);
                        else if (installNeedsConfirm(plugin, installed.get(t.key))) {
                          setPendingStdio(t.key);
                        } else void addTo(t.key, plugin);
                      }}
                      onUpdate={() => setPendingUpdate([t.key])}
                      onSetUp={() => setSetUpAgent(t.key)}
                    />
                  ))}
                </div>
              </>
            )
          }
          onClose={closeInstall}
        />
      )}
      {/* A sibling of the steps' dialog rather than inside it, so the steps never handle the
          create dialog's keys; opened later, it sits on top and takes the first Escape. */}
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
            void addTo(key, plugin);
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
    </>
  );

  if (surface === "page") {
    // Beside the button: the quick start, the Agents that carry it (when the button says
    // something else), and a More menu of what changes the server or takes the package away.
    const secondary: ReactNode[] = [];
    if (plugin !== undefined && quickStart !== null) {
      secondary.push(
        <Button
          key="quick"
          size="md"
          variant="secondary"
          disabled={!props.canQuickStart || !onAgent}
          title={onAgent ? S.plugins.quickStartHint : S.plugins.quickStartAfterInstall}
          {...(onAgent ? {} : { "data-tooltip-extra": true })}
          onClick={() => props.onQuickStart(plugin)}
        >
          <GlyphIcon d={ICONS.paperPlane} />
          {S.skills.quickInvoke}
        </Button>,
      );
    }
    if (agentPackage && count > 0 && action.kind !== "agents") {
      secondary.push(
        <Button key="agents" size="md" variant="secondary" onClick={() => setInstallOpen(true)}>
          {S.plugins.marketAgentInstalls(count)}
        </Button>,
      );
    }
    const more: ReactNode[] = [];
    const pick = (run: () => void) => () => {
      setMoreOpen(false);
      run();
    };
    if (mod !== undefined && props.isAdmin && builtIn && mod.state !== "none") {
      const blockedWhy = mod.removeBlocked;
      more.push(
        <MenuItem
          key="module-remove"
          glyph={ICONS.server}
          label={S.plugins.installModel.disableModule}
          {...(blockedWhy !== undefined ? { trailing: blockedWhy } : {})}
          disabled={props.busy || props.blocked || blockedWhy !== undefined}
          onSelect={pick(() => props.onModuleApply(false))}
        />,
      );
    }
    if (onServer && props.isAdmin && props.onServerUninstall) {
      more.push(
        <MenuItem
          key="server-uninstall"
          glyph={ICONS.trash}
          danger
          label={S.plugins.installModel.uninstallServer}
          disabled={props.busy || props.blocked}
          onSelect={pick(props.onServerUninstall)}
        />,
      );
    }
    if (archiveUrl !== null) {
      more.push(
        <MenuItem
          key="export"
          glyph={ICONS.download}
          label={S.plugins.exportPlugin}
          description={S.plugins.exportPluginHint}
          onSelect={pick(() => void exportPlugin(archiveUrl))}
        />,
      );
    }
    if (more.length > 0) {
      secondary.push(
        <Dropdown
          key="more"
          open={moreOpen}
          setOpen={setMoreOpen}
          portal={{ direction: "down", align: "right" }}
          menuClass="w-72"
          button={
            <Button
              size="md"
              variant="secondary"
              aria-label={S.plugins.moreActions(title)}
              title={S.plugins.moreActionsHint}
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <GlyphIcon d={ICONS.ellipsis} />
            </Button>
          }
        >
          <Menu label={S.plugins.moreActionsHint}>{more}</Menu>
        </Dropdown>,
      );
    }
    return (
      <>
        <PluginPageView
          row={row}
          machineId={row.origin?.machineId ?? null}
          icon={
            <InstallIcon
              icon={<PluginIcon row={row} art={props.art ?? null} size={PAGE_ICON_PX} />}
              size={PAGE_ICON_PX}
              mark={iconMark}
            />
          }
          compactIcon={<PluginIcon row={row} art={props.art ?? null} size={28} />}
          action={button("md", true)}
          compactAction={button("sm", true)}
          secondary={secondary}
          note={
            failure !== null ? (
              <InstallFailureNote
                failure={failure.failure}
                onOpenSources={props.onOpenSources}
                onImportFile={props.isAdmin ? props.onImportFile : undefined}
                onDismiss={props.onDismissFailure}
              />
            ) : undefined
          }
          head={{
            status: <PluginStatusMark status={status} hint={hint} />,
            categoryTitle,
            usedBy: usage === null ? null : usage.usedBy.length,
          }}
          art={props.art ?? null}
          selected={props.selected === true}
          quickStart={
            plugin === undefined || quickStart === null
              ? null
              : {
                  item: quickStart,
                  onStart: () => props.onQuickStart(plugin),
                  disabled: !props.canQuickStart || !onAgent,
                }
          }
          openWorkbench={openWorkbench}
          repair={
            props.onRepair != null && mod?.unsatisfied !== undefined && !props.busy
              ? props.onRepair
              : undefined
          }
        />
        {dialogs}
      </>
    );
  }

  // The card's line of facts: where it came from (a machine), who uses it when the button does
  // not say so, and its category outside its own section.
  const facts = [
    row.origin?.label,
    count > 0 && action.kind !== "agents" ? S.plugins.usedByAgents(count) : undefined,
    props.showCategory ? categoryTitle : undefined,
  ].filter((fact): fact is string => fact !== undefined && fact !== "");
  const iconSize = STORE_ICON_PX[surface === "row" ? "row" : "card"];
  return (
    <StoreCard
      layout={surface === "row" ? "row" : "card"}
      data-plugin={row.name}
      aria-label={title}
      icon={
        <InstallIcon
          icon={<PluginIcon row={row} art={props.art ?? null} size={iconSize} />}
          size={iconSize}
          mark={iconMark}
        />
      }
      title={title}
      titleHint={mod?.specifier ?? row.name}
      description={description}
      {...(facts.length > 0
        ? {
            meta: (
              <span className="flex min-w-0 gap-3">
                {facts.map((fact, i) => (
                  <span
                    key={i}
                    className={i === facts.length - 1 ? "min-w-0 truncate" : "shrink-0"}
                  >
                    {fact}
                  </span>
                ))}
              </span>
            ),
          }
        : {})}
      action={button("sm", false)}
      {...(props.href !== undefined ? { href: props.href } : {})}
      {...(props.onOpen !== undefined ? { onOpen: props.onOpen } : {})}
    >
      {dialogs}
    </StoreCard>
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
 * One Agent row in the install steps' Agents page: an Agent without the plugin shows "Install";
 * an installed copy shows its status and a separate removal action for the Project owner; a copy the server lists as behind additionally shows "Update" (reinstall =
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
  targetKey,
  radioGroup,
  selected,
  onSelect,
  agentId,
  name,
  showId = false,
  avatarSrc,
  machine = null,
  installed,
  outdated,
  mcp,
  held = null,
  isOwner,
  onToggle,
  onUpdate,
  onSetUp,
}: {
  targetKey: string;
  radioGroup: string;
  selected: boolean;
  onSelect: () => void;
  agentId: string;
  name: string;
  showId?: boolean;
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
    <div className={held?.off ? "opacity-60" : undefined}>
      <label className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm text-fg hover:bg-surface-2">
        <input
          type="radio"
          name={radioGroup}
          value={targetKey}
          checked={selected}
          onChange={onSelect}
          className="shrink-0 accent-current"
        />
        <AgentAvatar id={agentId} size={22} className="shrink-0 rounded" src={avatarSrc} />
        <span className="min-w-0 flex-1 break-words">
          {name}
          {showId && <span className="block text-xs text-fg-muted">{agentId}</span>}
        </span>
        {machine !== null && (
          <span className="max-w-[35%] break-words text-xs text-fg-muted">
            {S.chat.machineTag(machine)}
          </span>
        )}
        {installed && (
          <span className="text-xs text-fg-muted">{S.plugins.installModel.addedToAgent}</span>
        )}
      </label>
      {selected && (
        <div className="flex flex-wrap items-center justify-end gap-2 px-3 pb-2.5">
          {held && <span className="mr-auto text-xs text-fg-muted">{held.reason}</span>}
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
          {installed && isOwner ? (
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              aria-label={`${S.skills.uninstall} ${who}`}
              onClick={() => onToggle(false)}
              {...hold}
            >
              {S.skills.uninstall}
            </Button>
          ) : !installed ? (
            <Button
              size="sm"
              variant="primary"
              className="shrink-0"
              aria-label={S.plugins.installModel.addToAgent(
                installTargetLabel(name, showId ? agentId : null, machine),
              )}
              onClick={() => onToggle(true)}
              {...hold}
              {...(held?.busy === true ? { "aria-busy": true } : {})}
            >
              {S.plugins.installModel.add}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The body of a server module's confirm — an install, a removal, or a shipped module's enable or
 * disable for this Project: what it does to the server, naming the plugin (the compact confirm
 * card renders no title), then — in small, quiet type, not a warning box — what it costs the runs
 * in progress.
 */
export function ModuleApplyBody({
  mode,
  name,
}: {
  mode: "install" | "remove" | "enable" | "disable";
  name: string;
}) {
  const words = S.plugins.installModel;
  return (
    <div className="space-y-2 text-sm">
      <p>
        {mode === "install"
          ? S.plugins.applyConfirmInstallBody(name)
          : mode === "remove"
            ? S.plugins.applyConfirmRemoveBody(name)
            : mode === "enable"
              ? words.enableBody(name)
              : words.disableBody(name)}
      </p>
      <p className="text-xs text-fg-muted">
        {S.plugins.applyConfirmWarning(mode === "install" || mode === "enable")}
      </p>
    </div>
  );
}
