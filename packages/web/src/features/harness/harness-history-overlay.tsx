/**
 * Harness history, as an overlay over whatever the user was doing — not a page, so
 * closing it returns to exactly where they were. It fills the viewport short of a small
 * margin; Escape (through the shared esc-layer stack), the close button, or a click on
 * the margin closes it.
 *
 * It lists the versions this server's data root committed through hot updates,
 * newest first, and what each push changed — provenance, the content-addressed bundles,
 * and the interface table (ifaces.json) it was built from, diffed against the version
 * before it: nodes of the tree that appeared, vanished or rewired; interfaces whose
 * members changed. A push is shown as what it changed, not as a hash.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../../components/ui/icons";
import { isTopEscLayer, popEscLayer, pushEscLayer } from "../../components/ui/modal";
import type {
  HarnessHistoryEntry,
  IfaceChange,
  MemberChange,
  ModuleChange,
  VersionHistoryDiffResponse,
  VersionHistoryResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneStrip } from "../../lib/tone";

/** The last path segment without its extension: `store/platform/1a2b….mjs` → `1a2b…`. */
function shortSha(pointer: string | null): string {
  if (pointer === null) return "—";
  const base = pointer.slice(pointer.lastIndexOf("/") + 1);
  return base.replace(/\.[a-z]+$/i, "");
}

const changeTone: Record<MemberChange["change"], "green" | "red" | "amber"> = {
  added: "green",
  removed: "red",
  changed: "amber",
};

function isCurrent(
  entry: HarnessHistoryEntry,
  current: VersionHistoryResponse["current"],
): boolean {
  return (
    current !== null &&
    current.bundles.platform === entry.bundles.platform &&
    current.bundles.web === entry.bundles.web
  );
}

function Members({ label, items }: { label: string; items: MemberChange[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      {items.map((m) => (
        <span key={m.name} className="inline-flex items-center gap-1 font-mono">
          <Badge tone={changeTone[m.change]}>{S.harnessHistory.change[m.change]}</Badge>
          {m.name}
        </span>
      ))}
    </div>
  );
}

function ModuleRow({ m }: { m: ModuleChange }) {
  const t = S.harnessHistory;
  return (
    <li className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
      <div className="flex items-center gap-2 font-mono text-sm">
        <Badge tone={changeTone[m.change]}>{t.change[m.change]}</Badge>
        {m.name}
        {m.kind ? (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {m.kind.from ?? "—"} → {m.kind.to ?? "—"}
          </span>
        ) : null}
      </div>
      {m.change === "changed" ? (
        <div className="mt-1 flex flex-col gap-1">
          <Members label={t.requires} items={m.requires} />
          <Members label={t.provides} items={m.provides} />
          <Members label={t.contributes} items={m.contributes} />
          <Members label={t.children} items={m.children} />
          <Members label={t.exports} items={m.exports} />
        </div>
      ) : null}
    </li>
  );
}

function IfaceRow({ i }: { i: IfaceChange }) {
  const t = S.harnessHistory;
  return (
    <li className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
      <div className="flex items-center gap-2 font-mono text-sm" title={i.key}>
        <Badge tone={changeTone[i.change]}>{t.change[i.change]}</Badge>
        {i.key.slice(i.key.indexOf("#") + 1)}
        <span className="truncate text-xs text-gray-400 dark:text-gray-500">
          {i.key.slice(0, i.key.indexOf("#"))}
        </span>
      </div>
      {i.change === "changed" ? (
        <div className="mt-1 flex flex-col gap-1">
          <Members label={t.methods} items={i.methods} />
          <Members label={t.fields} items={i.fields} />
          <Members label={t.slots} items={i.slots} />
        </div>
      ) : null}
    </li>
  );
}

type DiffLoad =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; diff: VersionHistoryDiffResponse };

export function HarnessHistoryOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = S.harnessHistory;
  const [history, setHistory] = useState<VersionHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [diff, setDiff] = useState<DiffLoad>({ state: "idle" });
  // Rollback: armed by the first click, sent by the second; then the history is polled
  // until the runtime's current commit is the target (the swap happens under us).
  const [rollback, setRollback] = useState<
    | { state: "idle" }
    | { state: "armed"; id: string }
    | { state: "pushing"; id: string }
    | { state: "done"; id: string }
    | { state: "error"; message: string }
  >({ state: "idle" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHistory(null);
    setError(null);
    setSelected(0);
    void api
      .getVersionHistory()
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape closes it only while it is the topmost esc-consuming layer (shared with Modal /
  // Dropdown / the palette, see modal.tsx).
  useEffect(() => {
    if (!open) return;
    const id = pushEscLayer();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopEscLayer(id)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popEscLayer(id);
    };
  }, [open, onClose]);

  const reload = () =>
    api
      .getVersionHistory()
      .then((data) => setHistory(data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

  const startRollback = async (id: string) => {
    setRollback({ state: "pushing", id });
    try {
      await api.rollbackVersion(id);
      // The swap replaces this platform; the runtime answers /history again once the new one is up.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const h = await api.getVersionHistory();
          const cur = h.entries.find((e) => isCurrent(e, h.current));
          if (cur?.id === id) {
            setHistory(h);
            setRollback({ state: "done", id });
            return;
          }
        } catch {
          // mid-swap: the seam queues or refuses; keep polling
        }
      }
      setRollback({ state: "error", message: S.harnessHistory.rollbackTimeout });
      await reload();
    } catch (err) {
      setRollback({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const entries = useMemo(() => history?.entries ?? [], [history]);
  const entry = entries[selected] ?? null;
  const previous = entries[selected + 1] ?? null;

  // The diff is "this version against the one before it": the previous entry's table when
  // it has one, else nothing — so the oldest recorded table reads as everything appearing.
  useEffect(() => {
    if (entry === null || entry.ifaces === null) {
      setDiff({ state: "idle" });
      return;
    }
    let cancelled = false;
    setDiff({ state: "loading" });
    void api
      .getVersionHistoryDiff(previous?.ifaces?.hash ?? "none", entry.ifaces.hash)
      .then((d) => {
        if (!cancelled) setDiff({ state: "ready", diff: d });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setDiff({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [entry, previous]);

  if (!open) return null;

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-[70] bg-black/45"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 12px off every edge: enough to read as a layer over the app, not a page of it. */}
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        className="anim-pop absolute inset-3 flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
      >
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-3 dark:border-gray-800">
          <div>
            <h1 className="text-lg font-semibold">{t.title}</h1>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{t.pageDesc}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={S.common.close}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mx-auto max-w-6xl">
            {error !== null && (
              <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>
                {error}
              </div>
            )}

            {history === null ? (
              <div className="mt-6 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : entries.length === 0 ? (
              <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">{t.empty}</p>
            ) : (
              <div className="mt-6 grid gap-6 md:grid-cols-[minmax(260px,320px)_1fr]">
                <ol className="flex flex-col gap-1" aria-label={t.title}>
                  {entries.map((e, i) => (
                    <li key={`${e.bundles.platform ?? ""}-${i}`}>
                      <button
                        type="button"
                        onClick={() => setSelected(i)}
                        aria-current={i === selected ? "true" : undefined}
                        className={`w-full rounded-md border px-3 py-2 text-left ${
                          i === selected
                            ? "border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
                            : "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-mono text-sm">
                            {e.source?.revision ?? t.noProvenance}
                          </span>
                          {isCurrent(e, history.current) ? (
                            <Badge tone="green">{t.current}</Badge>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>{e.pushedAt ? formatDateTime(e.pushedAt) : "—"}</span>
                          <span className="font-mono">
                            {e.ifaces ? e.ifaces.hash.slice(0, 8) : t.noTableShort}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ol>

                {entry === null ? null : (
                  <section className="min-w-0">
                    <h2 className="font-mono text-lg">
                      {entry.source?.revision ?? t.noProvenance}
                    </h2>
                    {entry.source ? (
                      <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                        {entry.source.repo}
                      </p>
                    ) : null}
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                      <dt className="text-gray-500 dark:text-gray-400">{t.pushedAt}</dt>
                      <dd>{entry.pushedAt ? formatDateTime(entry.pushedAt) : "—"}</dd>
                      <dt className="text-gray-500 dark:text-gray-400">{t.bundles}</dt>
                      <dd className="font-mono text-xs tabular-nums">
                        platform {shortSha(entry.bundles.platform)} · cli{" "}
                        {shortSha(entry.bundles.cli)} · web {shortSha(entry.bundles.web)}
                      </dd>
                      <dt className="text-gray-500 dark:text-gray-400">{t.table}</dt>
                      <dd className="font-mono text-xs tabular-nums">
                        {entry.ifaces
                          ? `${entry.ifaces.hash} · ${t.tableCounts(entry.ifaces.nodes, entry.ifaces.interfaces, entry.ifaces.types)}`
                          : t.noTable}
                      </dd>
                    </dl>

                    {!isCurrent(entry, history.current) ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        {!entry.rollbackable ? (
                          <span className="text-gray-500 dark:text-gray-400">{t.notKept}</span>
                        ) : rollback.state === "armed" && rollback.id === entry.id ? (
                          <>
                            <span className="text-gray-700 dark:text-gray-300">
                              {t.rollbackConfirm}
                            </span>
                            <button
                              type="button"
                              onClick={() => void startRollback(entry.id)}
                              className="rounded-md bg-red-600 px-3 py-1 text-white hover:bg-red-700"
                            >
                              {t.rollbackYes}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRollback({ state: "idle" })}
                              className="rounded-md border border-gray-300 px-3 py-1 dark:border-gray-700"
                            >
                              {S.common.cancel}
                            </button>
                          </>
                        ) : rollback.state === "pushing" && rollback.id === entry.id ? (
                          <span className="text-gray-700 dark:text-gray-300">
                            {t.rollbackPushing}
                          </span>
                        ) : rollback.state === "done" && rollback.id === entry.id ? (
                          <span className="text-green-700 dark:text-green-400">
                            {t.rollbackDone}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRollback({ state: "armed", id: entry.id })}
                            className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                          >
                            {t.rollback}
                          </button>
                        )}
                        {rollback.state === "error" ? (
                          <span className="text-red-600 dark:text-red-400">{rollback.message}</span>
                        ) : null}
                      </div>
                    ) : null}

                    <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {previous
                        ? t.changesSince(
                            previous.source?.revision ?? previous.ifaces?.hash.slice(0, 8) ?? "—",
                          )
                        : t.changesFirst}
                    </h3>
                    {entry.ifaces === null ? (
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t.noTable}</p>
                    ) : diff.state === "loading" || diff.state === "idle" ? (
                      <Skeleton className="mt-2 h-9 w-full" />
                    ) : diff.state === "error" ? (
                      <div
                        className={`mt-2 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}
                      >
                        {diff.message}
                      </div>
                    ) : diff.diff.modules.length + diff.diff.ifaces.length === 0 &&
                      diff.diff.types.added + diff.diff.types.removed + diff.diff.types.changed ===
                        0 ? (
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t.noChanges}</p>
                    ) : (
                      <div className="mt-2 flex flex-col gap-4">
                        {diff.diff.modules.length > 0 ? (
                          <div>
                            <h4 className="mb-1 text-sm font-medium">
                              {t.nodes(diff.diff.modules.length)}
                            </h4>
                            <ul className="flex flex-col gap-1">
                              {diff.diff.modules.map((m) => (
                                <ModuleRow key={m.name} m={m} />
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {diff.diff.ifaces.length > 0 ? (
                          <div>
                            <h4 className="mb-1 text-sm font-medium">
                              {t.interfaces(diff.diff.ifaces.length)}
                            </h4>
                            <ul className="flex flex-col gap-1">
                              {diff.diff.ifaces.map((i) => (
                                <IfaceRow key={i.key} i={i} />
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t.typesSummary(
                            diff.diff.types.added,
                            diff.diff.types.removed,
                            diff.diff.types.changed,
                          )}
                        </p>
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
