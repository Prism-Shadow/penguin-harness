/**
 * One plugin's card — every plugin wears the same one, a library plugin of Skills and hooks and
 * a server module such as an Agent Sandbox backend alike, in one of two layouts:
 *
 * - `cover`, the market's grid (the UI package's `CoverCard`): the plugin's cover
 *   (plugin-cover.tsx: the curation's picture, else the generated one), its title (the
 *   package's display name, else the plugin's name) on one line, the one-line description on
 *   two (the "no description" placeholder, in the same muted ink, when the package carries
 *   none), the tag line — "Selected" first for a plugin the curation selects, then
 *   plugin-marks.tsx `pluginTags` (the category outside its own tab, "built in", where a module
 *   runs) — and the facts line, with the card's controls at its end. There the facts are marks:
 *   `v<version>`, the status as its glyph alone and the people glyph with the count of Agents
 *   using it, their words on hover and for assistive technology, since a card that narrow has
 *   no room for the sentence beside two controls. A server module's unmet requirement, which
 *   the row card writes on a line of its own, follows the status's hover sentence.
 * - `row` (the default), for a list with no room for covers: the UI package's `EntityCard`, a
 *   rounded icon tile beside the same words, the facts in words —
 *   `v<npm version> · <status> · used by N agents`.
 *
 * The card body opens the detail; the actions sit beside it, light icon buttons whose words show
 * once the card is wide enough (never on a cover card, their words in the hint):
 *
 * - Skills / hooks / MCP servers (any member): the update nudge while an Agent is behind (the
 *   plugins trail's last stop, so it carries the dot), quick start, and "manage installs" — a
 *   dialog listing every Agent of the Project with Install / Installed (Uninstall on hover, for
 *   the Project owner, whose alone an uninstall is) / Update: this server's and each machine's
 *   own in one list, a machine's named `[SSH: alias]` after the Agent's name, every action on
 *   such a row going to that machine. A machine out of reach keeps its rows, greyed and inert
 *   with the reason, as it last answered; an Agent whose installs have not been answered yet
 *   keeps its row too, its Install held until they are.
 *   Installing a plugin with a stdio MCP server on an Agent that lacks it asks first, showing the
 *   command it runs on the Agent's server, and an update's confirmation shows it too (the
 *   reinstall writes the servers again). Beside an Agent whose copy of the plugin's MCP
 *   servers waits for vault values or a sign-in, marks say so, and the Project owner gets Set up,
 *   which writes those values into the Agent's vault.
 * - A server module: Install, or Remove, for an admin only; a member reads the card and its
 *   dialog, with no way in to change the server.
 *
 * The detail's hero repeats the same actions with their words, led by "Open" for a plugin whose
 * workbench is installed on an Agent of this server (the App Center's window) — "manage
 * installs" leads instead when there is nothing to open — and its footer bar holds the rest:
 * Export — the package as a zip another server imports, for any member whenever its package is
 * on this server — and, for an admin, Delete on a package an admin installed on the server.
 *
 * `surface="none"` draws no card at all, only the dialogs: the market opens a detail its link
 * names even when the tab or the search hides that card. The detail is open while `detailOpen`
 * says so when the caller passes it (the market keeps it in the URL), else the card keeps it
 * itself.
 *
 * Until this server has said what its own Agents hold (or, for a module, what its tables list),
 * the status and "used by" on the metadata line are fixed-width placeholders, so the first answer
 * replaces a bar rather than a word.
 *
 * The card, its buttons, its status mark and its facts line are the UI package's (`EntityCard` /
 * `CoverCard`, `EntityCardAction`, `StatusMark` through plugin-marks.tsx, `MetaLine`); this
 * module fills them for one plugin and owns its dialogs.
 */
import { useId, useState, type ReactNode } from "react";

import type {
  AgentSummary,
  PluginArt,
  PluginItem,
  QuickStartItem,
} from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  Button,
  ConfirmModal,
  CoverCard,
  EntityCard,
  EntityCardAction,
  ICONS,
  MetaLine,
  Modal,
  Pill,
  Skeleton,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { useAgentAvatarSrc } from "../../lib/agent-avatar";
import { S } from "../../lib/strings";
import { cardBodyClick } from "../../lib/card-open";
import { downloadArchive } from "../agents/archive-download";
import { useLocale } from "../../state/locale";
import { agentDisplayName } from "../../state/project";
import { SkillTile } from "../skills";
import { MarketPluginCard } from "./plugin-market-card";
import { PluginCover } from "./plugin-cover";
import { PluginDetailModal, moduleOnThisServer } from "./plugin-detail";
import type { PluginRow } from "./plugin-groups";
import { McpServerMarks, McpSetUpModal, StdioInstallBody } from "./plugin-mcp";
import {
  PluginStatusMark,
  PluginTag,
  PluginUsedByMark,
  pluginTags,
  rowIcon,
  rowNote,
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
  /** `row` (default): the icon tile beside the words. `cover`: the market's cover card. */
  layout?: "row" | "cover";
  /** `none` draws no card, only its dialogs: a detail opened by a link to a hidden card. */
  surface?: "card" | "none";
  /** The market offers a versioned install and a quick-start draft on the selected Agent. */
  marketCard?: boolean;
  currentAgentId?: string;
  /** Whether the detail is open, when the caller keeps it (the market: in the URL). */
  detailOpen?: boolean;
  /** The detail asks to open or close; with `detailOpen`, the caller decides. */
  onDetailOpenChange?: (open: boolean) => void;
  /** The curation's art for the plugin's package: the cover, and the detail's screenshots. */
  art?: PluginArt | null;
  /** The curation selects the plugin: a tag on the card, the eyebrow over the detail's name. */
  selected?: boolean;
  /**
   * Opens an app (`<agentId>/<workbench>`) of the plugin's installed on an Agent of this server;
   * absent, the detail offers no "Open".
   */
  onOpenApp?: (appId: string) => void;
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
  /** Another row's is: one at a time, so this one is held rather than queued. */
  blocked: boolean;
  onQuickStart: (plugin: PluginItem) => void;
  /** Deletes a package an admin installed on the server (the card has asked first). */
  onDeletePlugin: ((plugin: PluginItem) => Promise<void>) | null;
  /** `key` names an install target (see {@link InstallTarget}). */
  onToggleInstall: (key: string, plugin: PluginItem, on: boolean) => Promise<boolean>;
  onUpdateOutdated: (name: string, keys: string[]) => Promise<void>;
  /** Asks to install (true) or remove (false) the server module; the page confirms first. */
  onModuleApply: (install: boolean, updateTo?: string) => void;
  /** Package updates apply to the machine whose registry supplied the card. */
  showPackageUpdates?: boolean;
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
  const [ownDetailOpen, setOwnDetailOpen] = useState(false);
  const detailOpen = props.detailOpen ?? ownDetailOpen;
  const setDetailOpen = (open: boolean) => {
    if (props.onDetailOpenChange !== undefined) props.onDetailOpenChange(open);
    if (props.detailOpen === undefined) setOwnDetailOpen(open);
  };
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
  const currentId = props.currentAgentId;
  const onAgent =
    currentId !== undefined &&
    plugin !== undefined &&
    pluginComplete(plugin, installed.get(currentId));

  const confirmUpdate = async () => {
    if (pendingUpdate === null || plugin === undefined) return;
    setUpdating(true);
    await props.onUpdateOutdated(plugin.name, pendingUpdate);
    setUpdating(false);
    setPendingUpdate(null);
  };

  const archiveUrl = pluginArchiveUrl(row);
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
        t.machine === null &&
        installed.get(t.key)?.workbenches?.get(workbench.name)?.plugin === plugin!.name,
    );
    if (on === undefined) continue;
    openWorkbench.set(workbench.name, () => openApp!(`${on.agent.agentId}/${workbench.name}`));
  }
  const [firstOpen] = openWorkbench.values();

  /**
   * The card's actions: on the card their words show once it is wide (the glyph alone before
   * that). The detail splits them: its hero holds the main ones with their words, "Open" or
   * "manage installs" primary and first; its footer bar what takes the package away — export,
   * and an admin's delete.
   */
  const actions = (where: "card" | "hero" | "footer"): ReactNode[] => {
    const out: ReactNode[] = [];
    const words = where === "card" ? "wide" : "always";
    if (where === "footer") {
      // What any member may take away — the package itself.
      if (archiveUrl !== null) {
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
      // An admin's package of Skills or hooks leaves the server from its detail; a server
      // module's Remove does the same for one with modules.
      if (props.isAdmin && plugin?.source === "installed" && props.onDeletePlugin !== null) {
        out.push(
          <EntityCardAction
            key="delete"
            glyph={ICONS.trash}
            label={S.plugins.deletePlugin}
            name={`${S.plugins.deletePlugin} ${plugin.package}`}
            words={words}
            disabled={deleting}
            onClick={() => setPendingDelete(true)}
          />,
        );
      }
      return out;
    }
    const manage =
      plugin === undefined ? null : (
        <EntityCardAction
          key="manage"
          {...(where === "hero" && firstOpen === undefined ? { variant: "primary" as const } : {})}
          glyph={INSTALL_ICON}
          label={S.skills.manageInstall}
          name={`${S.skills.manageInstall} ${plugin.name}`}
          words={words}
          onClick={() => setInstallOpen(true)}
        />
      );
    if (where === "hero") {
      if (firstOpen !== undefined && plugin !== undefined) {
        out.push(
          <EntityCardAction
            key="open"
            variant="primary"
            glyph={ICONS.appWindow}
            label={S.plugins.openApp}
            name={`${S.plugins.openApp} ${plugin.name}`}
            hint={S.plugins.openAppHint}
            words={words}
            onClick={firstOpen}
          />,
        );
      } else if (manage !== null) out.push(manage);
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
          hint={onAgent ? S.plugins.quickStartHint : S.plugins.quickStartAfterInstall}
          words={words}
          disabled={!props.canQuickStart}
          onClick={() => props.onQuickStart(plugin)}
        />,
      );
    }
    // In the hero it leads unless "Open" does.
    if (manage !== null && (where === "card" || firstOpen !== undefined)) out.push(manage);
    const mod = row.module;
    if (mod !== undefined && props.isAdmin) {
      // Not listed: Install. Listed: Remove — and, in the all-machines view of a module listed
      // for some machines only, Install too, which asks every machine to run it.
      const localInstall = props.showPackageUpdates ? mod.entry?.localInstall : undefined;
      const update = localInstall?.updateAvailable ? mod.entry : undefined;
      if (update !== undefined) {
        const label = S.plugins.updatePackageTo(update.version);
        out.push(
          <EntityCardAction
            key="package-update"
            variant="secondary"
            glyph={ICONS.rotateCw}
            label={label}
            name={`${label} ${row.name}`}
            words={words}
            busy={props.busy}
            disabled={props.blocked}
            onClick={() => props.onModuleApply(true, update.version)}
          />,
        );
      }
      const verbs: boolean[] = [
        ...(mod.state === "none" && update === undefined && !localInstall?.libraryOnly
          ? [true]
          : []),
        ...(mod.state !== "none" ? [false] : []),
      ];
      for (const install of verbs) {
        // A channel download reports itself: the percent while the total is known, a pulse
        // before that. npm's own fetches stay "installing" — npm reports no progress here.
        const total = props.progress?.total ?? null;
        const percent =
          props.progress != null && total !== null && total > 0
            ? Math.floor((props.progress.received / total) * 100)
            : null;
        const label = install
          ? props.busy
            ? props.progress != null
              ? S.plugins.downloading(percent)
              : S.plugins.installing
            : S.plugins.install
          : S.plugins.uninstall;
        // A removal another Project still needs says why it cannot run, as its marked hint.
        const blockedWhy = install ? undefined : mod.removeBlocked;
        out.push(
          <EntityCardAction
            key={install ? "module-install" : "module-remove"}
            glyph={install ? INSTALL_ICON : ICONS.trash}
            label={label}
            name={`${label} ${row.name}`}
            {...(blockedWhy !== undefined ? { hint: blockedWhy } : {})}
            words={words}
            busy={props.busy}
            aria-describedby={
              !install && mod.shared === true ? `${sharedId}-tag ${sharedId}-hint` : undefined
            }
            disabled={props.blocked || blockedWhy !== undefined}
            onClick={() => props.onModuleApply(install)}
          />,
        );
      }
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
  const heroActions = actions("hero");
  const footerActions = actions("footer");
  const selected = props.selected === true;
  const tags = [
    // The curation's pick, first: a plain tag, no colour of its own.
    ...(selected ? [<PluginTag key="selected">{S.plugins.selected}</PluginTag>] : []),
    ...pluginTags(row, {
      categoryTitle: props.showCategory ? categoryTitle : undefined,
      sharedTagId: `${sharedId}-tag`,
    }),
  ];
  const cover = props.layout === "cover";
  // What the build cannot run of a server module: the row card's note line. The cover card has
  // none, so there the status's hover sentence carries it after its own.
  const note = rowNote(row);
  const meta = [
    version !== undefined && (
      <span key="version" className="shrink-0 font-mono">
        v{version}
      </span>
    ),
    props.pending === true ? (
      <Skeleton key="status" className={`h-3 shrink-0 ${cover ? "w-4" : "w-16"}`} />
    ) : cover ? (
      // The cover card's facts share their line with its controls: the status is its glyph,
      // its word and sentence on hover and for assistive technology.
      <PluginStatusMark
        key="status"
        status={status}
        hint={note === undefined ? hint : `${hint} ${note}`}
        wordless
      />
    ) : (
      <PluginStatusMark key="status" status={status} hint={hint} />
    ),
    usage !== null &&
      (props.pending === true ? (
        <Skeleton key="used-by" className={`h-3 shrink-0 ${cover ? "w-8" : "w-24"}`} />
      ) : cover ? (
        // Likewise the used-by count: the people glyph and the number, the sentence on hover.
        <PluginUsedByMark key="used-by" count={usage.usedBy.length} />
      ) : (
        <span key="used-by" className="min-w-0 truncate" data-testid="plugin-used-by">
          {S.plugins.usedByAgents(usage.usedBy.length)}
        </span>
      )),
  ];
  const quickStart = plugin === undefined ? null : libraryQuickStart(plugin);

  const dialogs = (
    <>
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
          art={props.art ?? null}
          selected={selected}
          {...(heroActions.length > 0 ? { actions: <>{heroActions}</> } : {})}
          quickStart={
            plugin === undefined || quickStart === null
              ? null
              : {
                  item: quickStart,
                  onStart: () => props.onQuickStart(plugin),
                  disabled: !props.canQuickStart,
                }
          }
          openWorkbench={openWorkbench}
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
            {targets.length === 0 && (
              <p className="py-1.5 text-xs text-gray-400">{S.common.loading}</p>
            )}
            {targets.map((t) => (
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
      {plugin !== undefined && pendingDelete && props.onDeletePlugin !== null && (
        <ConfirmModal
          open
          title={S.plugins.deleteConfirmTitle(plugin.package)}
          confirmLabel={S.plugins.deletePlugin}
          cancelLabel={S.common.cancel}
          busy={deleting}
          onClose={() => setPendingDelete(false)}
          onConfirm={() => {
            setDeleting(true);
            void props.onDeletePlugin!(plugin).finally(() => {
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
    </>
  );

  if (props.surface === "none") return dialogs;
  if (props.marketCard) {
    const mod = row.module;
    const local = props.showPackageUpdates ? mod?.entry?.localInstall : undefined;
    const release = mod?.entry?.version;
    const downloadUpdate =
      Boolean(local?.updateAvailable) && release !== undefined && props.isAdmin;
    const agentPackage = plugin !== undefined && agentInstallable(plugin);
    const updateAgent = currentId !== undefined && behind.includes(currentId);
    const download = !agentPackage && mod?.state === "none" && !local?.libraryOnly;
    const installedHere = agentPackage ? onAgent : Boolean(local || (mod && mod.state !== "none"));
    const installVersion = downloadUpdate || download ? release : version;
    const verb =
      downloadUpdate || updateAgent
        ? S.skills.updateAction
        : installedHere
          ? S.skills.installed
          : S.skills.install;
    const installLabel = props.busy
      ? S.plugins.installing
      : installVersion
        ? `${verb} v${installVersion}`
        : verb;
    const needAgent =
      !props.canQuickStart || (currentId !== undefined && props.unknown?.has(currentId));
    return (
      <>
        <MarketPluginCard
          layout={cover ? "cover" : "row"}
          name={row.name}
          title={title}
          description={description}
          detailsLabel={title}
          cover={<PluginCover row={row} art={props.art ?? null} />}
          icon={
            <SkillTile
              icon={rowIcon(row)}
              name={row.name}
              fallback={ICONS.puzzle}
              size={36}
              glyph={20}
            />
          }
          onOpen={() => setDetailOpen(true)}
          install={{
            label: installLabel,
            disabled:
              props.pending === true ||
              props.busy ||
              props.blocked ||
              ((download || downloadUpdate) && !props.isAdmin),
            onClick: () => {
              if (downloadUpdate || download)
                props.onModuleApply(true, mod?.shipped ? undefined : release);
              else if (agentPackage) {
                if (updateAgent) setPendingUpdate([currentId!]);
                else if (currentId === undefined || installedHere || needAgent)
                  setInstallOpen(true);
                else if (installNeedsConfirm(plugin, installed.get(currentId)))
                  setPendingStdio(currentId);
                else void props.onToggleInstall(currentId, plugin, true);
              } else setDetailOpen(true);
            },
          }}
          quick={{
            label: S.plugins.quickAction,
            hint:
              plugin === undefined
                ? S.plugins.quickStartAfterInstall
                : quickStart === null
                  ? S.plugins.noQuickAction
                  : onAgent
                    ? S.plugins.quickStartHint
                    : S.plugins.quickStartAfterInstall,
            disabled: needAgent === true || !onAgent || quickStart === null,
            onClick: () => {
              if (plugin && onAgent && quickStart) props.onQuickStart(plugin);
            },
          }}
        />
        {dialogs}
      </>
    );
  }
  if (cover) {
    return (
      <CoverCard
        // Its own container: the actions' words show only on a card wider than any grid gives
        // one, so on the cover card they are glyphs, their words in the hint.
        className="@container"
        data-plugin={row.name}
        cover={<PluginCover row={row} art={props.art ?? null} />}
        title={title}
        titleHint={row.module?.specifier ?? row.name}
        description={description}
        tags={tags}
        meta={<MetaLine>{meta}</MetaLine>}
        actions={cardActions}
        onOpen={() => setDetailOpen(true)}
      >
        {dialogs}
      </CoverCard>
    );
  }
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
      title={title}
      titleHint={row.module?.specifier ?? row.name}
      description={description}
      {...(note !== undefined ? { note } : {})}
      meta={meta}
      tags={tags}
      actions={cardActions}
      onOpen={() => setDetailOpen(true)}
      onBodyClick={cardBodyClick(() => setDetailOpen(true))}
    >
      {dialogs}
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
          {...(held?.busy === true ? { "aria-busy": true } : {})}
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
