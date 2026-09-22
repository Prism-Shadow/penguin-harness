/**
 * A machine's Ports page (`/machines/:machineId/ports`) — every port forward reaching into
 * that machine, whichever Workspace made it, with everything known of each.
 *
 * The page for "why does this port not answer". A row says which layer is the dead one —
 * the local listener, or the last dial to the machine — and how much is going through the
 * live ones. Forwards are made where they belong, in a conversation's Ports panel; here
 * they can only be read and removed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { MachineInfo, PortForwardInfo } from "@prismshadow/penguin-server/api";
import { deletePortForward, getMachines, listPortForwards } from "../../api/endpoints";
import { CloseIcon } from "../../components/ui/icons";
import { Skeleton } from "../../components/ui/skeleton";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { groupByWorkspace } from "./port-forward-facts";
import { ForwardRow } from "./forward-cable";

const POLL_MS = 3000;
const MONO = "font-mono text-xs";

export function MachinePortsPage() {
  const { machineId = "" } = useParams();
  const { locale } = useLocale();
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const [forwards, setForwards] = useState<PortForwardInfo[] | null>(null);
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The alias is what people call the machine; the id is only what the address carries.
  const title = S.ports.machineTitle(machine?.alias ?? machineId);
  useDocumentTitle(title);

  const load = useCallback(async () => {
    try {
      setForwards((await listPortForwards(machineId)).forwards);
      setError(null);
    } catch (err) {
      setForwards((current) => current ?? []);
      setError(apiErrorText(err));
    }
  }, [machineId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (projectId === null) return;
    let live = true;
    void getMachines(projectId)
      .then((state) => {
        if (live) setMachine(state.machines.find((m) => m.machineId === machineId) ?? null);
      })
      .catch(() => {}); // The name is a nicety: without it the page reads by id.
    return () => {
      live = false;
    };
  }, [projectId, machineId]);

  const groups = useMemo(() => groupByWorkspace(forwards ?? []), [forwards]);

  const remove = async (forward: PortForwardInfo) => {
    try {
      await deletePortForward(forward.id);
    } catch (err) {
      setError(apiErrorText(err));
    }
    await load();
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <nav className="text-xs text-gray-500">
          <Link to="/machines" className="hover:underline">
            {S.ports.backToMachines}
          </Link>
        </nav>
        <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        {error !== null && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {forwards === null ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700">
            {S.ports.machineEmpty}
          </p>
        ) : (
          groups.map(([workspace, rows]) => (
            <section key={workspace} className="mt-5" data-testid="machine-ports-workspace">
              <h2 className={`${MONO} truncate px-2 text-gray-500`} title={workspace}>
                {workspace}
              </h2>
              <ul className="mt-1 space-y-0.5">
                {rows.map((forward) => (
                  <ForwardRow
                    key={forward.id}
                    forward={forward}
                    machineName={machine?.alias ?? machineId}
                    locale={locale}
                    actions={
                      <button
                        type="button"
                        title={S.ports.remove}
                        aria-label={S.ports.remove}
                        onClick={() => void remove(forward)}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      >
                        <CloseIcon size={12} />
                      </button>
                    }
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
