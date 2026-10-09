/**
 * One plugin's card on the Plugins page — every plugin wears the same one, a library plugin of
 * Skills and hooks and a server module such as an Agent Sandbox backend alike: a rounded icon
 * tile (the plugin's own icon.svg, else the puzzle piece) centred against the name and the
 * one-line description, a metadata line `v<npm version> · <status> · used by N agents` (the
 * last for a plugin with Skills or hooks only), and a tag line — the category (outside the
 * category's own section), "built in", where a module runs. The card body opens the detail
 * dialog; the actions sit beside it, light icon buttons whose words show once the card is wide
 * enough:
 *
 * - Skills / hooks (any member): the update nudge while an Agent is behind (the plugins trail's
 *   last stop, so it carries the dot), quick start, and "manage installs" — a dialog listing
 *   every Agent of the Project with Install / Installed (Uninstall on hover) / Update.
 * - A server module: Install, or Remove, for an admin only; a member reads the card and its
 *   dialog, with no way in to change the server.
 *
 * The dialog's footer repeats the same actions with their words.
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
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { agentDisplayName } from "../../state/project";
import { SkillTile } from "../skills/skill-icon-view";
import { MetaLine, PluginDetailModal } from "./plugin-detail";
import type { PluginRow } from "./plugin-groups";
import {
  PluginTag,
  StatusMark,
  rowBuiltin,
  rowIcon,
  rowShortDescription,
  rowVersion,
  statusHint,
} from "./plugin-marks";
import {
  changedParts,
  type InstalledMap,
  type LibraryUsage,
  type PluginStatus,
} from "./plugin-status";

/** "Manage installs" button icon: the arrow landing in its tray. */
const INSTALL_ICON = ICONS.download;

/**
 * A library plugin's quick start: what its plugin.json declares, else its first skill invoked
 * by name (the prompt read at click time, in the UI language); null for a plugin with neither.
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
  /** This row's module install or removal is running. */
  busy: boolean;
  /** Another row's is: one at a time, so this one is held rather than queued. */
  blocked: boolean;
  onQuickStart: (plugin: PluginItem) => void;
  onToggleInstall: (agentId: string, plugin: PluginItem, on: boolean) => Promise<boolean>;
  onUpdateOutdated: (name: string, agentIds: string[]) => Promise<void>;
  /** Asks to install (true) or remove (false) the server module; the page confirms first. */
  onModuleApply: (install: boolean) => void;
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

  const hint = statusHint(row, status, usage);
  const version = rowVersion(row);
  const description = rowShortDescription(row, locale);
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

  /** The card's actions: icon buttons on the card, labelled buttons in the dialog's footer. */
  const actions = (where: "card" | "footer"): ReactNode[] => {
    const out: ReactNode[] = [];
    const look = where === "card" ? "h-8 shrink-0" : "shrink-0";
    const words = (text: string) =>
      where === "card" ? <span className="hidden @3xl:inline">{text}</span> : <span>{text}</span>;
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
            <span
              className="block truncate font-mono text-[length:var(--ui-text-code-size)] font-semibold"
              data-tooltip={row.module?.specifier ?? row.name}
              data-tooltip-content="code"
            >
              {row.name}
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
          title={S.skills.manageInstallTitle(plugin.name)}
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
                onToggle={(on) => {
                  // Install runs directly; uninstall deletes the installed files, so it confirms first.
                  if (on) void props.onToggleInstall(a.agentId, plugin, true);
                  else setPendingUninstall(a.agentId);
                }}
                onUpdate={() => setPendingUpdate([a.agentId])}
              />
            ))}
          </div>
        </Modal>
      )}
      {plugin !== undefined && pendingUpdate !== null && (
        <ConfirmModal
          open
          title={S.plugins.updateConfirmTitle(plugin.name)}
          tone="primary"
          confirmLabel={S.skills.updateAction}
          cancelLabel={S.common.cancel}
          busy={updating}
          onClose={() => setPendingUpdate(null)}
          onConfirm={() => void confirmUpdate()}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {S.plugins.updateConfirmWarning(plugin.name)}
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
                        ) : (
                          <span className="min-w-0 truncate font-mono">{part.name}</span>
                        )}
                        <span className="shrink-0 font-mono">
                          {part.installed || "?"} → {part.library}
                        </span>
                      </span>
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>
        </ConfirmModal>
      )}
      {plugin !== undefined && pendingUninstall !== null && (
        <ConfirmModal
          open
          title={S.plugins.uninstallConfirmTitle(plugin.name)}
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
              plugin.name,
              uninstallAgent ? agentDisplayName(uninstallAgent) : pendingUninstall,
            )}
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

/**
 * One Agent row in the "manage installs" dialog: an Agent without the plugin shows "Install";
 * one with it shows "Installed", switching to "Uninstall" on hover (the same button carries the
 * uninstall); a copy the server lists as behind additionally shows "Update" (reinstall =
 * update). Install and uninstall go through the page's optimistic updates, rolling back on
 * failure.
 */
function InstallRow({
  agentId,
  name,
  installed,
  outdated,
  onToggle,
  onUpdate,
}: {
  agentId: string;
  name: string;
  installed: boolean;
  outdated: boolean;
  onToggle: (on: boolean) => void;
  onUpdate: () => void;
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
