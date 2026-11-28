/**
 * Minimalist, theme-adaptive bottom-right plugin download dock:
 * - Non-blocking (`aria-modal="false"`, no backdrop scrim) so the user keeps working undisturbed.
 * - Folded: a single sleek status-bar strip (`sm:w-72`) with live percent/bytes and a flush
 *   bottom progress edge.
 * - Expanded: compact (`sm:w-[340px]`), high-density monospace telemetry showing count, why each
 *   plugin is needed (before consent — zero silent downloads), one unified progress bar across
 *   all N plugins, and manual + Agent-assisted source config recommendations on failure.
 * - Uses semantic overlay/theme tokens (`bg-overlay`, `border-line`, `text-fg`, `text-fg-muted`,
 *   `toneInk`) so it adapts cleanly across Modern, Geek, GitHub, Pixel, light and dark themes.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Checkbox,
  CloseButton,
  GlyphIcon,
  ICON_SIZE,
  ICONS,
  ProgressBar,
} from "@prismshadow/penguin-ui";
import type { InstallStage } from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { installStepWords, type DownloadProgress } from "./install-progress";
import type { FailedPluginDownload } from "./plugin-source-assist";

export interface BatchPluginItem {
  specifier: string;
  title: string;
  version?: string | undefined;
  /** Why this plugin needs to be downloaded. */
  reason: string;
  libraryOnly?: boolean | undefined;
}

export type BatchItemStatus = "pending" | "running" | "done" | "failed";

export interface BatchItemState {
  status: BatchItemStatus;
  stage: InstallStage | null;
  progress: DownloadProgress | null;
  error: string | null;
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
    const st = states[item.specifier];
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
    const pct = Math.floor((received / total) * 100);
    return `${formatBytes(received)}/${formatBytes(total)} (${pct}%)`;
  }
  return received > 0 ? formatBytes(received) : null;
}

export interface PluginBatchInstallModalProps {
  open: boolean;
  title?: string | undefined;
  /** Overall explanation of why these plugins need to be downloaded. */
  summaryReason: string;
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
    map[item.specifier] = { status: "pending", stage: null, progress: null, error: null };
  }
  return map;
}

export function PluginBatchInstallModal({
  open,
  title,
  summaryReason,
  machineLabel,
  impactNote,
  items,
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

  const [phase, setPhase] = useState<ModalPhase>("review");
  const [expanded, setExpanded] = useState(true);
  const [states, setStates] = useState<Record<string, BatchItemState>>(() => initialStates(items));
  const [activeIndex, setActiveIndex] = useState<number>(0);
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
  const itemKey = items.map((i) => `${i.specifier}@${i.version ?? ""}`).join("|");
  useEffect(() => {
    if (!open) return;
    if (runningRef.current) return;
    setPhase("review");
    setExpanded(true);
    setStates(initialStates(items));
    setActiveIndex(0);
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

  const updateItem = (specifier: string, patch: Partial<BatchItemState>) => {
    if (!mountedRef.current) return;
    setStates((prev) => ({
      ...prev,
      [specifier]: {
        ...(prev[specifier] ?? { status: "pending", stage: null, progress: null, error: null }),
        ...patch,
      },
    }));
  };

  const execute = async (onlyFailed: boolean) => {
    if (runningRef.current || items.length === 0) return;
    runningRef.current = true;
    setPhase("running");

    const nextStates: Record<string, BatchItemState> = {};
    for (const item of items) {
      const prev = states[item.specifier];
      if (onlyFailed && prev?.status === "done") {
        nextStates[item.specifier] = prev;
      } else {
        nextStates[item.specifier] = {
          status: "pending",
          stage: null,
          progress: null,
          error: null,
        };
      }
    }
    setStates(nextStates);
    setFurthestPct(batchOverallPercent(items, nextStates));

    const installed: string[] = [];
    const failed: FailedPluginDownload[] = [];

    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx]!;
      if (nextStates[item.specifier]?.status === "done") {
        installed.push(item.specifier);
        continue;
      }
      if (mountedRef.current) setActiveIndex(idx);
      updateItem(item.specifier, { status: "running", stage: null, progress: null, error: null });
      let lastStage: InstallStage | null = null;
      let lastProgress: DownloadProgress | null = null;
      try {
        const res = await runInstall(item, {
          onProgress: (received, total) => {
            lastProgress = { received, total };
            updateItem(item.specifier, { progress: lastProgress });
          },
          onStage: (stage) => {
            lastStage = stage;
            lastProgress = null;
            updateItem(item.specifier, { stage, progress: null });
          },
        });
        if (res.loadError) {
          failed.push({ specifier: item.specifier, error: res.loadError });
          updateItem(item.specifier, {
            status: "failed",
            stage: lastStage,
            progress: lastProgress,
            error: res.loadError,
          });
        } else {
          installed.push(item.specifier);
          updateItem(item.specifier, { status: "done", error: null });
        }
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? apiErrorText(err)
            : err instanceof Error && err.message
              ? err.message
              : apiErrorText(err);
        failed.push({ specifier: item.specifier, error: msg });
        updateItem(item.specifier, {
          status: "failed",
          stage: lastStage,
          progress: lastProgress,
          error: msg,
        });
      }
    }

    runningRef.current = false;
    if (!mountedRef.current) return;
    setPhase(failed.length > 0 ? "failed" : "done");
    onComplete?.({ installed, failed });
  };

  if (!open || typeof document === "undefined") return null;

  const doneCount = items.filter((i) => states[i.specifier]?.status === "done").length;
  const failedItems: FailedPluginDownload[] = items
    .map((i) => {
      const st = states[i.specifier];
      return st?.status === "failed"
        ? { specifier: i.specifier, error: st.error ?? "" }
        : null;
    })
    .filter((x): x is FailedPluginDownload => x !== null);

  const activeItem = items[activeIndex] ?? items[0];
  const activeState = activeItem ? states[activeItem.specifier] : undefined;
  const activeSentence =
    activeItem && activeState
      ? installStepWords(activeState.progress, activeState.stage, true, false)
      : words.starting;
  const activeTransfer = activeState ? formatTransferAmount(activeState.progress) : null;

  const handleClose = () => {
    if (phase === "running") return;
    onClose({ dontAskAgain: dontAsk });
  };

  const heading = title ?? B.title(items.length);
  const tone = phase === "done" ? "success" : phase === "failed" ? "attention" : "accent";
  const iconToneClass =
    phase === "done" ? toneInk.success : phase === "failed" ? toneInk.attention : "text-accent";

  const foldedLine =
    phase === "review"
      ? B.countBadge(items.length)
      : phase === "running" && activeItem
        ? `${activeIndex + 1}/${items.length} ${activeItem.title}`
        : phase === "done"
          ? `${doneCount}/${items.length} ${B.statusDone}`
          : `${failedItems.length} ${B.statusFailed}`;

  const dock = (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-3 z-toast flex justify-end sm:left-auto"
      data-testid="batch-plugin-install-dock"
    >
      <section
        role="dialog"
        aria-modal="false"
        aria-label={heading}
        data-testid="batch-plugin-install-modal"
        data-expanded={expanded ? "true" : "false"}
        className={`pointer-events-auto w-full overflow-hidden rounded-lg border border-line bg-overlay shadow-lg ${
          expanded ? "sm:w-[340px]" : "sm:w-72"
        }`}
      >
        {/* Slim 1-row header — click to toggle fold/expand */}
        <div className="flex items-center gap-2 px-2.5 py-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => setExpanded((was) => !was)}
          >
            <GlyphIcon
              d={
                phase === "done"
                  ? ICONS.checkCircle
                  : phase === "failed"
                    ? ICONS.triangleAlert
                    : ICONS.download
              }
              size={14}
              className={`shrink-0 ${iconToneClass}`}
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
              {expanded ? heading : foldedLine}
            </span>
            {!expanded && phase === "running" && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                {activeTransfer !== null ? `${displayPercent}% · ${activeTransfer.split(" ")[0]}` : `${displayPercent}%`}
              </span>
            )}
            {!expanded && (phase === "done" || phase === "failed") && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                {displayPercent}%
              </span>
            )}
            {expanded && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                {phase === "review"
                  ? `${items.length}`
                  : `${doneCount}/${items.length} · ${displayPercent}%`}
              </span>
            )}
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? B.fold : B.expand}
              title={expanded ? B.fold : B.expand}
              data-testid="batch-install-toggle-fold"
              onClick={() => setExpanded((was) => !was)}
              className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-subtle hover:text-fg"
            >
              <GlyphIcon d={expanded ? ICONS.chevronDown : ICONS.chevronUp} size={12} />
            </button>
            {phase !== "running" && <CloseButton onClose={handleClose} className="-mr-1" />}
          </div>
        </div>

        {/* Flush unified progress bar — always visible once started, both folded and expanded */}
        {phase !== "review" && (
          <div role="status" data-testid="batch-install-progress" className={expanded ? "px-2.5 pb-2" : "px-2.5 pb-2"}>
            <ProgressBar
              value={displayPercent}
              max={100}
              size="xs"
              tone={tone}
              label={B.progressLabel(items.length)}
            />
            {expanded && (
              <div className="mt-1 flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums text-fg-muted">
                <span className="min-w-0 truncate text-fg">
                  {phase === "running" && activeItem
                    ? `${activeIndex + 1}/${items.length} ${activeItem.title} · ${activeSentence}`
                    : phase === "done"
                      ? B.allDoneSummary(doneCount)
                      : B.partialSummary(doneCount, failedItems.length, items.length)}
                </span>
                {phase === "running" && activeTransfer !== null && (
                  <span className="shrink-0">{activeTransfer}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Expanded compact body */}
        {expanded && (
          <div
            className="max-h-[60vh] space-y-2 overflow-y-auto border-t border-line/60 px-2.5 py-2"
            data-testid="batch-install-body"
          >
            {/* Review meta + why */}
            {phase === "review" && (
              <div className="space-y-0.5 text-[11px]" data-testid="batch-install-reason">
                <div className="flex items-center justify-between gap-2 text-fg">
                  <span className="font-medium">{B.whyHeading}</span>
                  <span className="font-mono text-fg-muted">
                    {B.countBadge(items.length)} · {machineLabel ?? words.thisServer}
                  </span>
                </div>
                <p className="break-words text-fg-muted">{summaryReason}</p>
              </div>
            )}

            {/* High-density per-plugin list */}
            <ul
              className="max-h-36 divide-y divide-line/60 overflow-y-auto rounded-md border border-line/70 bg-surface-subtle/40"
              data-testid="batch-install-list"
            >
              {items.map((item) => {
                const st = states[item.specifier] ?? {
                  status: "pending" as const,
                  stage: null,
                  progress: null,
                  error: null,
                };
                const itemTransfer =
                  st.status === "running" ? formatTransferAmount(st.progress) : null;
                return (
                  <li
                    key={item.specifier}
                    className="space-y-0.5 px-2.5 py-1.5 text-[11px]"
                    data-testid={`batch-item-${item.specifier}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-fg">{item.title}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-fg-muted">
                          {item.specifier}
                          {item.version !== undefined ? `@${item.version}` : ""}
                        </span>
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums ${
                          st.status === "done"
                            ? toneInk.success
                            : st.status === "failed"
                              ? toneInk.attention
                              : st.status === "running"
                                ? "text-accent"
                                : "text-fg-muted"
                        }`}
                      >
                        {st.status === "done" && (
                          <GlyphIcon d={ICONS.checkCircle} size={ICON_SIZE.inlineGlyph} />
                        )}
                        {st.status === "failed" && (
                          <GlyphIcon d={ICONS.triangleAlert} size={ICON_SIZE.inlineGlyph} />
                        )}
                        <span>
                          {st.status === "pending"
                            ? phase === "review"
                              ? B.statusReady
                              : B.statusPending
                            : st.status === "running"
                              ? itemTransfer ?? installStepWords(st.progress, st.stage, true)
                              : st.status === "done"
                                ? B.statusDone
                                : B.statusFailed}
                        </span>
                      </span>
                    </div>
                    {(phase === "review" || st.status === "failed") && (
                      <p className="truncate text-fg-muted" title={item.reason}>
                        {item.reason}
                      </p>
                    )}
                    {st.status === "failed" && st.error && (
                      <p className={`break-words font-mono text-[10px] ${toneInk.attention}`}>
                        {st.error}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {phase === "review" && impactNote && (
              <p className="text-[11px] text-fg-muted">{impactNote}</p>
            )}

            {phase === "review" && dontAskLabel && (
              <Checkbox checked={dontAsk} label={dontAskLabel} onChange={setDontAsk} />
            )}

            {/* Compact failure recovery block (theme-adaptive, no oversized Notice padding) */}
            {phase === "failed" && (
              <div
                className="space-y-1.5 rounded-md border border-line bg-surface-subtle/70 px-2.5 py-2 text-[11px]"
                data-testid="batch-install-failure-recovery"
              >
                <p className={`font-medium ${toneInk.attention}`}>{B.failedRecommendTitle}</p>
                <p className="break-words text-fg-muted">{B.failedRecommendBody}</p>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {onOpenSources !== undefined && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={onOpenSources}
                      data-testid="batch-failure-manual-config"
                    >
                      <GlyphIcon d={ICONS.gear} />
                      {words.sourcesSettings}
                    </Button>
                  )}
                  {onConfigureWithAi !== undefined && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => onConfigureWithAi(failedItems)}
                      data-testid="batch-failure-agent-config"
                    >
                      <GlyphIcon d={ICONS.wand} />
                      {words.configureWithAi}
                    </Button>
                  )}
                  {onImportFile !== undefined && (
                    <Button size="sm" variant="link" onClick={onImportFile}>
                      {words.importFromFile}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Compact footer actions (only rendered when there are buttons) */}
            {phase !== "running" && (
              <div className="flex items-center justify-end gap-1.5">
                {phase === "review" && (
                  <>
                    <Button size="sm" variant="ghost" onClick={handleClose}>
                      {S.common.cancel}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void execute(false)}
                      data-testid="batch-install-confirm"
                    >
                      {B.startDownload(items.length)}
                    </Button>
                  </>
                )}
                {phase === "failed" && (
                  <>
                    <Button size="sm" variant="ghost" onClick={handleClose}>
                      {S.common.close}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void execute(true)}
                      data-testid="batch-install-retry"
                    >
                      {B.retryFailed(failedItems.length)}
                    </Button>
                  </>
                )}
                {phase === "done" && (
                  <Button size="sm" variant="primary" onClick={handleClose}>
                    {words.finish}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );

  return createPortal(dock, document.body);
}
