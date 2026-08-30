/**
 * Harness history: the versions this server's data root committed through hot updates,
 * newest first, and what each push changed — provenance, the content-addressed bundles,
 * and the interface table (ifaces.json) it was built from, diffed against the version
 * before it: nodes of the tree that appeared, vanished or rewired; interfaces whose
 * members changed. A push is shown as what it changed, not as a hash.
 */
import { useEffect, useMemo, useState } from "react";
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

export function HarnessHistoryPage() {
  const t = S.harnessHistory;
  const [history, setHistory] = useState<VersionHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [diff, setDiff] = useState<DiffLoad>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
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
  }, []);

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

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t.pageDesc}</p>

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
                <h2 className="font-mono text-lg">{entry.source?.revision ?? t.noProvenance}</h2>
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
                    platform {shortSha(entry.bundles.platform)} · cli {shortSha(entry.bundles.cli)}{" "}
                    · web {shortSha(entry.bundles.web)}
                  </dd>
                  <dt className="text-gray-500 dark:text-gray-400">{t.table}</dt>
                  <dd className="font-mono text-xs tabular-nums">
                    {entry.ifaces
                      ? `${entry.ifaces.hash} · ${t.tableCounts(entry.ifaces.nodes, entry.ifaces.interfaces, entry.ifaces.types)}`
                      : t.noTable}
                  </dd>
                </dl>

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
                  <div className={`mt-2 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>
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
  );
}
