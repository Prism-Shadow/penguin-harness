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
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneDot } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { dialLine, forwardTone, listenerLine, parsePort } from "./port-forward-facts";

/** How often the facts are re-read while the tab is showing. */
const POLL_MS = 3000;

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
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {forwards === null ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-40" />
          </div>
        ) : forwards.length === 0 ? (
          <p className="text-xs text-gray-500">{S.ports.empty}</p>
        ) : (
          <ul className="space-y-1">
            {forwards.map((forward) => {
              const address = `localhost:${forward.localPort}`;
              return (
                <li
                  key={forward.id}
                  data-testid="port-forward-row"
                  className="flex items-center gap-2 text-sm"
                  title={`${listenerLine(forward)}\n${dialLine(forward, locale)}`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[forwardTone(forward)]}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {forward.remotePort} → {address}
                  </span>
                  {forward.open > 0 && (
                    <span className="shrink-0 text-xs text-gray-500">
                      {S.ports.connections(forward.open)}
                    </span>
                  )}
                  <CopyButton text={address} label={S.ports.copyAddress} className={ROW_BUTTON} />
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <form
        onSubmit={(event) => void submit(event)}
        className="shrink-0 border-t border-gray-200 p-3 dark:border-gray-800"
      >
        <div className="flex items-center gap-2">
          {/* The flex item is the wrapper: Input renders inside its own Field. */}
          <div className="min-w-0 flex-1">
            <Input
              aria-label={S.ports.remotePort}
              placeholder={S.ports.remotePort}
              inputMode="numeric"
              value={remoteText}
              onChange={(event) => setRemoteText(event.target.value)}
              className="font-mono"
            />
          </div>
          <div className="min-w-0 flex-1">
            <Input
              aria-label={S.ports.localPort}
              placeholder={S.ports.localPort}
              inputMode="numeric"
              value={localText}
              onChange={(event) => setLocalText(event.target.value)}
              className="font-mono"
            />
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={busy || remoteText === ""}>
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
