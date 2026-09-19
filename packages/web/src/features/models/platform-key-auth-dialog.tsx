import { useEffect, useRef, useState } from "react";
import type {
  PlatformAuthFlowErrorCode,
  PlatformAuthFlowStatusResponse,
  PlatformAuthStartResponse,
} from "@prismshadow/penguin-server/api";
import { ApiError } from "../../api/client";
import * as api from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { apiErrorText } from "../../lib/api-error";
import { isElectronRenderer } from "../../lib/desktop-renderer";
import { S } from "../../lib/strings";

const POLL_MS = 3_000;

type Phase = "starting" | "ready" | "waiting" | "applying" | "failed" | "done";

function flowError(code: PlatformAuthFlowErrorCode | undefined): string {
  return code ? S.models.platformKeyErrors[code] : S.models.platformKeyErrors.upstream_failed;
}

/**
 * Penguin Go uses a device-style start/poll exchange internally, but presents the
 * same group-level "authorize a key" interaction as TokenDance. Account metadata never
 * enters this component; the completed flow only reports how many preset rows got the key.
 */
export function PlatformKeyAuthDialog({
  projectId,
  providerLabel,
  count,
  onClose,
  onApplied,
}: {
  projectId: string;
  providerLabel: string;
  count: number;
  onClose: () => void;
  onApplied: (applied: number) => void;
}) {
  // A browser needs a tab opened inside the click, before the server has the URL, or its
  // popup blocker eats the navigation. The desktop shell's window has no popup blocker and its
  // shell refuses every blank window, so there the URL is opened once it is known and the
  // shell hands it to the system browser. Decided by the renderer, not the session: in attach
  // mode the shell's window holds an ordinary password session (see lib/desktop-renderer).
  const bridge = !isElectronRenderer(navigator.userAgent);
  const [phase, setPhase] = useState<Phase>("ready");
  const [flow, setFlow] = useState<PlatformAuthStartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [retryableApply, setRetryableApply] = useState(false);
  const completedRef = useRef(false);
  const startGenerationRef = useRef(0);
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  useEffect(
    () => () => {
      startGenerationRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(
      () => setRetrySeconds((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  useEffect(() => {
    if ((phase !== "waiting" && phase !== "applying") || flow === null) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async (): Promise<void> => {
      try {
        const next = await api.getPlatformAuthFlow(projectId, flow.flowId);
        if (stopped) return;
        if (next.status === "pending") {
          timer = window.setTimeout(() => void tick(), POLL_MS);
          return;
        }
        if (next.status === "applying") {
          setPhase("applying");
          timer = window.setTimeout(() => void tick(), POLL_MS);
          return;
        }
        if (next.status === "completed") {
          const nextApplied = next.applied ?? count;
          setApplied(nextApplied);
          setPhase("done");
          if (!completedRef.current) {
            completedRef.current = true;
            onAppliedRef.current(nextApplied);
          }
          return;
        }
        const canRetryApply = next.status === "apply_failed";
        setError(flowError(next.error));
        setRetryableApply(canRetryApply);
        if (!canRetryApply) setFlow(null);
        setPhase("failed");
      } catch (cause) {
        if (stopped) return;
        setError(apiErrorText(cause));
        setRetryableApply(false);
        if (cause instanceof ApiError && cause.code === "platform_auth_flow_not_found") {
          setFlow(null);
        }
        setPhase("failed");
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [count, flow, phase, projectId]);

  const close = (): void => {
    startGenerationRef.current += 1;
    if (flow !== null && phase !== "done") {
      void api.cancelPlatformAuth(projectId, flow.flowId).catch(() => {});
    }
    onClose();
  };

  const beginAuthorization = async (): Promise<void> => {
    if (phase === "starting" || retrySeconds > 0) return;
    if (flow !== null) {
      void api.cancelPlatformAuth(projectId, flow.flowId).catch(() => {});
    }
    completedRef.current = false;
    setFlow(null);
    setError(null);
    setRetryableApply(false);
    setPhase("starting");
    const generation = ++startGenerationRef.current;

    // Open synchronously from the click so browsers do not treat the eventual navigation as
    // an unsolicited popup while the server creates the one-time authorization request.
    const authorizationTab = bridge ? window.open("about:blank", "_blank") : null;
    if (authorizationTab !== null) authorizationTab.opener = null;
    try {
      const started = await api.startPlatformAuth(projectId);
      if (generation !== startGenerationRef.current) {
        authorizationTab?.close();
        void api.cancelPlatformAuth(projectId, started.flowId).catch(() => {});
        return;
      }
      setFlow(started);
      if (!bridge) {
        window.open(started.authorizeUrl, "_blank", "noopener,noreferrer");
        setPhase("waiting");
        return;
      }
      if (authorizationTab === null) {
        // Popup blockers can still intervene. Keep the created request and let the next
        // explicit click open its URL without consuming another platform start quota.
        setPhase("ready");
        return;
      }
      authorizationTab.location.replace(started.authorizeUrl);
      setPhase("waiting");
    } catch (cause) {
      authorizationTab?.close();
      if (generation !== startGenerationRef.current) return;
      setError(apiErrorText(cause));
      if (cause instanceof ApiError && cause.retryAfterSeconds !== undefined) {
        setRetrySeconds(cause.retryAfterSeconds);
      }
      setPhase("failed");
    }
  };

  const retryApply = async (): Promise<void> => {
    if (flow === null) return;
    setError(null);
    setPhase("applying");
    try {
      const next: PlatformAuthFlowStatusResponse = await api.retryPlatformAuthApply(
        projectId,
        flow.flowId,
      );
      if (next.status !== "completed") {
        setError(flowError(next.error));
        setRetryableApply(next.status === "apply_failed");
        setPhase("failed");
        return;
      }
      const nextApplied = next.applied ?? count;
      setApplied(nextApplied);
      setPhase("done");
      if (!completedRef.current) {
        completedRef.current = true;
        onAppliedRef.current(nextApplied);
      }
    } catch (cause) {
      setError(apiErrorText(cause));
      setRetryableApply(true);
      setPhase("failed");
    }
  };

  const primary =
    phase === "failed" && retryableApply ? (
      <Button size="sm" variant="primary" onClick={() => void retryApply()}>
        {S.models.oauthRetry}
      </Button>
    ) : (
      <Button
        size="sm"
        variant="primary"
        disabled={
          phase === "starting" || phase === "waiting" || phase === "applying" || retrySeconds > 0
        }
        onClick={() => {
          if (flow !== null) {
            window.open(flow.authorizeUrl, "_blank", "noopener,noreferrer");
            setPhase("waiting");
            return;
          }
          void beginAuthorization();
        }}
      >
        {phase === "failed"
          ? retrySeconds > 0
            ? `${S.models.oauthRetry} (${retrySeconds}s)`
            : S.models.oauthRetry
          : S.models.oauthAuthorize}
      </Button>
    );

  return (
    <Modal
      open
      title={S.models.oauthTitle(providerLabel)}
      onClose={close}
      footer={
        phase === "done" ? (
          <Button size="sm" onClick={close}>
            {S.common.close}
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={close}>
              {S.common.cancel}
            </Button>
            {primary}
          </>
        )
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {phase === "done"
            ? S.models.platformKeyAppliedBody(applied)
            : S.models.platformKeyIntro(count)}
        </p>
        {(phase === "starting" || phase === "waiting" || phase === "applying") && (
          <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent" />
            {phase === "starting"
              ? S.models.platformKeyStarting
              : phase === "applying"
                ? S.models.platformKeyApplying
                : S.models.oauthWaiting}
          </p>
        )}
        {error !== null && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  );
}
