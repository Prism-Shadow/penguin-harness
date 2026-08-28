/**
 * WeChat scan-to-connect — the ONLY way to bind this channel, rather than QQ's convenient
 * alternative to typing credentials: a WeChat bot token exists nowhere a person could copy
 * it from, so this component is the whole of the credential form.
 *
 * What it may and may not know is the design, and it is the same rule qq-scan-connect.tsx
 * follows. The server holds the platform's poll handle — the thing that turns into a bot
 * token — and this component receives a task id it mints instead, plus a URL and a status. A
 * completed poll returns the bot's id and the saved binding, because the credential went into
 * storage server-side without passing back through the browser.
 *
 * The QR is rendered from the URL locally rather than fetched as an image: the URL is short,
 * a generated `<svg>` stays crisp at any size, and an image request would put the handle into
 * a third party's logs. Dark-on-white in both themes, for the reason the QQ panel documents:
 * a code inverted for a dark background is read unreliably by phone cameras.
 *
 * ## The pairing code
 *
 * WeChat may interpose a step QQ has no equivalent of: the phone shows a short number that
 * has to be entered here before the authorization completes. It arrives as a status rather
 * than an error, so the panel grows an input in place instead of tearing the code down — the
 * QR is still the thing being authorized, and taking it off screen mid-flow would strand the
 * user. A wrong number is not reported as a failure either: the platform simply asks again,
 * which reaches here as the same status a second time.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { encode } from "uqr";
import type {
  MessagingBindingInfo,
  WeChatBindingInfo,
  WeChatScanPollResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { QrCode } from "./qq-scan-connect";

/**
 * Consecutive poll failures ridden out before the code comes down. The interval fires
 * whether or not the previous request came back, so a single 502 from a busy platform must
 * not take the QR off the screen while the user is still walking to their phone.
 */
const POLL_FAILURES_TOLERATED = 3;

/** How many lapsed codes are replaced automatically before the panel stops asking for another. */
const AUTO_REFRESH_LIMIT = 3;

/** One poll attempt's outcome, as the loop hands it to the classifier. */
export type WeChatScanAttempt =
  { ok: true; res: WeChatScanPollResponse } | { ok: false; error: unknown };

/** What the loop has seen so far, NOT counting the attempt being classified. */
export interface WeChatScanTally {
  /** Consecutive attempts that failed; any attempt that came back resets it. */
  failures: number;
  /** Codes already replaced automatically after the platform reported one expired. */
  refreshes: number;
}

/** What one attempt tells the panel to do next. */
export type WeChatScanStep =
  | { kind: "wait" }
  /** Scanned, or waiting for the pairing code: the panel's caption changes, nothing else. */
  | { kind: "progress"; status: "scanned" | "need_verify_code" }
  | { kind: "refresh" }
  | { kind: "bound"; botId: string; binding: WeChatBindingInfo | undefined }
  | {
      kind: "stop";
      notice: string;
      /** Whether the notice is news rather than a fault (`already_bound` is not a failure). */
      tone: "error" | "info";
      /**
       * The task is still the server's to forget: true when the panel gave up on a task
       * nothing has resolved, false when the platform already reported the code spent and the
       * server consumed it on that poll.
       */
      releaseTask: boolean;
    };

/**
 * Classifies one poll attempt — the `updateCheckOutcome` idiom: the decision is a pure
 * function, and the loop around it only carries the tally and performs the effects.
 *
 * Three of the answers are why this is a function at all. A failed attempt is `wait` until it
 * has failed several times running, so a transient error does not abandon a scan mid-flight.
 * `refresh` is capped, or a platform answering `expired` to codes it has just created would
 * loop create/poll for as long as the panel stays open. And `already_bound` stops WITHOUT
 * being a failure: nothing was saved because nothing needed to be.
 */
export function wechatScanStep(attempt: WeChatScanAttempt, tally: WeChatScanTally): WeChatScanStep {
  if (!attempt.ok) {
    return tally.failures + 1 < POLL_FAILURES_TOLERATED
      ? { kind: "wait" }
      : {
          kind: "stop",
          notice: S.wechat.scanFailed(apiErrorText(attempt.error)),
          tone: "error",
          releaseTask: true,
        };
  }
  const { res } = attempt;
  switch (res.status) {
    case "completed":
      return { kind: "bound", botId: res.botId ?? "", binding: res.binding };
    case "scanned":
    case "need_verify_code":
      return { kind: "progress", status: res.status };
    case "blocked":
      return { kind: "stop", notice: S.wechat.scanBlocked, tone: "error", releaseTask: false };
    case "already_bound":
      return { kind: "stop", notice: S.wechat.scanAlreadyBound, tone: "info", releaseTask: false };
    case "expired":
      return tally.refreshes + 1 > AUTO_REFRESH_LIMIT
        ? {
            kind: "stop",
            notice: S.wechat.scanExpiredRepeatedly,
            tone: "error",
            releaseTask: false,
          }
        : { kind: "refresh" };
    default:
      return { kind: "wait" };
  }
}

/** Where the flow stands, as the panel shows it. */
type ScanPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "waiting";
      taskId: string;
      qrUrl: string;
      pollMs: number;
      refreshed: boolean;
      /** What the last poll reported, which is the caption and whether the code input shows. */
      progress: "pending" | "scanned" | "need_verify_code";
    };

export function WeChatScanConnect({
  sessionId,
  /** The channel's connection is enabled: a scan would rebind a live connector, so it is gated. */
  enabled,
  /** A token is already stored, so the control offers to REPLACE it rather than to connect. */
  bound,
  /** Fired when a scan stored a binding, so the editor refreshes its facts and baseline. */
  onBound,
}: {
  sessionId: string;
  enabled: boolean;
  bound: boolean;
  onBound: (binding: MessagingBindingInfo) => void;
}) {
  const [phase, setPhase] = useState<ScanPhase>({ kind: "idle" });
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  /** The task the effects act on, read by the unmount cleanup without re-running it. */
  const taskRef = useRef<string | null>(null);
  /** Set once the component is going away, so an in-flight poll stops writing state. */
  const goneRef = useRef(false);
  /** What `wechatScanStep` classifies each attempt against; lives outside React state. */
  const tallyRef = useRef<WeChatScanTally>({ failures: 0, refreshes: 0 });

  const start = useCallback(
    async (refreshed: boolean) => {
      setPhase({ kind: "starting" });
      setVerifyCode("");
      // A new code starts a fresh failure count; only a scan the USER asked for starts a
      // fresh refresh count, or the cap on automatic replacement would never be reached.
      tallyRef.current = { failures: 0, refreshes: refreshed ? tallyRef.current.refreshes : 0 };
      try {
        const res = await api.startWeChatScan(sessionId);
        if (goneRef.current) {
          // Started into a component that is already gone: drop the task rather than leave
          // the server holding a handle nobody will ever poll for.
          void api.cancelWeChatScan(sessionId, res.taskId).catch(() => {});
          return;
        }
        taskRef.current = res.taskId;
        setPhase({
          kind: "waiting",
          taskId: res.taskId,
          qrUrl: res.qrUrl,
          pollMs: res.pollMs,
          refreshed,
          progress: "pending",
        });
      } catch (e) {
        if (goneRef.current) return;
        taskRef.current = null;
        setPhase({ kind: "idle" });
        toastError(S.wechat.scanFailed(apiErrorText(e)));
      }
    },
    [sessionId],
  );

  const stop = useCallback(() => {
    const taskId = taskRef.current;
    taskRef.current = null;
    setPhase({ kind: "idle" });
    if (taskId !== null) void api.cancelWeChatScan(sessionId, taskId).catch(() => {});
  }, [sessionId]);

  // The poll loop. Restarted whenever the task changes and torn down with it; what each
  // answer means is `wechatScanStep`'s, so this only carries the tally and does the effects.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const { taskId, pollMs } = phase;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        if (cancelled) return;
        let attempt: WeChatScanAttempt;
        try {
          attempt = { ok: true, res: await api.pollWeChatScan(sessionId, taskId) };
        } catch (error) {
          attempt = { ok: false, error };
        }
        if (cancelled) return;
        const step = wechatScanStep(attempt, tallyRef.current);
        tallyRef.current = {
          failures: attempt.ok ? 0 : tallyRef.current.failures + 1,
          refreshes: tallyRef.current.refreshes,
        };
        if (step.kind === "wait") return;
        if (step.kind === "progress") {
          // The code stays up; only the caption (and the pairing-code input) changes.
          setPhase((prev) =>
            prev.kind === "waiting" && prev.taskId === taskId
              ? { ...prev, progress: step.status }
              : prev,
          );
          return;
        }
        taskRef.current = null;
        if (step.kind === "refresh") {
          tallyRef.current = { failures: 0, refreshes: tallyRef.current.refreshes + 1 };
          void start(true);
          return;
        }
        setPhase({ kind: "idle" });
        if (step.kind === "bound") {
          toastSuccess(S.wechat.scanDone(step.botId));
          if (step.binding !== undefined) onBound(step.binding);
          return;
        }
        // A run of failed polls says nothing about the server, so the task may well still be
        // live: it is released here the way cancel and unmount release one.
        if (step.releaseTask) void api.cancelWeChatScan(sessionId, taskId).catch(() => {});
        if (step.tone === "info") toastInfo(step.notice);
        else toastError(step.notice);
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

  // Leaving the editor drops the task: the server then forgets its handle immediately
  // instead of holding it until the TTL sweep.
  useEffect(() => {
    goneRef.current = false;
    return () => {
      goneRef.current = true;
      const taskId = taskRef.current;
      taskRef.current = null;
      if (taskId !== null) void api.cancelWeChatScan(sessionId, taskId).catch(() => {});
    };
  }, [sessionId]);

  const submitVerifyCode = async (taskId: string) => {
    const code = verifyCode.trim();
    if (code === "") return;
    setVerifying(true);
    try {
      await api.verifyWeChatScan(sessionId, taskId, code);
      // Cleared on submit rather than on acceptance: the platform reports a wrong code by
      // asking again, and leaving the rejected digits in the box would read as accepted.
      setVerifyCode("");
    } catch (e) {
      toastError(S.wechat.scanFailed(apiErrorText(e)));
    } finally {
      setVerifying(false);
    }
  };

  if (phase.kind !== "waiting") {
    return (
      <div>
        <Button
          size="sm"
          disabled={phase.kind === "starting" || enabled}
          {...(enabled ? { title: S.wechat.scanDisableFirst } : {})}
          onClick={() => void start(false)}
        >
          {phase.kind === "starting"
            ? S.wechat.scanStarting
            : bound
              ? S.wechat.scanRescan
              : S.wechat.scanStart}
        </Button>
      </div>
    );
  }

  const needsCode = phase.progress === "need_verify_code";
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <QrCode value={phase.qrUrl} label={S.wechat.scanQrLabel} />
      <div className="min-w-0 flex-1 space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {needsCode
            ? S.wechat.verifyPrompt
            : phase.progress === "scanned"
              ? S.wechat.scanScanned
              : S.wechat.scanWaiting}
        </p>
        {needsCode ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitVerifyCode(phase.taskId);
            }}
          >
            <Input
              size="sm"
              aria-label={S.wechat.verifyLabel}
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              className="w-28 font-mono"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
            />
            <Button size="sm" type="submit" disabled={verifying || verifyCode.trim() === ""}>
              {verifying ? S.wechat.verifySubmitting : S.wechat.verifySubmit}
            </Button>
          </form>
        ) : (
          <p>{S.wechat.scanSteps}</p>
        )}
        {/* Only shown once a code has actually lapsed: a standing note that codes expire is
            noise until one does. */}
        {phase.refreshed && (
          <p className="text-gray-400 dark:text-gray-500">{S.wechat.scanRefreshed}</p>
        )}
        <p className="text-gray-400 dark:text-gray-500">{S.wechat.scanPrivacy}</p>
        <Button size="sm" variant="ghost" onClick={stop}>
          {S.common.cancel}
        </Button>
      </div>
    </div>
  );
}
