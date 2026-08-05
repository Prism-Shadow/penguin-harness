/**
 * Agent settings page "Memory" tab: Workspace Memory's Agent-level configuration, and nothing
 * else. The switch decides whether Memory reaches the model — it does not delete anything, and
 * the Memory page stays fully usable with it off.
 *
 * The memories themselves are content, browsed and edited on the Memory page (`/memory`); this
 * tab is the way in, and reports the two states in which an Agent's memory never reaches the
 * model: switched off, or a prompt template predating Memory that carries no `{{MEMORY}}`.
 *
 * The switch writes immediately rather than joining a tab-level Save, so turning Memory off
 * never drags an unrelated half-finished edit along with it.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { MemoryOverviewResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";

export function MemoryTab({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [overview, setOverview] = useState<MemoryOverviewResponse | null>(null);
  // Tab-level error is the initial load failure only; the switch reports via toast.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setOverview(null);
    setError(null);
    try {
      setOverview(await api.getMemoryOverview(projectId, agentId));
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleEnabled = async (next: boolean) => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api.putAgentConfig(projectId, agentId, {
        config: { memory: { enabled: next } },
      });
      setOverview((prev) => (prev ? { ...prev, enabled: res.config.memory.enabled } : prev));
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) return null;
  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!overview) return <SkeletonList rows={4} />;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.memory.desc}</p>

      <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{S.memory.enable}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {overview.enabled ? S.memory.enabledHint : S.memory.disabledHint}
            </p>
          </div>
          <Switch
            checked={overview.enabled}
            disabled={busy}
            onChange={(next) => void toggleEnabled(next)}
            aria-label={S.memory.enable}
          />
        </div>
        {/* Enabled but injecting nothing: an Agent created before Memory shipped has no
            {{MEMORY}} in its template, so the switch alone would misreport the state. */}
        {overview.enabled && !overview.templateInjects && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {S.memory.templateMissingHint}
          </p>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">{S.memory.dirLabel}</p>
        <p className="break-all font-mono text-xs text-gray-500 dark:text-gray-400">
          {overview.memoryDir}
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
          {S.memory.workspaceCount(overview.workspaces.length)}
        </p>
      </div>

      <Button size="sm" onClick={() => navigate(`/memory?agentId=${encodeURIComponent(agentId)}`)}>
        {S.memory.manageLink}
      </Button>
    </div>
  );
}
