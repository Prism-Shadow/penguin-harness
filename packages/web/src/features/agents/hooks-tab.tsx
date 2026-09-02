/**
 * Agent settings page "Hooks" tab: the hook packages installed on this Agent
 * (agent_state/hooks/<name>/ — a manifest plus the scripts the harness runs at the loop's
 * hook points, e.g. after every Task). The files are the single source of truth, so the list
 * is re-fetched from the API after every mutation instead of trusting client state, the way
 * the Skills tab does. Rows lead with the icon of the plugin the package came from (the name's
 * initial when it has none), then the package name, its localized description, the hook points
 * it answers at (one chip each) and its version; uninstall confirms first
 * (it deletes the whole package directory, local edits included). Installing happens through
 * the plugin library — a hook package is part of a plugin, installed with it — so there is no
 * import entry here. Read and mutate are both member-level, matching the hooks routes.
 */
import { useCallback, useEffect, useState } from "react";
import type { HookItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { SettingsEmpty } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { HelpFold } from "../../components/ui/help-fold";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { localizedText } from "../chat/skill-use";
import { SkillTile } from "../skills/skill-icon-view";
import { TRASH_ICON } from "./skills-tab";

export function HooksTab({ agentId }: { agentId: string }) {
  const { locale } = useLocale();
  const { currentProject, agents, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [hooks, setHooks] = useState<HookItem[] | null>(null);
  // Tab-level error is only the initial list load failure; row actions report via toast.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Package name pending uninstall confirmation (non-null shows the confirm modal).
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setHooks(null);
    setError(null);
    try {
      const res = await api.getAgentHooks(projectId, agentId);
      setHooks(res.hooks);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Display name of this Agent for toasts / confirm copy (falls back to the raw id). */
  const agent = agents.find((a) => a.agentId === agentId);
  const agentName = agent ? agentDisplayName(agent) : agentId;

  /** Confirm modal's "Confirm": uninstall, then always re-fetch the list from disk. */
  const confirmRemove = async () => {
    if (!projectId || removing === null) return;
    setBusy(true);
    try {
      await api.uninstallAgentHook(projectId, agentId, removing);
      toastSuccess(S.hooks.uninstalledToast(removing, agentName));
      await load();
      // The agent card's hook count (and its plugin-update marks) changed; refresh the list provider too.
      void reloadAgents();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  if (!projectId) return null;

  return (
    <div className="space-y-4">
      {/* Tab-level description: no title in the panel to anchor a "?" to (see help-fold.tsx). */}
      <HelpFold label={S.agent.tabHooks}>{S.hooks.agentTabDesc}</HelpFold>

      {hooks === null ? (
        <SkeletonList rows={3} />
      ) : hooks.length === 0 ? (
        <SettingsEmpty>{S.hooks.agentTabEmpty}</SettingsEmpty>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {hooks.map((hook) => {
            const description = localizedText(locale, hook.description, hook.descriptionZh);
            return (
              <div
                key={hook.name}
                className="flex items-center gap-3 border-b border-gray-100 px-3 py-2.5 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
              >
                <SkillTile icon={hook.icon} name={hook.name} size={36} glyph={20} />
                <div className="min-w-0 flex-1">
                  <span
                    className="block truncate font-mono text-[13px] font-semibold"
                    title={hook.name}
                  >
                    {hook.name}
                  </span>
                  {/* Description truncates to one line (the full text goes into title for hover reading). */}
                  <p
                    className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400"
                    title={description}
                  >
                    {description}
                  </p>
                </div>
                {/* The hook points the package answers at, one chip each (the same wording as the library card's badges). */}
                <span className="hidden shrink-0 items-center gap-1 sm:flex">
                  {hook.events.map((event) => (
                    <Badge key={event}>{S.plugins.hookBadge(event)}</Badge>
                  ))}
                </span>
                {hook.version !== "" && (
                  <span
                    className="hidden shrink-0 text-[11px] text-gray-400 sm:block dark:text-gray-500"
                    title={hook.version}
                  >
                    {hook.version}
                  </span>
                )}
                {/* Icon-only row action (same affordance as the Skills tab's delete: danger variant with red text/hover); the tooltip + aria-label carry the wording. */}
                <Button
                  size="icon"
                  variant="danger"
                  title={S.skills.uninstall}
                  aria-label={`${S.skills.uninstall} ${hook.name}`}
                  disabled={busy}
                  onClick={() => setRemoving(hook.name)}
                >
                  <GlyphIcon d={TRASH_ICON} size={14} />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Uninstall confirmation (shared ConfirmModal, the Skills tab's pattern). */}
      <ConfirmModal
        open={removing !== null}
        title={removing !== null ? S.hooks.uninstallConfirmTitle(removing) : ""}
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {removing !== null ? S.hooks.uninstallConfirmBody(removing, agentName) : ""}
        </p>
      </ConfirmModal>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
