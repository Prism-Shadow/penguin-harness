/**
 * Machines page: the hosts of the SERVER's own `~/.ssh/config`, and installing this build
 * on one of them.
 *
 * The list is the config text — the server does no `ssh -G` and no network to produce it —
 * so a config declaring hundreds of hosts renders as fast as one declaring two, and a row
 * carries nothing but its alias. Anything more (is it up, what runs there) would cost a
 * round trip per host at page load, which is the price this deliberately does not pay.
 *
 * An install is a job on the server, not a request that finishes: it probes the machine,
 * may fetch a Node runtime, copies an image over scp and runs an installer there. POST
 * starts it and the page polls while it runs. The progress lines are the far side's own
 * words wherever there are any, so they are rendered verbatim in a monospace block rather
 * than interpreted here — a refused key or an unusable Node explains itself better than any
 * status enum could.
 *
 * Which row shows what is decided in machines-view.ts; this file maps that onto strings and
 * tones.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MachinesResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { toneInk, toneStrip } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { ICON_SIZE } from "../../lib/icon-scale";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { InfoPopover } from "../../components/ui/info-popover";
import { Skeleton } from "../../components/ui/skeleton";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { NAV_ICONS } from "../../components/ui/icons";
import { machineRowState } from "./machines-view";
import type { MachineVerdict } from "./machines-view";

/** How often a running job is re-read. Slow enough to be free, fast enough that a step reads as progress. */
const POLL_MS = 1500;

/** A finished job's one-line verdict, and the tone that carries it. */
function verdictLine(verdict: MachineVerdict): { text: string; tone: Tone } {
  if (verdict.kind === "failed") {
    return { text: S.machines.failedAt(verdict.step), tone: "danger" };
  }
  const version = verdict.version ?? "";
  return {
    text:
      verdict.kind === "already-installed"
        ? S.machines.alreadyInstalled(version)
        : S.machines.installed(version),
    tone: "success",
  };
}

export function MachinesPage() {
  useDocumentTitle(S.machines.pageTitle);
  const [state, setState] = useState<MachinesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The row whose POST is still in flight — the server has no job to report during that window. */
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api.getMachines());
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while a job runs. Chained timeouts rather than an interval: a slow response
  // must not stack requests behind itself.
  const running = state?.job?.running === true;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(() => {
        void loadRef.current().finally(() => {
          if (!cancelled) tick();
        });
      }, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running]);

  const install = async (machineId: string) => {
    setStarting(machineId);
    try {
      setState(await api.installOnMachine(machineId));
      setError(null);
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="flex items-center gap-1.5 text-xl font-semibold">
          {S.machines.pageTitle}
          <InfoPopover label={S.machines.pageTitle}>{S.machines.pageDesc}</InfoPopover>
        </h1>

        {error !== null && (
          <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>
            {error}
          </div>
        )}

        {state === null ? (
          <div className="mt-6 space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            {state.imageVersion === null ? (
              <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${toneStrip.attention}`}>
                {S.machines.noImage}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {S.machines.imageVersion(state.imageVersion)}
              </p>
            )}

            {state.machines.length === 0 ? (
              <EmptyState title={S.machines.empty} />
            ) : (
              <div className="mt-6 divide-y divide-gray-200 overflow-hidden rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                {state.machines.map((machine) => {
                  const row = machineRowState(machine.id, state, starting);
                  const verdict = row.verdict === null ? null : verdictLine(row.verdict);
                  return (
                    <div key={machine.id} className="bg-white dark:bg-gray-900">
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <span className="text-gray-500 dark:text-gray-400">
                          <GlyphIcon d={NAV_ICONS.machines} size={ICON_SIZE.rowLead} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {machine.alias}
                        </span>
                        {row.running && (
                          <span className={`text-xs ${toneInk.busy}`}>{S.machines.installing}</span>
                        )}
                        {verdict !== null && (
                          <span className={`text-xs ${toneInk[verdict.tone]}`}>{verdict.text}</span>
                        )}
                        <Button
                          size="sm"
                          disabled={row.disabled}
                          onClick={() => void install(machine.id)}
                        >
                          {row.action === "installing"
                            ? S.machines.installing
                            : row.action === "reinstall"
                              ? S.machines.reinstall
                              : S.machines.install}
                        </Button>
                      </div>

                      {/* The job's own words, under the row they belong to. */}
                      {row.log.length > 0 && (
                        <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            {S.machines.output}
                          </p>
                          <pre className="mt-1 max-h-64 overflow-auto break-words whitespace-pre-wrap font-mono text-xs text-gray-700 dark:text-gray-300">
                            {row.log.join("\n")}
                          </pre>
                          {row.verdict?.kind === "failed" && (
                            <pre
                              className={`mt-2 break-words whitespace-pre-wrap font-mono text-xs ${toneInk.danger}`}
                            >
                              {row.verdict.message}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
