/**
 * What this Project asks for, and what the process is actually running.
 *
 * Two facts the dialog keeps apart: the LIST is the Project's (`plugins` in its
 * `.project_config.toml`) and is edited here, while a plugin is RUNNING only once the process
 * holds it. A write applies without a restart where the runtime can re-assemble the App; a
 * row shows which of the two it is, and a load that failed shows why. Adding a plugin goes
 * through the same verb as the catalogue row's Install (only a plugin the build ships), so
 * the list can never name a package that is not on the machine.
 */
import { useEffect, useState } from "react";
import type { InstalledPluginsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";

export function InstalledPluginsDialog({
  open,
  onClose,
  isAdmin,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  /** Whose list this is: plugins are asked for per Project (see the server's route). */
  projectId: string | null;
}) {
  const [data, setData] = useState<InstalledPluginsResponse | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFailure(null);
    setAdding("");
    let cancelled = false;
    if (projectId === null) return;
    api.getInstalledPlugins(projectId).then(
      (res) => {
        if (!cancelled) setData(res);
      },
      (e: unknown) => {
        if (!cancelled) setFailure(apiErrorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  /** One verb against the list — the same POST / DELETE the catalogue row uses. */
  const run = async (call: (projectId: string) => Promise<InstalledPluginsResponse>) => {
    if (busy || projectId === null) return;
    setBusy(true);
    setFailure(null);
    try {
      setData(await call(projectId));
      toastSuccess(S.common.saved);
    } catch (e) {
      setFailure(apiErrorText(e));
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const value = adding.trim();
    if (value === "" || (data?.plugins ?? []).some((p) => p.specifier === value)) return;
    setAdding("");
    void run((p) => api.installPlugin(p, value));
  };

  const rows = data?.plugins ?? [];
  return (
    <Modal open={open} title={S.plugins.installedTitle} onClose={onClose} widthClass="sm:max-w-xl">
      <div className="space-y-3 text-sm">
        <p className="text-gray-600 dark:text-gray-300">{S.plugins.installedDesc}</p>
        {failure !== null && (
          <div className={`rounded-md px-3 py-2 text-xs ${toneStrip.danger}`}>{failure}</div>
        )}
        {data !== null && data.restartPending && (
          <div className={`rounded-md px-3 py-2 text-xs ${toneStrip.attention}`}>
            {S.plugins.restartPending}
          </div>
        )}
        {data === null ? (
          <p className="text-xs text-gray-500">{S.common.loading}</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-gray-500">{S.plugins.installedEmpty}</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {rows.map((row) => (
              <li key={row.specifier} className="flex items-start gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="break-all font-mono text-xs">{row.specifier}</p>
                  <p className="mt-0.5 text-xs">
                    <span className={row.active ? toneInk.success : toneInk.muted}>
                      {row.active ? S.plugins.stateActive : S.plugins.stateInactive}
                    </span>
                    {row.builtin && (
                      <span
                        title={S.plugins.builtinHint}
                        className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-px text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      >
                        {S.plugins.builtin}
                      </span>
                    )}
                    {row.modules.length > 0 && (
                      <span className="text-gray-500"> · {row.modules.join(", ")}</span>
                    )}
                    {row.replaces.length > 0 && (
                      <span className="text-gray-500">
                        {" "}
                        · {S.plugins.replacesLabel}: {row.replaces.join(", ")}
                      </span>
                    )}
                  </p>
                  {row.error !== undefined && (
                    <p className={`mt-0.5 text-xs ${toneInk.danger}`}>{row.error}</p>
                  )}
                </div>
                {isAdmin && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run((p) => api.uninstallPlugin(p, row.specifier))}
                  >
                    {S.plugins.uninstall}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={S.plugins.addLabel}
                size="sm"
                value={adding}
                placeholder="@scope/penguin-plugin-name"
                hint={data === null ? undefined : S.plugins.fileHint(data.file)}
                disabled={busy}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") add();
                }}
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || adding.trim() === ""}
              onClick={add}
            >
              {S.plugins.install}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
