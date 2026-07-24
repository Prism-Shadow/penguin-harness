/**
 * Skill library page: the @prismshadow/penguin-skills
 * Skill library, shown sectioned by skill group. Groups are borderless — the
 * group header (group name + skill count, no icon) is collapsible, highlights
 * on hover, and animates height on expand/collapse; expanded by default. Cards
 * within a group form a grid, generously sized: two per row from the sm
 * breakpoint up, one per row on narrow screens. Each card = a rounded icon
 * tile centered against the two text rows (its color comes from
 * skillTileColor — a per-skill palette hashed from the name, which replaced
 * the theme-accent tile that painted every skill the same; DTO icon = the raw
 * icon.svg from the catalog, rendered inline once it passes sanitize,
 * otherwise falls back to a default book icon) + a name (monospace) and short
 * description on the right, one line each (single-line truncation, falling
 * back to the full description when missing) + a metadata line below both
 * (version · semantic update time · usage count "used by N Agents");
 * group and card copy follow the UI language (localizedText /
 * localizedShortText), and groups have no description. Icon buttons for
 * actions (copy goes into aria-label and title) —
 * - Rotate "update installs" (shown only when some Agent's installed copy has
 *   a lower version than the library): opens a confirm dialog (lists each
 *   Agent's v_old → v_new and warns the overwriting reinstall drops local
 *   edits), then reinstalls the current library copy on every outdated Agent
 *   (install-again-is-update semantics), with a single success toast; the
 *   manage-installs Modal marks outdated rows with an accent "更新"/"Update"
 *   button doing the same per Agent (through the same confirm);
 * - Paper plane "quick invoke": enters /chat/new draft mode with default_agent,
 *   pre-selects the skill, and pre-fills the invocation text per UI language
 *   (zh "使用 X 技能" / en "use the X skill", overwriting any existing draft body);
 * - Download "manage installs": a Modal listing every Agent in the current
 *   Project — not-installed shows "安装"/"Install", installed shows
 *   "已安装"/"Installed" (hover switches to "卸载"/"Uninstall", click to
 *   uninstall); any member can operate it; optimistic update, a top-level
 *   toast on success for install/uninstall, rollback plus a toast on failure.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { SkillGroupItem, SkillMetadataItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatRelativeDate } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Skeleton, SkeletonCard } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import { localizedShortText, localizedText } from "../chat/skill-use";
import { SkillIcon, skillTileColor } from "./skill-icon-view";

/** agentId → (installed skill name → installed copy's version); in-page install-state snapshot, rewritten in place by optimistic updates. */
export type InstalledMap = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** "Quick invoke" button icon (paper plane, 24×24 line path; button shows only the icon, copy goes into aria/title). */
const SEND_ICON = "M22 2 11 13M22 2 15 22 11 13 2 9 22 2";
/** "Manage installs" button icon (download into tray, 24×24 line path). */
const INSTALL_ICON = "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3";
/** "Update installs" button icon (rotate-cw, 24×24 line path). */
const UPDATE_ICON = "M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10";

/**
 * Agents whose installed copy of `name` is older than the library's version (the update
 * reminder's data source): not-installed Agents never count, and a locally *newer* copy
 * (e.g. a hand-edited install) doesn't either — reminders fire only on a strictly lower
 * version.
 */
export function outdatedAgentIds(
  agentIds: readonly string[],
  installed: InstalledMap,
  name: string,
  libraryVersion: number,
): string[] {
  return agentIds.filter((agentId) => {
    const v = installed.get(agentId)?.get(name);
    return v !== undefined && v < libraryVersion;
  });
}

export function SkillsPage() {
  useDocumentTitle(S.nav.skills);
  const navigate = useNavigate();
  const { locale } = useLocale();
  const userId = useAuth().user?.userId ?? null;
  const { currentProject, agents, setCurrentAgentId } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [groups, setGroups] = useState<SkillGroupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledMap>(new Map());
  /** Collapsed skill groups (all expanded by default; same convention as the model page's provider groups). */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Library list: readable once logged in, fetched once on page entry.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .getSkillLibrary()
      .then((res) => {
        if (!cancelled) setGroups(res.groups);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Installed skills for every Agent in the current Project (fetched in
  // parallel, same convention as the sessions context): a single Agent's
  // failure is silently treated as "no skills" and doesn't break the whole page.
  const agentIdsKey = agents.map((a) => a.agentId).join(",");
  useEffect(() => {
    // Clear the snapshot before fetching: agentId (e.g. default_agent) is
    // reused across Projects, and leftover state from the previous project
    // would otherwise overwrite the new data when merged below, leaving the
    // page permanently showing the old project's install state.
    setInstalled(new Map());
    if (!projectId || agentIdsKey === "") return;
    let cancelled = false;
    const ids = agentIdsKey.split(",");
    void Promise.all(
      ids.map(async (agentId) => {
        try {
          const res = await api.getAgentSkills(projectId, agentId);
          return [agentId, new Map(res.skills.map((s) => [s.name, s.version]))] as const;
        } catch {
          return [agentId, new Map<string, number>()] as const;
        }
      }),
    ).then((entries) => {
      // Merge instead of replacing the whole table: an Agent the user has
      // already interacted with during the fetch keeps its interaction result
      // (an optimistic state or an install/uninstall response is newer than
      // this mount-time snapshot), so a late-arriving initial snapshot never
      // regresses the UI.
      if (!cancelled)
        setInstalled((prev) => {
          const next = new Map<string, ReadonlyMap<string, number>>(entries);
          for (const [agentId, m] of prev) next.set(agentId, m);
          return next;
        });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentIdsKey]);

  /** Rewrite one Agent's install state in place (shared by optimistic updates and failure rollback); `version` is the entry's value when setting. */
  const setAgentSkill = (agentId: string, name: string, version: number | undefined) =>
    setInstalled((prev) => {
      const next = new Map(prev);
      const m = new Map(next.get(agentId) ?? []);
      if (version !== undefined) m.set(name, version);
      else m.delete(name);
      next.set(agentId, m);
      return next;
    });

  /** Calibrate one Agent from an install response's list (concurrent install/uninstall also converges to the server's truth). */
  const calibrateAgent = (agentId: string, skills: { name: string; version: number }[]) =>
    setInstalled((prev) =>
      new Map(prev).set(agentId, new Map(skills.map((s) => [s.name, s.version]))),
    );

  /** Check to install / uncheck to uninstall (any member can do this): optimistic update, a confirmation toast on success, rollback plus a toast on failure. */
  const toggleInstall = async (agentId: string, name: string, on: boolean, version: number) => {
    if (!projectId) return;
    const prevVersion = installed.get(agentId)?.get(name);
    setAgentSkill(agentId, name, on ? version : undefined);
    const target = agents.find((a) => a.agentId === agentId);
    const agentName = target ? agentDisplayName(target) : agentId;
    try {
      if (on) {
        const res = await api.installAgentSkills(projectId, agentId, [name]);
        calibrateAgent(agentId, res.skills);
        toastSuccess(S.skills.installedToast(name, agentName));
      } else {
        await api.removeAgentSkill(projectId, agentId, name);
        toastSuccess(S.skills.uninstalledToast(name, agentName));
      }
    } catch (e) {
      // A 404 on uninstall means "was already not installed": the target
      // state is already reached, so keep it unchecked without rolling back
      // or erroring (otherwise the checkbox would be stuck permanently
      // checked whenever this page's snapshot is stale).
      if (!on && e instanceof ApiError && e.status === 404) return;
      setAgentSkill(agentId, name, prevVersion);
      toastError(apiErrorText(e));
    }
  };

  /**
   * Update reminder action: reinstall the current library copy on every outdated Agent
   * (install-again-is-update semantics). One success toast for the whole batch; on partial
   * failure the succeeded Agents keep their calibrated state and the first error is toasted.
   */
  const updateOutdated = async (name: string, agentIds: string[]) => {
    if (!projectId || agentIds.length === 0) return;
    const results = await Promise.allSettled(
      agentIds.map(async (agentId) => {
        const res = await api.installAgentSkills(projectId, agentId, [name]);
        calibrateAgent(agentId, res.skills);
      }),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (!failed) toastSuccess(S.skills.updatedToast(name, agentIds.length));
    else toastError(apiErrorText(failed.reason));
  };

  /**
   * Quick invoke: pre-selects the skill in the draft cache (the `skills`
   * field, used by ChatInput as its initial selection on mount), pre-fills
   * the invocation text per UI language (overwriting any existing draft
   * body — quick invoke's intent is unambiguous, and leftover draft text
   * would only be noise here), and points the Agent to default_agent before
   * entering draft mode — the route state explicitly carries agentId
   * (overriding whatever was last selected in the cache). handoffAgentId
   * must be cleared: a leftover @ target would forward the whole skill
   * invocation to a different Agent — quick invoke must always start a new
   * conversation with default_agent.
   */
  const quickInvoke = (name: string) => {
    if (userId && projectId) {
      const key = draftKey(userId, projectId);
      saveDraft(key, {
        ...loadDraft(key),
        agentId: "default_agent",
        text: S.skills.quickInvokeText(name),
        skills: [name],
        handoffAgentId: undefined,
      });
    }
    setCurrentAgentId("default_agent");
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId: "default_agent" } });
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-xl font-semibold">{S.skills.pageTitle}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{S.skills.pageDesc}</p>

        {error ? (
          <div className="mt-6 flex items-center gap-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button size="sm" onClick={() => window.location.reload()}>
              {S.common.retry}
            </Button>
          </div>
        ) : groups === null ? (
          <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} className="p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-2 h-4 w-3/4" />
                <Skeleton className="mt-3 h-6 w-36" />
              </SkeletonCard>
            ))}
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {groups.map((group) => {
              const open = !collapsed.has(group.id);
              return (
                <section
                  key={group.id}
                  className="overflow-hidden rounded-md bg-white dark:bg-gray-900"
                >
                  {/* Group header (styled like the model page's provider groups): group name +
                      skill count (no icon, no description); the whole row toggles
                      collapse on click and highlights on hover. */}
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-2.5 bg-gray-50 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900/60 dark:hover:bg-gray-800/60"
                  >
                    {/* Group name can truncate (min-w-0): the count and collapse arrow must not shrink. */}
                    <span className="min-w-0 truncate text-sm font-semibold">
                      {localizedText(locale, group.title, group.titleZh)}
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs text-gray-400">
                      {S.skills.skillCount(group.skills.length)}
                    </span>
                    <span className="min-w-0 flex-1" />
                    <Chevron open={open} className="text-gray-400" />
                  </button>

                  {/* Expand/collapse height transition: grid-template-rows tweens between
                      0fr and 1fr, with the inner overflow-hidden clipping the content
                      (same convention as the model page). */}
                  <div
                    className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                  >
                    {/* inert while collapsed: cards at zero height shouldn't still be Tab-focusable or clickable. */}
                    <div className="overflow-hidden" inert={!open}>
                      {/* Generously sized cards: 2 columns ≥sm, 1 column on narrow screens. */}
                      <div
                        className={`grid gap-2.5 p-2.5 transition-opacity duration-200 sm:grid-cols-2 ${open ? "opacity-100" : "opacity-0"}`}
                      >
                        {group.skills.map((skill) => (
                          <SkillCard
                            key={skill.name}
                            skill={skill}
                            installed={installed}
                            onQuickInvoke={quickInvoke}
                            onToggleInstall={toggleInstall}
                            onUpdateOutdated={updateOutdated}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** A single skill card: metadata display (including a semantic metadata line) + update reminder + quick invoke + "manage installs" Modal. */
function SkillCard({
  skill,
  installed,
  onQuickInvoke,
  onToggleInstall,
  onUpdateOutdated,
}: {
  skill: SkillMetadataItem;
  installed: InstalledMap;
  onQuickInvoke: (name: string) => void;
  onToggleInstall: (agentId: string, name: string, on: boolean, version: number) => Promise<void>;
  onUpdateOutdated: (name: string, agentIds: string[]) => Promise<void>;
}) {
  const { locale } = useLocale();
  const { agents } = useProject();
  const [installOpen, setInstallOpen] = useState(false);
  // Agents pending an update confirmation (null = none): an update is an overwriting reinstall, so it needs a confirm + a per-agent version list before it runs.
  const [pendingUpdate, setPendingUpdate] = useState<string[] | null>(null);
  const [updating, setUpdating] = useState(false);
  // Agent pending an uninstall confirmation (null = none): uninstalling deletes the installed files, local edits included.
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null);

  const confirmUpdate = async () => {
    if (!pendingUpdate) return;
    setUpdating(true);
    await onUpdateOutdated(skill.name, pendingUpdate);
    setUpdating(false);
    setPendingUpdate(null);
  };

  /** Display name of the Agent pending uninstall (falls back to the raw id below). */
  const uninstallAgent =
    pendingUninstall !== null ? agents.find((a) => a.agentId === pendingUninstall) : undefined;
  const uninstallAgentName = uninstallAgent ? agentDisplayName(uninstallAgent) : undefined;

  let installedCount = 0;
  for (const m of installed.values()) if (m.has(skill.name)) installedCount += 1;
  const outdated = outdatedAgentIds(
    agents.map((a) => a.agentId),
    installed,
    skill.name,
    skill.version,
  );

  // Short description takes priority, falling back to the full description
  // when missing (per UI language); title carries the full description for hover reading.
  const description = localizedShortText(locale, skill);
  const fullDescription = skill.description;
  // Metadata line: version · semantic update time (omitted when there's no
  // date) · usage count (a plain, readable phrase rather than a bare number badge).
  const meta = [
    `v${skill.version}`,
    skill.updated ? formatRelativeDate(skill.updated, locale) : null,
    S.skills.usedByAgents(installedCount),
  ]
    .filter((v): v is string => v !== null)
    .join(" · ");
  return (
    <div className="flex h-full items-center gap-3 rounded-md p-4 transition-colors hover:bg-gray-100/70 dark:hover:bg-gray-800/60">
      <div className="min-w-0 flex-1">
        {/* Header: the skill icon centered across the two text rows (rounded tile in the skill's
            own palette color — see skillTileColor; deliberately a bit smaller than the two rows),
            with the name and short description on one line each to the right. */}
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${skillTileColor(skill.name)}`}
          >
            <SkillIcon icon={skill.icon} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[13px] font-semibold" title={skill.name}>
              {skill.name}
            </span>
            {/* Short description truncates to one line (full description goes into title for hover reading). */}
            <p
              className="mt-0.5 truncate text-xs leading-5 text-gray-500 dark:text-gray-400"
              title={fullDescription}
            >
              {description}
            </p>
          </div>
        </div>
        {/* Metadata line under the header (e.g. `v1 · updated today · used by N Agents`). */}
        <p className="mt-2.5 truncate text-[11px] text-gray-400 dark:text-gray-500" title={meta}>
          {meta}
        </p>
      </div>
      {/* Actions: equal-square light icon buttons in a single row, vertically centered at the
          card's right edge (copy goes into aria-label and title). */}
      <div className="flex shrink-0 items-center justify-center gap-1.5">
        {/* Light (secondary): an update nudge, not the card's primary action. */}
        {outdated.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            className="h-8 w-8 shrink-0 justify-center p-0"
            aria-label={`${S.skills.updateOutdated(outdated.length)} ${skill.name}`}
            title={S.skills.updateOutdated(outdated.length)}
            onClick={() => setPendingUpdate(outdated)}
          >
            <GlyphIcon d={UPDATE_ICON} size={13} />
          </Button>
        )}
        <Button
          size="sm"
          className="h-8 w-8 shrink-0 justify-center p-0"
          aria-label={`${S.skills.quickInvoke} ${skill.name}`}
          title={S.skills.quickInvoke}
          onClick={() => onQuickInvoke(skill.name)}
        >
          <GlyphIcon d={SEND_ICON} size={15} />
        </Button>
        <Button
          size="sm"
          className="h-8 w-8 shrink-0 justify-center p-0"
          aria-label={`${S.skills.manageInstall} ${skill.name}`}
          title={S.skills.manageInstall}
          onClick={() => setInstallOpen(true)}
        >
          <GlyphIcon d={INSTALL_ICON} size={15} />
        </Button>
      </div>
      {installOpen && (
        <Modal
          open
          title={S.skills.manageInstallTitle(skill.name)}
          onClose={() => setInstallOpen(false)}
        >
          <div className="space-y-0.5">
            {agents.length === 0 && (
              <p className="py-1.5 text-xs text-gray-400">{S.common.loading}</p>
            )}
            {agents.map((a) => (
              <InstallRow
                key={a.agentId}
                agentId={a.agentId}
                name={agentDisplayName(a)}
                installed={installed.get(a.agentId)?.has(skill.name) ?? false}
                outdated={outdated.includes(a.agentId)}
                onToggle={(on) => {
                  // Install runs directly; uninstall deletes the installed files, so it confirms first.
                  if (on) void onToggleInstall(a.agentId, skill.name, true, skill.version);
                  else setPendingUninstall(a.agentId);
                }}
                onUpdate={() => setPendingUpdate([a.agentId])}
              />
            ))}
          </div>
        </Modal>
      )}
      {pendingUpdate && (
        <ConfirmModal
          open
          title={S.skills.updateConfirmTitle(skill.name)}
          tone="primary"
          confirmLabel={S.skills.updateAction}
          busy={updating}
          onClose={() => setPendingUpdate(null)}
          onConfirm={() => void confirmUpdate()}
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {S.skills.updateConfirmWarning}
            </p>
            {/* Per-agent old → new version, so it's clear exactly which installs get overwritten. */}
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {pendingUpdate.map((agentId) => {
                const oldVersion = installed.get(agentId)?.get(skill.name);
                const target = agents.find((a) => a.agentId === agentId);
                return (
                  <li
                    key={agentId}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate">
                      {target ? agentDisplayName(target) : agentId}
                    </span>
                    <span className="shrink-0 font-mono text-gray-500 dark:text-gray-400">
                      v{oldVersion ?? "?"} → v{skill.version}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </ConfirmModal>
      )}
      {pendingUninstall !== null && (
        <ConfirmModal
          open
          title={S.skills.uninstallConfirmTitle(skill.name)}
          confirmLabel={S.skills.uninstall}
          onClose={() => setPendingUninstall(null)}
          onConfirm={() => {
            const agentId = pendingUninstall;
            setPendingUninstall(null);
            void onToggleInstall(agentId, skill.name, false, skill.version);
          }}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.skills.uninstallConfirmBody(skill.name, uninstallAgentName ?? pendingUninstall)}
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

/**
 * One Agent row in the "manage installs" Modal: not-installed shows
 * "安装"/"Install"; installed shows "已安装"/"Installed", switching to
 * "卸载"/"Uninstall" on hover (same button, click to uninstall); an installed
 * copy older than the library additionally shows an accent "更新"/"Update"
 * button (reinstall = update). Install and uninstall go through optimistic
 * updates (toggleInstall), rolling back on failure.
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
      <span className="min-w-0 flex-1 truncate text-sm" title={agentId}>
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
        // group: on hover the button's copy switches "已安装"/"Installed" → "卸载"/"Uninstall" (the same button carries the uninstall action).
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
