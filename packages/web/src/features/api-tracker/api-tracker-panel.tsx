import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SessionInfo,
  UsageErrorItem,
  UsageModelTotals,
  UsageResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import type { ModelKeyHealthReportDto } from "../models/model-keys-health";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Input } from "../../components/ui/input";
import { Segmented } from "../../components/ui/segmented";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatMoney, formatRelativeShort, humanizeTokens } from "../../lib/format";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { useTheme } from "../../state/theme";

export interface ApiTrackerPanelProps {
  session?: SessionInfo;
  active: boolean;
  projectId?: string;
}

type SubTab = "keys" | "logs" | "usage";

export function ApiTrackerPanel({
  session,
  active,
  projectId: propProjectId,
}: ApiTrackerPanelProps) {
  const { currentProject } = useProject();
  const projectId = propProjectId ?? currentProject?.projectId ?? null;
  const { locale } = useLocale();
  const { currency } = useTheme();

  const [subTab, setSubTab] = useState<SubTab>("keys");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [resetting, setResetting] = useState(false);

  const [keyReports, setKeyReports] = useState<ModelKeyHealthReportDto[]>([]);
  const [logs, setLogs] = useState<UsageErrorItem[]>([]);
  const [modelTotals, setModelTotals] = useState<UsageModelTotals | null>(null);
  const [usageData, setUsageData] = useState<UsageResponse | null>(null);

  const fetchAll = useCallback(
    async (isBackground = false) => {
      if (!projectId) return;
      if (isBackground) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [healthRes, errorsRes, totalsRes, usageRes] = await Promise.allSettled([
          api.getModelKeyHealth(projectId),
          api.getUsageErrors(projectId, { offset: 0, limit: 100 }),
          api.getUsageModelTotals(projectId),
          api.getUsage(projectId, {
            groupBy: "date",
            granularity: "day",
          }),
        ]);

        if (healthRes.status === "fulfilled") {
          const val = healthRes.value;
          if (Array.isArray(val.reports)) {
            setKeyReports(val.reports);
          } else if (val.modelRef) {
            setKeyReports([val]);
          } else {
            setKeyReports([]);
          }
        }
        if (errorsRes.status === "fulfilled") {
          setLogs(errorsRes.value.items ?? []);
        }
        if (totalsRes.status === "fulfilled") {
          setModelTotals(totalsRes.value);
        }
        if (usageRes.status === "fulfilled") {
          setUsageData(usageRes.value);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (active && projectId) {
      void fetchAll(false);
    }
  }, [active, projectId, fetchAll]);

  useEffect(() => {
    if (!active || !autoRefresh || !projectId) return;
    const interval = setInterval(() => {
      void fetchAll(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [active, autoRefresh, projectId, fetchAll]);

  const keySummary = useMemo(() => {
    let totalKeys = 0;
    let healthyKeys = 0;
    let cooldownKeys = 0;
    let evictedKeys = 0;
    let activeLeases = 0;
    let totalSuccess = 0;
    let totalFailure = 0;

    for (const report of keyReports) {
      for (const k of report.keys) {
        totalKeys += 1;
        if (k.status === "healthy") healthyKeys += 1;
        else if (k.status === "cooldown") cooldownKeys += 1;
        else if (k.status === "evicted") evictedKeys += 1;

        activeLeases += k.activeLeases ?? 0;
        totalSuccess += k.successCount ?? 0;
        totalFailure += k.failureCount ?? 0;
      }
    }

    const totalOps = totalSuccess + totalFailure;
    const successRate = totalOps > 0 ? Math.round((totalSuccess / totalOps) * 100) : 100;

    return {
      totalKeys,
      healthyKeys,
      cooldownKeys,
      evictedKeys,
      activeLeases,
      totalSuccess,
      totalFailure,
      successRate,
    };
  }, [keyReports]);

  const handleResetHealth = async (provider?: string, modelId?: string) => {
    if (!projectId || resetting) return;
    setResetting(true);
    try {
      await api.resetModelKeys(projectId, provider, modelId);
      toastSuccess(S.apiTracker.resetSuccess);
      await fetchAll(false);
    } catch (err) {
      toastError(apiErrorText(err));
    } finally {
      setResetting(false);
    }
  };

  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return keyReports;
    return keyReports
      .map((r) => {
        const matchesReport = r.modelRef.toLowerCase().includes(q);
        const matchingKeys = r.keys.filter(
          (k) => matchesReport || k.maskedKey.toLowerCase().includes(q) || k.status.includes(q),
        );
        return matchingKeys.length > 0 ? { ...r, keys: matchingKeys } : null;
      })
      .filter((r): r is ModelKeyHealthReportDto => r !== null);
  }, [keyReports, query]);

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.source.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q) ||
        l.message.toLowerCase().includes(q) ||
        l.kind.toLowerCase().includes(q),
    );
  }, [logs, query]);

  const segmentedOptions = useMemo(
    () => [
      { value: "keys" as const, label: S.apiTracker.activeKeys },
      { value: "logs" as const, label: `${S.apiTracker.logs} (${logs.length})` },
      { value: "usage" as const, label: S.apiTracker.usage },
    ],
    [logs.length],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50/50 text-gray-900 dark:bg-gray-950/50 dark:text-gray-100">
      <div className="shrink-0 border-b border-gray-200 p-3 dark:border-gray-800">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GlyphIcon
              d="M13 10V3L4 14h7v7l9-11h-7z"
              size={ICON_SIZE.rowLead}
              className="text-blue-600 dark:text-blue-400"
            />
            <span className="text-sm font-semibold">{S.apiTracker.panelTitle}</span>
            {refreshing && (
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
                autoRefresh
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                  : "bg-gray-100 text-gray-500 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400"
              }`}
              title={S.apiTracker.autoRefresh}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? "bg-blue-600" : "bg-gray-400"}`}
              />
              <span>{S.apiTracker.autoRefresh}</span>
            </button>
            <button
              type="button"
              onClick={() => void fetchAll(false)}
              disabled={loading || refreshing}
              title={S.apiTracker.refresh}
              className="flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <GlyphIcon
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                size={ICON_SIZE.rowLead}
                className={loading || refreshing ? "animate-spin" : ""}
              />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:w-64">
            <Segmented
              options={segmentedOptions}
              value={subTab}
              onChange={(v) => setSubTab(v as SubTab)}
              cols={3}
            />
          </div>
          <div className="w-full sm:w-48">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={S.apiTracker.filterPlaceholder}
              className="h-7 text-xs"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {subTab === "keys" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <div className="rounded-md border border-gray-200 bg-white p-2.5 dark:border-gray-800 dark:bg-gray-900">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  {S.models.keyHealthActive}
                </p>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-mono text-lg font-bold text-green-600 dark:text-green-400">
                    {keySummary.healthyKeys}
                  </span>
                  <span className="text-xs text-gray-400">/ {keySummary.totalKeys}</span>
                </div>
              </div>
              <div className="rounded-md border border-gray-200 bg-white p-2.5 dark:border-gray-800 dark:bg-gray-900">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  {S.apiTracker.statusCooldown}
                </p>
                <div className="mt-1 font-mono text-lg font-bold text-amber-600 dark:text-amber-400">
                  {keySummary.cooldownKeys}
                </div>
              </div>
              <div className="rounded-md border border-gray-200 bg-white p-2.5 dark:border-gray-800 dark:bg-gray-900">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  {S.apiTracker.statusEvicted}
                </p>
                <div className="mt-1 font-mono text-lg font-bold text-red-600 dark:text-red-400">
                  {keySummary.evictedKeys}
                </div>
              </div>
              <div className="rounded-md border border-gray-200 bg-white p-2.5 dark:border-gray-800 dark:bg-gray-900">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  {S.apiTracker.activeLeases}
                </p>
                <div className="mt-1 font-mono text-lg font-bold text-blue-600 dark:text-blue-400">
                  {keySummary.activeLeases}
                </div>
              </div>
              <div className="rounded-md border border-gray-200 bg-white p-2.5 dark:border-gray-800 dark:bg-gray-900">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  {S.apiTracker.successRate}
                </p>
                <div className="mt-1 font-mono text-lg font-bold text-gray-900 dark:text-gray-100">
                  {keySummary.successRate}%
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {S.models.keyHealthTitle(keySummary.healthyKeys, keySummary.totalKeys)}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleResetHealth()}
                disabled={resetting || keySummary.totalKeys === 0}
                className="text-xs"
              >
                {resetting ? S.models.resettingKeys : S.apiTracker.resetHealth}
              </Button>
            </div>

            {filteredReports.length === 0 ? (
              <EmptyState title={S.apiTracker.noKeys} />
            ) : (
              <div className="space-y-3">
                {filteredReports.map((report) => {
                  const parts = report.modelRef.split("/");
                  const provider = parts.length >= 2 ? parts[parts.length - 2] : "";
                  const modelId = parts[parts.length - 1];

                  return (
                    <div
                      key={report.modelRef}
                      className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/75 px-3 py-2 dark:border-gray-800/80 dark:bg-gray-800/40">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                            {modelId}
                          </span>
                          <span className="rounded bg-gray-200/80 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            {report.modelRef}
                          </span>
                          <Badge tone="gray">
                            {report.totalKeys > 1
                              ? S.models.multiKeyRotation
                              : S.models.multiKeySingle}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {report.healthyCount} / {report.totalKeys} {S.apiTracker.statusHealthy}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleResetHealth(provider, modelId)}
                            disabled={resetting}
                            className="rounded text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {S.models.resetKeys}
                          </button>
                        </div>
                      </div>

                      <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
                        {report.keys.map((k) => {
                          const totalOps = (k.successCount ?? 0) + (k.failureCount ?? 0);
                          const rate =
                            totalOps > 0
                              ? Math.round(((k.successCount ?? 0) / totalOps) * 100)
                              : 100;
                          const statusTone =
                            k.status === "healthy"
                              ? "green"
                              : k.status === "cooldown"
                                ? "amber"
                                : "red";

                          return (
                            <div
                              key={k.maskedKey}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className="font-mono font-medium text-gray-800 dark:text-gray-200">
                                  {k.maskedKey}
                                </span>
                                <Badge tone={statusTone}>
                                  {k.status === "healthy"
                                    ? S.apiTracker.statusHealthy
                                    : k.status === "cooldown"
                                      ? S.apiTracker.statusCooldown
                                      : S.apiTracker.statusEvicted}
                                </Badge>
                                {k.cooldownRemainingMs > 0 && (
                                  <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
                                    {Math.ceil(k.cooldownRemainingMs / 1000)}s
                                  </span>
                                )}
                                {(k.activeLeases ?? 0) > 0 && (
                                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                                    {k.activeLeases} {S.apiTracker.activeLeases}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-4 text-gray-500 dark:text-gray-400">
                                <div className="flex items-center gap-1.5" title="Success / Total">
                                  <span>
                                    {k.successCount} / {totalOps}
                                  </span>
                                  <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
                                    ({rate}%)
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 text-[11px]">
                                  <span>{S.apiTracker.lastUsed}:</span>
                                  <span className="font-medium text-gray-700 dark:text-gray-300">
                                    {k.lastUsedAt
                                      ? formatRelativeShort(
                                          new Date(k.lastUsedAt).toISOString(),
                                          locale,
                                        )
                                      : S.apiTracker.neverUsed}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {subTab === "logs" && (
          <div className="space-y-3">
            {filteredLogs.length === 0 ? (
              <EmptyState title={S.apiTracker.noLogs} />
            ) : (
              <div className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
                {filteredLogs.map((log, idx) => (
                  <div key={`${log.ts}-${idx}`} className="p-3 text-xs">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={log.kind === "unexpected" ? "red" : "gray"}>{log.kind}</Badge>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">
                          {log.source} · {log.code}
                        </span>
                      </div>
                      <span className="text-[11px] text-gray-400 tabular-nums">
                        {formatDateTime(log.ts)}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-gray-600 break-words dark:text-gray-300">
                      {log.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {subTab === "usage" && (
          <div className="space-y-4">
            {usageData?.summary && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {S.apiTracker.totalTokens}
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold text-gray-900 dark:text-gray-100">
                    {humanizeTokens(usageData.summary.today.total)}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {S.usage.requests}: {usageData.summary.today.requests}
                  </p>
                </div>
                <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {S.usage.last7d}
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold text-gray-900 dark:text-gray-100">
                    {humanizeTokens(usageData.summary.last7d.total)}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {S.usage.requests}: {usageData.summary.last7d.requests}
                  </p>
                </div>
                <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {S.apiTracker.estimatedCost}
                  </p>
                  <p className="mt-1 font-mono text-lg font-bold text-gray-900 dark:text-gray-100">
                    {formatMoney(usageData.summary.today.cost, currency)}
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <h4 className="mb-3 text-xs font-semibold text-gray-700 dark:text-gray-300">
                {S.usage.chartRequestsByModel}
              </h4>
              {!modelTotals || Object.keys(modelTotals).length === 0 ? (
                <p className="text-xs text-gray-400">{S.apiTracker.noLogs}</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(modelTotals).map(([key, tokens]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between border-b border-gray-100 pb-1.5 text-xs last:border-0 dark:border-gray-800/60"
                    >
                      <span className="font-mono text-gray-700 dark:text-gray-300">{key}</span>
                      <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
                        {humanizeTokens(tokens)} Tokens
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
