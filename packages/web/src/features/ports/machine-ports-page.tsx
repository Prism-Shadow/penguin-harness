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
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Skeleton } from "../../components/ui/skeleton";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes } from "../../lib/format";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneDot } from "../../lib/tone";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { dialLine, forwardTone, groupByWorkspace, listenerLine } from "./port-forward-facts";

const POLL_MS = 3000;
const MONO = "font-mono text-xs";
const REMOVE_ICON = "M6 6l12 12M18 6 6 18";

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
              <h2 className={`${MONO} truncate text-gray-500`} title={workspace}>
                {workspace}
              </h2>
              <ul className="mt-2 space-y-2">
                {rows.map((forward) => (
                  <li
                    key={forward.id}
                    data-testid="machine-port-forward"
                    className="rounded-xl border border-gray-200 p-3 dark:border-gray-800"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[forwardTone(forward)]}`}
                        aria-hidden="true"
                      />
                      <span className={`${MONO} min-w-0 flex-1 truncate`}>
                        {forward.remotePort} → localhost:{forward.localPort}
                      </span>
                      <button
                        type="button"
                        title={S.ports.remove}
                        aria-label={S.ports.remove}
                        onClick={() => void remove(forward)}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      >
                        <GlyphIcon d={REMOVE_ICON} size={ICON_SIZE.inlineGlyph} />
                      </button>
                    </div>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                      <dt className="text-gray-500">{S.ports.colListener}</dt>
                      <dd>{listenerLine(forward)}</dd>
                      <dt className="text-gray-500">{S.ports.colDial}</dt>
                      <dd className="break-words">{dialLine(forward, locale)}</dd>
                      <dt className="text-gray-500">{S.ports.colOpen}</dt>
                      <dd>{forward.open}</dd>
                      <dt className="text-gray-500">{S.ports.colTraffic}</dt>
                      <dd className={MONO}>
                        {formatBytes(forward.bytesUp)} / {formatBytes(forward.bytesDown)}
                      </dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
