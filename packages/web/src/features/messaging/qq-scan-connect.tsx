/**
 * QQ scan-to-connect — the alternative to copying an App ID and an App Secret out of the QQ
 * developer console by hand: a QR code, scanned in the QQ app, that hands the credentials
 * straight to the server.
 *
 * What this component may and may not know is the whole design. The server registers a bind
 * task under an AES key it keeps, and this component receives a task handle, a URL, and a
 * status. It never sees the key, and it never sees the App Secret — a completed poll returns
 * the App ID and the saved binding, because the credentials went into storage server-side
 * without passing back through the browser. That is the same rule that keeps a stored secret
 * from round-tripping through the form above it.
 *
 * The QR is rendered from the URL locally rather than fetched as an image: the URL is short,
 * a generated `<svg>` stays crisp at any size, and an image request would put the task handle
 * into a third party's logs.
 *
 * Dark-on-white in both themes, deliberately. A QR inverted for a dark background is read
 * unreliably by phone cameras that assume dark modules on a light field, and a scan that
 * silently fails on half the machines is worse than a white plate in a dark panel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { encode } from "uqr";
import type { MessagingBindingInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { toastError, toastSuccess } from "../../components/ui/toast";

/** Modules of quiet zone around the code — four is what the QR spec asks for. */
const QUIET_ZONE = 4;

/** Rendered edge of the code, in CSS pixels. */
const QR_SIZE_PX = 168;

/** One QR code as an inline SVG: one `<rect>` per dark module, on a white plate. Exported for tests. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, data } = encode(value);
  const span = size + QUIET_ZONE * 2;
  const modules: React.ReactElement[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y]?.[x] !== true) continue;
      modules.push(
        // Modules are drawn 1.02 wide so neighbours meet: a hairline gap between them at
        // fractional device pixel ratios is what makes a rendered code hard to scan.
        <rect key={`${x}-${y}`} x={x + QUIET_ZONE} y={y + QUIET_ZONE} width={1.02} height={1.02} />,
      );
    }
  }
  return (
    <svg
      viewBox={`0 0 ${span} ${span}`}
      width={QR_SIZE_PX}
      height={QR_SIZE_PX}
      role="img"
      aria-label={label}
      className="shrink-0 rounded-md"
      shapeRendering="crispEdges"
    >
      <rect width={span} height={span} fill="#ffffff" />
      <g fill="#000000">{modules}</g>
    </svg>
  );
}

/** Where the flow stands, as the panel shows it. */
type ScanPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; taskId: string; qrUrl: string; pollMs: number; refreshed: boolean };

export function QQScanConnect({
  sessionId,
  /** The channel's connection is enabled: a scan would rebind a live connector, so it is gated. */
  enabled,
  /** Fired when a scan stored a binding, so the editor refreshes its facts and baseline. */
  onBound,
}: {
  sessionId: string;
  enabled: boolean;
  onBound: (binding: MessagingBindingInfo) => void;
}) {
  const [phase, setPhase] = useState<ScanPhase>({ kind: "idle" });
  /** The task the effects act on, read by the unmount cleanup without re-running it. */
  const taskRef = useRef<string | null>(null);
  /** Set once the component is going away, so an in-flight poll stops writing state. */
  const goneRef = useRef(false);

  const start = useCallback(
    async (refreshed: boolean) => {
      setPhase({ kind: "starting" });
      try {
        const res = await api.startQQScan(sessionId);
        if (goneRef.current) {
          // Started into a component that is already gone: drop the task rather than leave
          // the server holding a key nobody will ever poll for.
          void api.cancelQQScan(sessionId, res.taskId).catch(() => {});
          return;
        }
        taskRef.current = res.taskId;
        setPhase({
          kind: "waiting",
          taskId: res.taskId,
          qrUrl: res.qrUrl,
          pollMs: res.pollMs,
          refreshed,
        });
      } catch (e) {
        if (goneRef.current) return;
        taskRef.current = null;
        setPhase({ kind: "idle" });
        toastError(S.qq.scanFailed(apiErrorText(e)));
      }
    },
    [sessionId],
  );

  const stop = useCallback(() => {
    const taskId = taskRef.current;
    taskRef.current = null;
    setPhase({ kind: "idle" });
    if (taskId !== null) void api.cancelQQScan(sessionId, taskId).catch(() => {});
  }, [sessionId]);

  // The poll loop. Restarted whenever the task changes and torn down with it; an expired
  // task starts a new one rather than stranding the user in front of a dead code, which is
  // what the protocol asks for.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const { taskId, pollMs } = phase;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        if (cancelled) return;
        try {
          const res = await api.pollQQScan(sessionId, taskId);
          if (cancelled) return;
          if (res.status === "expired") {
            taskRef.current = null;
            void start(true);
            return;
          }
          if (res.status !== "completed") return;
          taskRef.current = null;
          setPhase({ kind: "idle" });
          toastSuccess(S.qq.scanDone(res.appId ?? ""));
          if (res.binding !== undefined) onBound(res.binding);
        } catch (e) {
          if (cancelled) return;
          taskRef.current = null;
          setPhase({ kind: "idle" });
          toastError(S.qq.scanFailed(apiErrorText(e)));
        }
      })();
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `start` and `onBound` are stable enough for this to key on the task alone; re-running
    // on their identity would restart the poll on every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind === "waiting" ? phase.taskId : null, sessionId]);

  // Leaving the editor drops the task: the server then forgets its key immediately instead
  // of holding it until the TTL sweep.
  useEffect(() => {
    goneRef.current = false;
    return () => {
      goneRef.current = true;
      const taskId = taskRef.current;
      taskRef.current = null;
      if (taskId !== null) void api.cancelQQScan(sessionId, taskId).catch(() => {});
    };
  }, [sessionId]);

  if (phase.kind !== "waiting") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={phase.kind === "starting" || enabled}
          {...(enabled ? { title: S.qq.scanDisableFirst } : {})}
          onClick={() => void start(false)}
        >
          {phase.kind === "starting" ? S.qq.scanStarting : S.qq.scanStart}
        </Button>
        <span className="text-xs text-gray-500 dark:text-gray-400">{S.qq.scanHint}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <QrCode value={phase.qrUrl} label={S.qq.scanQrLabel} />
      <div className="min-w-0 flex-1 space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
        <p className="text-sm text-gray-700 dark:text-gray-300">{S.qq.scanWaiting}</p>
        <p>{S.qq.scanSteps}</p>
        {/* Only shown once a code has actually lapsed: a standing note that codes expire is
            noise until one does. */}
        {phase.refreshed && (
          <p className="text-gray-400 dark:text-gray-500">{S.qq.scanRefreshed}</p>
        )}
        <p className="text-gray-400 dark:text-gray-500">{S.qq.scanPrivacy}</p>
        <Button size="sm" variant="ghost" onClick={stop}>
          {S.common.cancel}
        </Button>
      </div>
    </div>
  );
}
