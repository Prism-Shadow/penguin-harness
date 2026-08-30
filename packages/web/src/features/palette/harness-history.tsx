/**
 * "Harness history": the versions this server's data root has committed through hot
 * updates (GET /api/version/history), newest first, with the one currently committed
 * marked. A version is named by its provenance when the pusher recorded it, and always by
 * the content-addressed bundles — the identity of the code itself.
 */
import { useEffect, useState } from "react";
import type { VersionHistoryResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { Modal } from "../../components/ui/modal";
import { Badge } from "../../components/ui/badge";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: VersionHistoryResponse };

/** The last path segment without its extension: `store/platform/1a2b3c4d5e6f7a8b.mjs` → `1a2b3c4d5e6f7a8b`. */
function shortSha(pointer: string | null): string {
  if (pointer === null) return "—";
  const base = pointer.slice(pointer.lastIndexOf("/") + 1);
  return base.replace(/\.[a-z]+$/i, "");
}

export function HarnessHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoad({ state: "loading" });
    void api
      .getVersionHistory()
      .then((data) => {
        if (!cancelled) setLoad({ state: "ready", data });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const t = S.harnessHistory;
  return (
    <Modal open={open} title={t.title} onClose={onClose} widthClass="max-w-2xl">
      {load.state === "loading" ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t.loading}</p>
      ) : load.state === "error" ? (
        <p className="text-sm text-red-600 dark:text-red-400">{load.message}</p>
      ) : load.data.entries.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t.empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {load.data.entries.map((e, i) => {
            const current =
              load.data.current !== null &&
              load.data.current.bundles.platform === e.bundles.platform &&
              load.data.current.bundles.web === e.bundles.web;
            return (
              <li
                key={`${e.pushedAt}-${i}`}
                className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-sm text-gray-900 dark:text-gray-100">
                    {e.source?.revision ?? t.noProvenance}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    {current ? <Badge tone="green">{t.current}</Badge> : null}
                    <time dateTime={e.pushedAt}>{formatDateTime(e.pushedAt)}</time>
                  </span>
                </div>
                {e.source ? (
                  <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {e.source.repo}
                  </div>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
                  <span>platform {shortSha(e.bundles.platform)}</span>
                  <span>cli {shortSha(e.bundles.cli)}</span>
                  <span>web {shortSha(e.bundles.web)}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}
