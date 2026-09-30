import { useEffect, useRef, useState } from "react";
import type {
  PlatformAuthFlowErrorCode,
  PlatformAuthFlowStatusResponse,
  PlatformAuthStartResponse,
} from "@prismshadow/penguin-server/api";
import type { KeyAuthEndpoints } from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";

const POLL_MS = 3_000;

type Phase = "starting" | "ready" | "waiting" | "applying" | "failed" | "done";

/**
 * The localized copy a group's dialog shows. Everything else — the phases, the poll, the
 * apply/retry path — is the same for every group that uses this component, so the vendor's
 * name appears in these three and nowhere else.
 */
export interface KeyAuthTexts {
  intro: (count: number) => string;
  appliedBody: (applied: number) => string;
  errors: Record<PlatformAuthFlowErrorCode, string>;
}

/**
 * A group whose credential the server fetches for the user, presented like any other provider's
 * "authorize a key" action. The wire protocol behind it is a device-style start/poll rather
 * than OAuth/PKCE, and which one applies is the `endpoints` prop's business: Penguin Go polls
 * its own relay, ModelScope polls the harness's authorization bridge. Account metadata never
 * enters this component; a completed flow only reports how many preset rows took the key.
 */
export function KeyAuthDialog({
  projectId,
  providerLabel,
  count,
  endpoints,
  texts,
  onClose,
  onApplied,
}: {
  projectId: string;
  providerLabel: string;
  count: number;
  endpoints: KeyAuthEndpoints;
  texts: KeyAuthTexts;
  onClose: () => void;
  onApplied: (applied: number) => void;
}) {
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
  // The poll effect below must not depend on these two: a caller building its `texts` inline
  // would hand this component a new object every render, and the effect would restart the poll
  // on each one.
  const endpointsRef = useRef(endpoints);
  endpointsRef.current = endpoints;
  const textsRef = useRef(texts);
  textsRef.current = texts;

  const flowError = (code: PlatformAuthFlowErrorCode | undefined): string =>
    (code !== undefined ? textsRef.current.errors[code] : undefined) ??
    textsRef.current.errors.upstream_failed;

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
    const { current: auth } = endpointsRef;
    const tick = async (): Promise<void> => {
      try {
        const next = await auth.status(projectId, flow.flowId);
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
        if (cause instanceof ApiError && cause.code === auth.flowNotFoundCode) {
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
      void endpoints.cancel(projectId, flow.flowId).catch(() => {});
    }
    onClose();
  };

  const beginAuthorization = async (): Promise<void> => {
    if (phase === "starting" || retrySeconds > 0) return;
    if (flow !== null) {
      void endpoints.cancel(projectId, flow.flowId).catch(() => {});
    }
    completedRef.current = false;
    setFlow(null);
    setError(null);
    setRetryableApply(false);
    setPhase("starting");
    const generation = ++startGenerationRef.current;

    // Open synchronously from the click so browsers do not treat the eventual navigation as
    // an unsolicited popup while the server creates the one-time authorization request.
    const authorizationTab = window.open("about:blank", "_blank");
    if (authorizationTab !== null) authorizationTab.opener = null;
    try {
      const started = await endpoints.start(projectId);
      if (generation !== startGenerationRef.current) {
        authorizationTab?.close();
        void endpoints.cancel(projectId, started.flowId).catch(() => {});
        return;
      }
      setFlow(started);
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
      const next: PlatformAuthFlowStatusResponse = await endpoints.retryApply(
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
          {phase === "done" ? texts.appliedBody(applied) : texts.intro(count)}
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
