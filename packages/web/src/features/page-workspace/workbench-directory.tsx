import { useEffect, useState } from "react";
import { EmptyState, MenuItem, Spinner } from "@prismshadow/penguin-ui";
import { getWorkbenches } from "../../api/endpoints";
import { locatedAppKey } from "../../lib/app-center-path";
import { localizedText } from "../../lib/skill-use";
import { S } from "../../lib/strings";
import { useRestoreApp, type RunningShortcut } from "../../lib/running-apps";
import { shortcutOfWorkbench } from "../../lib/workbench-shortcut";
import { runningWorkbenches, WORKBENCH_UPDATED_EVENT } from "../../lib/workbench-tabs";
import { failureNode } from "../../lib/failure";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { TileIcon } from "../app-center";
import { useSafeMode } from "../../rescue/safe-mode";
import type { ReactNode } from "react";

export function WorkbenchDirectory({ path }: { path: string }) {
  const { currentProject } = useProject();
  const params = new URL(path, "http://localhost").searchParams;
  const agentId = params.get("workbenches")!;
  const machineId = params.get("machine");
  const projectId = currentProject?.projectId;
  const [rows, setRows] = useState<RunningShortcut[] | null>(null);
  const [failure, setFailure] = useState<ReactNode>(null);
  const safe = useSafeMode();
  const restore = useRestoreApp();
  const { locale } = useLocale();
  useEffect(() => {
    if (!projectId || safe) return;
    let current = 0;
    let live = true;
    const load = async () => {
      const request = ++current;
      try {
        const list = await getWorkbenches(projectId, agentId, machineId);
        if (live && request === current) {
          setFailure(null);
          setRows(
            runningWorkbenches(list)
              .filter((w) => w.tabs.length)
              .map((w) =>
                shortcutOfWorkbench(projectId, { agentId, agentName: agentId }, w, machineId),
              ),
          );
        }
      } catch (err) {
        if (live && request === current)
          setFailure(failureNode(err, { what: "workbenches could not be read" }));
      }
    };
    void load();
    window.addEventListener(WORKBENCH_UPDATED_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(WORKBENCH_UPDATED_EVENT, load);
    };
  }, [agentId, machineId, projectId, safe]);
  return (
    <section
      aria-label={S.pageWorkspace.workbenches}
      className="h-full overflow-auto bg-canvas p-4"
    >
      <h2 className="mb-3 text-sm font-semibold">{S.pageWorkspace.workbenches}</h2>
      {failure ??
        (safe || rows?.length === 0 ? (
          <EmptyState title={S.pageWorkspace.empty} />
        ) : rows === null ? (
          <Spinner label={S.common.loading} />
        ) : (
          rows.map((shortcut) => {
            const key = locatedAppKey(shortcut.agentId, shortcut.workbenchId, shortcut.machineId);
            const title = localizedText(locale, shortcut.title, shortcut.titleZh);
            return (
              <MenuItem
                key={key}
                label={title}
                glyph={<TileIcon shortcut={shortcut} title={title} size={20} />}
                onSelect={() => restore(key, shortcut)}
              />
            );
          })
        ))}
    </section>
  );
}
