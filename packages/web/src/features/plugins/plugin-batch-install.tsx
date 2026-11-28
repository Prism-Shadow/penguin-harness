/**
 * Minimalist, theme-adaptive bottom-right plugin download dock:
 * - Non-blocking (`aria-modal="false"`, no backdrop scrim) so the user keeps working undisturbed.
 * - Single flat `rounded-sm` surface with flush hairline dividers (no box-in-box nesting) and
 *   only one fold level (dock header ↔ 32px merged progress bar — no secondary folding so no
 *   package is ever hidden before consent).
 * - Structured `PluginInstallReason` union (`feature`, `requester`, `requiredBy`, `update`) with
 *   clickable plugin and reason links; deduplicates identical `(machineId, specifier)` entries by
 *   merging their reasons.
 * - Supports multi-machine batches grouped cleanly by machine (distinct machines download in
 *   parallel; packages within one machine download sequentially).
 * - On failure, keeps the dock open with concise source-config recommendations (manual Plugin
 *   Sources settings + Agent-assisted configuration + file import) and retries failed items only.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Checkbox,
  GlyphIcon,
  ICON_SIZE,
  ICONS,
} from "@prismshadow/penguin-ui";
import type { InstallStage } from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { installStepWords, type DownloadProgress } from "./install-progress";
import type { FailedPluginDownload } from "./plugin-source-assist";

/** Structured reason explaining why a specific plugin package needs to be downloaded. */
export type PluginInstallReason =
  | {
      kind: "feature";
      label: string;
      href?: string | undefined;
      onClick?: (() => void) | undefined;
    }
  | {
      kind: "requester";
      label: string;
      /** True for direct manual user selection (renders `label` directly instead of "Requested by …"). */
      manual?: boolean | undefined;
      href?: string | undefined;
      onClick?: (() => void) | undefined;
    }
  | {
      kind: "requiredBy";
      label: string;
      href?: string | undefined;
      onClick?: (() => void) | undefined;
    }
  | {
      kind: "update";
      from: string;
      to: string;
    };

export interface BatchPluginItem {
  specifier: string;
  title: string;
  version?: string | undefined;
  /** Target machine id; defaults to `"local"` for single-machine batches. */
  machineId?: string | undefined;
  /** Display name of the target machine for multi-machine grouping. */
  machineLabel?: string | undefined;
  /** Structured reasons explaining why this package is needed. */
  reasons?: readonly PluginInstallReason[] | undefined;
  /** Optional plain-text fallback reason when structured reasons are not passed. */
  reason?: string | undefined;
  /** Optional URL to inspect the plugin (e.g. `/plugins?plugin=...`). */
  pluginHref?: string | undefined;
  /** Optional click handler to inspect the plugin in place (e.g. opening its detail modal). */
  onOpenPlugin?: (() => void) | undefined;
  libraryOnly?: boolean | undefined;
}

export type BatchItemStatus = "pending" | "running" | "done" | "failed";

export interface BatchItemState {
  status: BatchItemStatus;
  stage: InstallStage | null;
  progress: DownloadProgress | null;
  error: string | null;
}

const DEFAULT_MACHINE_ID = "local";

/** Stable identity key `(machineId, specifier)` for a queued plugin download. */
export function batchItemKey(item: Pick<BatchPluginItem, "machineId" | "specifier">): string {
  return `${item.machineId ?? DEFAULT_MACHINE_ID}::${item.specifier}`;
}

function reasonFingerprint(r: PluginInstallReason): string {
  if (r.kind === "update") return `update:${r.from}->${r.to}`;
  return `${r.kind}:${r.label}:${r.href ?? ""}`;
}

/** Deduplicates items sharing `(machineId, specifier)` by merging their structured reasons. */
export function mergeBatchItems(items: readonly BatchPluginItem[]): BatchPluginItem[] {
  const byKey = new Map<string, BatchPluginItem>();
  const order: string[] = [];
  for (const item of items) {
    const key = batchItemKey(item);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        ...item,
        ...(item.reasons !== undefined ? { reasons: [...item.reasons] } : {}),
      });
      order.push(key);
      continue;
    }
    const mergedReasons: PluginInstallReason[] = [...(existing.reasons ?? [])];
    const seen = new Set(mergedReasons.map(reasonFingerprint));
    for (const r of item.reasons ?? []) {
      const fp = reasonFingerprint(r);
      if (!seen.has(fp)) {
        seen.add(fp);
        mergedReasons.push(r);
      }
    }
    byKey.set(key, {
      ...existing,
      version: existing.version ?? item.version,
      pluginHref: existing.pluginHref ?? item.pluginHref,
      onOpenPlugin: existing.onOpenPlugin ?? item.onOpenPlugin,
      reason: existing.reason ?? item.reason,
      ...(mergedReasons.length > 0 ? { reasons: mergedReasons } : {}),
    });
  }
  return order.map((k) => byKey.get(k)!);
}

/** Fractional progress (0..1) of the currently running item from its live SSE stage and bytes. */
export function currentItemFraction(
  stage: InstallStage | null,
  progress: DownloadProgress | null,
): number {
  if (progress !== null) {
    if (progress.total !== null && progress.total > 0) {
      const ratio = Math.min(1, Math.max(0, progress.received / progress.total));
      return 0.15 + 0.75 * ratio;
    }
    return progress.received > 0 ? 0.35 : 0.18;
  }
  if (stage === null) return 0.04;
  if (stage.stage === "checking") return 0.1;
  if (stage.stage === "loading") return 0.94;
  return 0.2;
}

/** Computes unified overall progress (0..100) across all items in the batch. */
export function batchOverallPercent(
  items: readonly BatchPluginItem[],
  states: Readonly<Record<string, BatchItemState>>,
): number {
  if (items.length === 0) return 100;
  let sum = 0;
  for (const item of items) {
    const st = states[batchItemKey(item)] ?? states[item.specifier];
    if (st === undefined || st.status === "pending") continue;
    if (st.status === "done") {
      sum += 1;
    } else if (st.status === "running") {
      sum += currentItemFraction(st.stage, st.progress);
    }
  }
  return Math.min(100, Math.max(0, Math.round((sum / items.length) * 100)));
}

function formatTransferAmount(progress: DownloadProgress | null): string | null {
  if (progress === null) return null;
  const { received, total } = progress;
  if (total !== null && total > 0) {
    return `${formatBytes(received)}/${formatBytes(total)}`;
  }
  return received > 0 ? formatBytes(received) : null;
}

export interface PluginBatchInstallModalProps {
  open: boolean;
  title?: string | undefined;
  /** Optional fallback note when callers do not pass structured per-item reasons. */
  summaryReason?: string | undefined;
  machineLabel?: string | undefined;
  impactNote?: string | undefined;
  items: readonly BatchPluginItem[];
  runInstall: (
    item: BatchPluginItem,
    callbacks: {
      onProgress: (received: number, total: number | null) => void;
      onStage: (stage: InstallStage) => void;
    },
  ) => Promise<{ loadError?: string | undefined }>;
  dontAskLabel?: string | undefined;
  onOpenSources?: (() => void) | undefined;
  onConfigureWithAi?: ((failed: readonly FailedPluginDownload[]) => void) | undefined;
  onImportFile?: (() => void) | undefined;
  onComplete?: (result: { installed: string[]; failed: FailedPluginDownload[] }) => void;
  onClose: (opts?: { dontAskAgain: boolean }) => void;
}

type ModalPhase = "review" | "running" | "done" | "failed";

function initialStates(items: readonly BatchPluginItem[]): Record<string, BatchItemState> {
  const map: Record<string, BatchItemState> = {};
  for (const item of items) {
    map[batchItemKey(item)] = { status: "pending", stage: null, progress: null, error: null };
  }
  return map;
}

interface MachineGroup {
  machineId: string;
  machineLabel: string;
  items: BatchPluginItem[];
}

function groupByMachine(
  items: readonly BatchPluginItem[],
  fallbackLabel: string,
): MachineGroup[] {
  const groups = new Map<string, MachineGroup>();
  const order: string[] = [];
  for (const item of items) {
    const id = item.machineId ?? DEFAULT_MACHINE_ID;
    let group = groups.get(id);
    if (group === undefined) {
      group = {
        machineId: id,
        machineLabel: item.machineLabel ?? fallbackLabel,
        items: [],
      };
      groups.set(id, group);
      order.push(id);
    }
    group.items.push(item);
  }
  return order.map((id) => groups.get(id)!);
}

function ReasonLink({
  label,
  href,
  onClick,
  mono = false,
}: {
  label: string;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  mono?: boolean | undefined;
}) {
  const cls = `${mono ? "font-mono " : ""}text-accent underline decoration-line underline-offset-2 hover:decoration-accent`;
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={`inline cursor-pointer border-0 bg-transparent p-0 text-left ${cls}`}
      >
        {label}
      </button>
    );
  }
  if (href !== undefined) {
    return (
      <a
        href={href}
        onClick={(e) => e.stopPropagation()}
        className={cls}
      >
        {label}
      </a>
    );
  }
  return <span className={mono ? "font-mono text-fg-muted" : "text-fg-muted"}>{label}</span>;
}

function ItemReasonsLine({
  reasons,
  fallbackReason,
}: {
  reasons?: readonly PluginInstallReason[] | undefined;
  fallbackReason?: string | undefined;
}) {
  const B = S.plugins.installModel.batch;
  if (reasons === undefined || reasons.length === 0) {
    if (!fallbackReason) return null;
    return (
      <div className="mt-0.5 truncate text-[10.5px] leading-snug text-fg-muted">
        {fallbackReason}
      </div>
    );
  }

  const requiredBy = reasons.filter(
    (r): r is Extract<PluginInstallReason, { kind: "requiredBy" }> => r.kind === "requiredBy",
  );
  const others = reasons.filter((r) => r.kind !== "requiredBy");
  const segments: ReactNode[] = [];

  others.forEach((r, idx) => {
    if (r.kind === "feature") {
      segments.push(
        <span key={`f-${idx}`}>
          {B.reasonForPrefix}
          <ReasonLink label={r.label} href={r.href} onClick={r.onClick} />
        </span>,
      );
    } else if (r.kind === "requester") {
      if (r.manual) {
        segments.push(
          <span key={`req-${idx}`}>
            <ReasonLink label={r.label} href={r.href} onClick={r.onClick} />
          </span>,
        );
      } else {
        segments.push(
          <span key={`req-${idx}`}>
            {B.reasonRequestedByPrefix}
            <ReasonLink label={r.label} href={r.href} onClick={r.onClick} />
            {B.reasonRequestedBySuffix}
          </span>,
        );
      }
    } else if (r.kind === "update") {
      segments.push(
        <span key={`upd-${idx}`} className="font-mono">
          {B.reasonUpdate(r.from, r.to)}
        </span>,
      );
    }
  });

  if (requiredBy.length > 0) {
    segments.push(
      <span key="reqby">
        {B.reasonRequiredByPrefix}
        {requiredBy.map((r, idx) => (
          <span key={`${r.label}-${idx}`}>
            {idx > 0 ? B.reasonListSep : null}
            <ReasonLink label={r.label} href={r.href} onClick={r.onClick} mono />
          </span>
        ))}
        {B.reasonRequiredBySuffix}
      </span>,
    );
  }

  return (
    <div className="mt-0.5 truncate text-[10.5px] leading-snug text-fg-muted">
      {segments.map((seg, idx) => (
        <span key={idx}>
          {idx > 0 ? <span className="mx-1 opacity-45">·</span> : null}
          {seg}
        </span>
      ))}
    </div>
  );
}

export function PluginBatchInstallModal({
  open,
  title,
  summaryReason,
  machineLabel,
  impactNote,
  items: rawItems,
  runInstall,
  dontAskLabel,
  onOpenSources,
  onConfigureWithAi,
  onImportFile,
  onComplete,
  onClose,
}: PluginBatchInstallModalProps) {
  const words = S.plugins.installModel;
  const B = words.batch;

  const items = useMemo(() => mergeBatchItems(rawItems), [rawItems]);
  const machineGroups = useMemo(
    () => groupByMachine(items, machineLabel ?? words.thisServer),
    [items, machineLabel, words.thisServer],
  );
  const multiMachine = machineGroups.length > 1;

  const [phase, setPhase] = useState<ModalPhase>("review");
  const [expanded, setExpanded] = useState(true);
  const [states, setStates] = useState<Record<string, BatchItemState>>(() => initialStates(items));
  const [dontAsk, setDontAsk] = useState(false);
  const [furthestPct, setFurthestPct] = useState(0);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset state whenever the dock opens with a new list of items.
  const itemKey = items.map((i) => `${batchItemKey(i)}@${i.version ?? ""}`).join("|");
  useEffect(() => {
    if (!open) return;
    if (runningRef.current) return;
    setPhase("review");
    setExpanded(true);
    setStates(initialStates(items));
    setFurthestPct(0);
    setDontAsk(false);
  }, [open, itemKey]);

  const rawPercent = batchOverallPercent(items, states);
  const displayPercent =
    phase === "done" ? 100 : phase === "running" ? Math.max(furthestPct, rawPercent) : rawPercent;

  useEffect(() => {
    if (phase === "running" && rawPercent > furthestPct) {
      setFurthestPct(rawPercent);
    }
  }, [phase, rawPercent, furthestPct]);

  const doneCount = items.filter((i) => states[batchItemKey(i)]?.status === "done").length;
  const failedItems: FailedPluginDownload[] = items
    .filter((i) => states[batchItemKey(i)]?.status === "failed")
    .map((i) => ({
      specifier: i.specifier,
      error: states[batchItemKey(i)]?.error ?? S.common.failed,
    }));

  const currentOrdinal = Math.min(items.length, doneCount + 1);

  const runQueue = async (targets: readonly BatchPluginItem[]) => {
    if (runningRef.current || targets.length === 0) return;
    runningRef.current = true;
    setPhase("running");
    setFurthestPct(0);

    const targetKeys = new Set(targets.map(batchItemKey));
    setStates((prev) => {
      const next = { ...prev };
      for (const item of targets) {
        next[batchItemKey(item)] = { status: "pending", stage: null, progress: null, error: null };
      }
      return next;
    });

    const installed: string[] = items
      .filter((i) => !targetKeys.has(batchItemKey(i)) && states[batchItemKey(i)]?.status === "done")
      .map((i) => i.specifier);
    const failed: FailedPluginDownload[] = [];

    // Run distinct machines concurrently, and packages within each machine sequentially.
    const targetGroups = groupByMachine(targets, machineLabel ?? words.thisServer);
    await Promise.all(
      targetGroups.map(async (group) => {
        for (const item of group.items) {
          if (!mountedRef.current) break;
          const key = batchItemKey(item);
          setStates((prev) => ({
            ...prev,
            [key]: { status: "running", stage: { stage: "checking" }, progress: null, error: null },
          }));

          try {
            const res = await runInstall(item, {
              onProgress: (received, total) => {
                if (!mountedRef.current) return;
                setStates((prev) => {
                  const cur = prev[key];
                  if (!cur || cur.status !== "running") return prev;
                  return { ...prev, [key]: { ...cur, progress: { received, total } } };
                });
              },
              onStage: (stage) => {
                if (!mountedRef.current) return;
                setStates((prev) => {
                  const cur = prev[key];
                  if (!cur || cur.status !== "running") return prev;
                  return { ...prev, [key]: { ...cur, stage } };
                });
              },
            });
            if (!mountedRef.current) break;
            if (res.loadError) {
              failed.push({ specifier: item.specifier, error: res.loadError });
              setStates((prev) => ({
                ...prev,
                [key]: {
                  status: "failed",
                  stage: null,
                  progress: null,
                  error: res.loadError ?? S.common.failed,
                },
              }));
            } else {
              installed.push(item.specifier);
              setStates((prev) => ({
                ...prev,
                [key]: { status: "done", stage: null, progress: null, error: null },
              }));
            }
          } catch (err) {
            if (!mountedRef.current) break;
            const message =
              err instanceof ApiError
                ? apiErrorText(err)
                : err instanceof Error && err.message.trim() !== ""
                  ? err.message
                  : apiErrorText(err);
            failed.push({ specifier: item.specifier, error: message });
            setStates((prev) => ({
              ...prev,
              [key]: { status: "failed", stage: null, progress: null, error: message },
            }));
          }
        }
      }),
    );

    runningRef.current = false;
    if (!mountedRef.current) return;
    setPhase(failed.length > 0 ? "failed" : "done");
    onComplete?.({ installed, failed });
  };

  if (!open || items.length === 0) return null;

  const statusIcon =
    phase === "done"
      ? ICONS.checkCircle
      : phase === "failed"
        ? ICONS.triangleAlert
        : ICONS.download;
  const statusInk =
    phase === "done"
      ? toneInk.success
      : phase === "failed"
        ? toneInk.attention
        : "text-accent";
  const fillBg =
    phase === "done"
      ? "bg-success"
      : phase === "failed"
        ? "bg-attention"
        : "bg-accent";

  const statusHeadline =
    phase === "review"
      ? title ?? B.headerReview(items.length)
      : phase === "running"
        ? B.headerRunning(currentOrdinal, items.length)
        : phase === "done"
          ? B.headerDone(doneCount, items.length)
          : B.headerFailed(failedItems.length);

  const foldedText =
    phase === "review"
      ? B.foldedReview(items.length)
      : phase === "running"
        ? B.foldedRunning(currentOrdinal, items.length)
        : phase === "done"
          ? B.foldedDone(doneCount, items.length)
          : B.foldedFailed(failedItems.length);

  const headerMeta =
    phase === "review"
      ? multiMachine
        ? B.machinesCount(machineGroups.length)
        : (machineGroups[0]?.machineLabel ?? machineLabel ?? words.thisServer)
      : `${displayPercent}%`;

  const failedMachines = multiMachine
    ? machineGroups
        .filter((g) => g.items.some((i) => states[batchItemKey(i)]?.status === "failed"))
        .map((g) => g.machineLabel)
    : [];

  const dock = (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-toast flex justify-end sm:inset-x-auto sm:right-4 sm:bottom-4">
      <section
        role="region"
        aria-modal="false"
        aria-label={statusHeadline}
        data-testid="batch-plugin-install-modal"
        data-phase={phase}
        data-expanded={expanded ? "true" : "false"}
        className={`pointer-events-auto overflow-hidden rounded-sm border border-line bg-overlay text-fg shadow-lg transition-[width] duration-150 ${
          expanded ? "w-full sm:w-[360px]" : "w-full sm:w-[272px]"
        }`}
      >
        {!expanded ? (
          /* Folded: merged into ONE single 32px integrated progress bar (`rounded-sm`). */
          <div
            role={phase !== "review" ? "progressbar" : "status"}
            aria-label={B.progressLabel(items.length)}
            aria-valuemin={phase !== "review" ? 0 : undefined}
            aria-valuemax={phase !== "review" ? 100 : undefined}
            aria-valuenow={phase !== "review" ? displayPercent : undefined}
            data-testid="batch-install-progress"
            className="relative h-8 overflow-hidden"
          >
            {phase !== "review" && (
              <>
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-y-0 left-0 opacity-15 transition-[width] duration-150 ${fillBg}`}
                  style={{ width: `${displayPercent}%` }}
                />
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute bottom-0 left-0 h-[2px] transition-[width] duration-150 ${fillBg}`}
                  style={{ width: `${displayPercent}%` }}
                />
              </>
            )}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-expanded={false}
              aria-label={B.expand}
              data-testid="batch-install-toggle-fold"
              className="relative flex h-full w-full cursor-pointer items-center gap-1.5 px-2.5 text-left hover:bg-surface-hover/40"
            >
              <span className={`flex shrink-0 items-center ${statusInk}`}>
                <GlyphIcon d={statusIcon} size={ICON_SIZE.inlineGlyph} />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
                {foldedText}
              </span>
              {phase !== "review" && (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                  {displayPercent}%
                </span>
              )}
              <span className="flex shrink-0 items-center text-fg-muted">
                <GlyphIcon d={ICONS.chevronUp} size={ICON_SIZE.inlineGlyph} />
              </span>
            </button>
          </div>
        ) : (
          /* Expanded: single flat surface, flush hairline dividers, zero nested boxes & zero secondary folding. */
          <>
            {/* Header (only fold toggle) */}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-expanded={true}
              aria-label={B.fold}
              data-testid="batch-install-toggle-fold"
              className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-2 text-left hover:bg-surface-hover/50"
            >
              <span className={`flex shrink-0 items-center ${statusInk}`}>
                <GlyphIcon d={statusIcon} size={ICON_SIZE.inlineGlyph} />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">
                {statusHeadline}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                {headerMeta}
              </span>
              <span className="flex shrink-0 items-center text-fg-muted">
                <GlyphIcon d={ICONS.chevronDown} size={ICON_SIZE.inlineGlyph} />
              </span>
            </button>

            {/* Flush progress / divider hairline */}
            {phase !== "review" ? (
              <div
                role="progressbar"
                aria-label={B.progressLabel(items.length)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={displayPercent}
                data-testid="batch-install-progress"
                className="h-[2px] w-full bg-line"
              >
                <div
                  className={`h-full transition-[width] duration-150 ${fillBg}`}
                  style={{ width: `${displayPercent}%` }}
                />
              </div>
            ) : (
              <div className="h-px w-full bg-line" />
            )}

            {/* Flush scrollable package list (every package directly visible, no secondary folding) */}
            <div
              className="max-h-[220px] overflow-y-auto"
              data-testid="batch-install-body"
            >
              {summaryReason && items.every((i) => !i.reasons?.length && !i.reason) && (
                <div
                  className="border-b border-line/60 px-2.5 py-1.5 text-[11px] text-fg-muted"
                  data-testid="batch-install-reason"
                >
                  {summaryReason}
                </div>
              )}

              <div data-testid="batch-install-list">
                {machineGroups.map((group, groupIdx) => {
                  const groupDone = group.items.filter(
                    (i) => states[batchItemKey(i)]?.status === "done",
                  ).length;
                  const groupFailed = group.items.filter(
                    (i) => states[batchItemKey(i)]?.status === "failed",
                  ).length;
                  const groupBadge =
                    phase === "review"
                      ? B.machineCountBadge(group.items.length)
                      : groupFailed > 0
                        ? B.machineFailedBadge(groupFailed)
                        : groupDone === group.items.length
                          ? `${groupDone}/${group.items.length} ✓`
                          : `${groupDone}/${group.items.length}`;

                  return (
                    <div key={group.machineId} data-testid={`batch-machine-${group.machineId}`}>
                      {multiMachine && (
                        <div
                          className={`sticky top-0 flex items-center justify-between bg-surface-subtle/90 px-2.5 py-1 font-mono text-[10px] ${
                            groupIdx > 0 ? "border-t border-line" : ""
                          } border-b border-line/60`}
                        >
                          <span className="truncate font-semibold text-fg">
                            {group.machineLabel}
                          </span>
                          <span
                            className={`shrink-0 tabular-nums ${
                              groupFailed > 0
                                ? toneInk.attention
                                : groupDone === group.items.length && phase !== "review"
                                  ? toneInk.success
                                  : "text-fg-muted"
                            }`}
                          >
                            {groupBadge}
                          </span>
                        </div>
                      )}

                      <ul className="divide-y divide-line/60">
                        {group.items.map((item) => {
                          const key = batchItemKey(item);
                          const st = states[key] ?? {
                            status: "pending" as const,
                            stage: null,
                            progress: null,
                            error: null,
                          };
                          const itemTransfer =
                            st.status === "running" ? formatTransferAmount(st.progress) : null;

                          const rightLabel =
                            st.status === "pending"
                              ? phase === "review"
                                ? item.version !== undefined
                                  ? `v${item.version}`
                                  : ""
                                : B.statusPending
                              : st.status === "running"
                                ? itemTransfer ?? installStepWords(st.progress, st.stage, true)
                                : st.status === "done"
                                  ? "✓"
                                  : B.statusFailed;

                          const rightTone =
                            st.status === "done"
                              ? toneInk.success
                              : st.status === "failed"
                                ? toneInk.attention
                                : st.status === "running"
                                  ? "text-fg"
                                  : "text-fg-muted";

                          return (
                            <li
                              key={key}
                              className="px-2.5 py-1.5"
                              data-testid={`batch-item-${item.specifier}`}
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                {item.onOpenPlugin !== undefined ? (
                                  <button
                                    type="button"
                                    onClick={item.onOpenPlugin}
                                    title={item.title}
                                    className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-mono text-[11.5px] font-medium text-fg underline decoration-line underline-offset-2 hover:decoration-fg"
                                  >
                                    {item.specifier}
                                  </button>
                                ) : item.pluginHref !== undefined ? (
                                  <a
                                    href={item.pluginHref}
                                    title={item.title}
                                    className="min-w-0 truncate font-mono text-[11.5px] font-medium text-fg underline decoration-line underline-offset-2 hover:decoration-fg"
                                  >
                                    {item.specifier}
                                  </a>
                                ) : (
                                  <span
                                    title={item.title}
                                    className="min-w-0 truncate font-mono text-[11.5px] font-medium text-fg"
                                  >
                                    {item.specifier}
                                  </span>
                                )}
                                {rightLabel !== "" && (
                                  <span
                                    className={`shrink-0 font-mono text-[10px] tabular-nums ${rightTone}`}
                                  >
                                    {rightLabel}
                                  </span>
                                )}
                              </div>

                              <ItemReasonsLine
                                reasons={item.reasons}
                                fallbackReason={item.reason}
                              />

                              {st.status === "failed" && st.error && (
                                <p className={`mt-0.5 break-all font-mono text-[10px] ${toneInk.attention}`}>
                                  {st.error}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Flush failure recovery strip (no nested box) */}
            {phase === "failed" && failedItems.length > 0 && (
              <div
                className="space-y-1.5 border-t border-line bg-surface-subtle/70 px-2.5 py-2 text-[11px]"
                data-testid="batch-install-failure-recovery"
              >
                <div className={`font-medium ${toneInk.attention}`}>
                  {failedMachines.length > 0
                    ? `${failedMachines.join(", ")}: ${B.failedRecommendTitle}`
                    : B.failedRecommendTitle}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {onOpenSources && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="rounded-xs"
                      data-testid="batch-failure-manual-config"
                      onClick={onOpenSources}
                    >
                      {words.openPluginSources}
                    </Button>
                  )}
                  {onConfigureWithAi && (
                    <Button
                      size="sm"
                      variant="primary"
                      className="rounded-xs"
                      data-testid="batch-failure-agent-config"
                      onClick={() => onConfigureWithAi(failedItems)}
                    >
                      {words.askAgentToConfigureSources}
                    </Button>
                  )}
                  {onImportFile && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-xs"
                      data-testid="batch-failure-import-file"
                      onClick={onImportFile}
                    >
                      {words.importInstead}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Flush footer */}
            {phase === "review" && (
              <div className="flex items-center justify-between gap-2 border-t border-line px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  {dontAskLabel ? (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-fg-muted select-none">
                      <Checkbox checked={dontAsk} onChange={setDontAsk} />
                      <span className="truncate">{dontAskLabel}</span>
                    </label>
                  ) : impactNote ? (
                    <span className="block truncate text-[10px] text-fg-muted" title={impactNote}>
                      {impactNote}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-xs"
                    onClick={() => onClose({ dontAskAgain: dontAsk })}
                  >
                    {S.common.cancel}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    className="rounded-xs"
                    data-testid="batch-install-confirm"
                    onClick={() => void runQueue(items)}
                  >
                    {B.startDownload(items.length)}
                  </Button>
                </div>
              </div>
            )}

            {phase === "failed" && (
              <div className="flex items-center justify-end gap-1.5 border-t border-line px-2.5 py-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-xs"
                  onClick={() => onClose({ dontAskAgain: false })}
                >
                  {S.common.close}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="rounded-xs"
                  data-testid="batch-install-retry"
                  onClick={() =>
                    void runQueue(
                      items.filter((i) => states[batchItemKey(i)]?.status === "failed"),
                    )
                  }
                >
                  {B.retryFailed(failedItems.length)}
                </Button>
              </div>
            )}

            {phase === "done" && (
              <div className="flex items-center justify-end border-t border-line px-2.5 py-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  className="rounded-xs"
                  onClick={() => onClose({ dontAskAgain: false })}
                >
                  {S.common.done}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(dock, document.body) : dock;
}
