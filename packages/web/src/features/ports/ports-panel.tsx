/**
 * Ports panel — the conversation's Workspace's port forwards, as a dock tab beside the
 * terminal. A forward brings a TCP port of the machine the Workspace is on to THIS
 * server's loopback; it belongs to the Workspace (machine + directory), so every
 * conversation there sees the same rows, and they are still there after a restart.
 *
 * A Workspace on this server has nothing to forward — its ports are on the loopback
 * already — and says so instead of offering a form that could only make a loop.
 *
 * Polling is gated on `active` (the dock keeps hidden tabs mounted): the facts on a row —
 * connections open, the last dial — are only worth fetching while someone is looking.
 */
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { PortForwardInfo } from "@prismshadow/penguin-server/api";
import { createPortForward, deletePortForward, listPortForwards } from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { CopyButton } from "../../components/ui/copy-button";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CloseIcon, EXTERNAL_LINK_ICON } from "../../components/ui/icons";
import { noAutofill } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { apiErrorText } from "../../lib/api-error";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { parsePort } from "./port-forward-facts";
import { Cable, ForwardRow, Plug } from "./forward-cable";
import { useMachineName } from "./use-machine-name";

/** How often the facts are re-read while the tab is showing. */
const POLL_MS = 3000;

/** A port typed straight onto a plug: bare, mono, as wide as five digits. */
const PORT_FIELD =
  "w-12 bg-transparent font-mono text-xs tabular-nums text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-600";
const PORT_FIELD_SEP = "ml-1 text-gray-400";

const ROW_BUTTON =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200";

export function PortsPanel({
  machineId,
  workspace,
  active,
}: {
  /** The machine the Workspace is on; null = this server. */
  machineId: string | null;
  workspace: string;
  active: boolean;
}) {
  const { user } = useAuth();
  if (machineId === null) {
    return <EmptyState title={S.ports.panelTitle} description={S.ports.localNote} />;
  }
  if (user?.isAdmin !== true) {
    return <EmptyState title={S.ports.panelTitle} description={S.ports.adminOnly} />;
  }
  return <MachinePorts machineId={machineId} workspace={workspace} active={active} />;
}

function MachinePorts({
  machineId,
  workspace,
  active,
}: {
  machineId: string;
  workspace: string;
  active: boolean;
}) {
  const { locale } = useLocale();
  const machineName = useMachineName(machineId);
  const [forwards, setForwards] = useState<PortForwardInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteText, setRemoteText] = useState("");
  const [localText, setLocalText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setForwards((await listPortForwards(machineId, workspace)).forwards);
    } catch (err) {
      // A failed poll keeps the rows it had: a blip must not empty the list under the reader.
      setForwards((current) => current ?? []);
      setError(apiErrorText(err));
    }
  }, [machineId, workspace]);

  useEffect(() => {
    if (!active) return;
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const remotePort = parsePort(remoteText);
    if (remotePort === null) return setError(S.ports.invalidRemotePort);
    const localPort = localText.trim() === "" ? undefined : parsePort(localText, 1024);
    if (localPort === null) return setError(S.ports.invalidLocalPort);
    setBusy(true);
    setError(null);
    try {
      await createPortForward({ machineId, workspace, remotePort, localPort });
      setRemoteText("");
      setLocalText("");
      await load();
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (forward: PortForwardInfo) => {
    setError(null);
    try {
      await deletePortForward(forward.id);
    } catch (err) {
      setError(apiErrorText(err));
    }
    await load();
  };

  return (
    <div data-testid="ports-panel" className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {forwards === null ? (
          <div className="space-y-2 p-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-2/3" />
          </div>
        ) : forwards.length === 0 ? (
          <p className="p-1 text-xs text-gray-500">{S.ports.empty}</p>
        ) : (
          <ul className="space-y-0.5">
            {forwards.map((forward) => {
              const address = `localhost:${forward.localPort}`;
              return (
                <ForwardRow
                  key={forward.id}
                  forward={forward}
                  machineName={machineName}
                  locale={locale}
                  actions={
                    <>
                      <CopyButton
                        text={address}
                        label={S.ports.copyAddress}
                        className={ROW_BUTTON}
                      />
                      <a
                        href={`http://${address}/`}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={S.ports.open}
                        aria-label={S.ports.open}
                        className={ROW_BUTTON}
                      >
                        <GlyphIcon d={EXTERNAL_LINK_ICON} size={ICON_SIZE.inlineGlyph} />
                      </a>
                      <button
                        type="button"
                        title={S.ports.remove}
                        aria-label={S.ports.remove}
                        onClick={() => void remove(forward)}
                        className={ROW_BUTTON}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </>
                  }
                />
              );
            })}
          </ul>
        )}
      </div>
      {/* The form is a cable too — the two ports still to be typed — so it reads like the rows
          above it, arrow included: what is typed on the left is the machine's, on the right ours. */}
      <form
        onSubmit={(event) => void submit(event)}
        aria-label={S.ports.formTitle}
        className="shrink-0 border-t border-gray-200 p-3 dark:border-gray-800"
      >
        <div className={`flex items-center ${ICON_GAP.row}`}>
          <Plug name={machineName}>
            <span className={PORT_FIELD_SEP}>:</span>
            <input
              {...noAutofill}
              aria-label={S.ports.remotePort}
              placeholder="3000"
              inputMode="numeric"
              value={remoteText}
              onChange={(event) => setRemoteText(event.target.value)}
              className={PORT_FIELD}
            />
          </Plug>
          <Cable tone="muted" flowing={false} label={S.ports.formTitle} />
          <Plug name={S.ports.here}>
            <span className={PORT_FIELD_SEP}>:</span>
            <input
              {...noAutofill}
              aria-label={S.ports.localPort}
              placeholder={S.ports.autoPort}
              inputMode="numeric"
              value={localText}
              onChange={(event) => setLocalText(event.target.value)}
              className={PORT_FIELD}
            />
          </Plug>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="ml-1"
            disabled={busy || remoteText === ""}
          >
            {S.ports.forward}
          </Button>
        </div>
        {error !== null && (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
