/**
 * Authorize a new API key for a provider group: the dialog the Models page opens for a group
 * whose catalog entry publishes a key-minting flow.
 */
import { useEffect, useRef, useState } from "react";
import type { ModelOAuthMode } from "@prismshadow/penguin-server/api";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import { Button, GlyphIcon, ICONS, Input, Modal, Spinner } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import {
  OAUTH_STALL_MS,
  fellBackToManual,
  shownMode,
  stalledAfterReturn,
} from "./model-oauth-mode";
import type { OpenedFlow } from "./model-oauth-mode";

/** Where the dialog is: opening a flow, holding one, waiting on an outcome, or reporting a failure. */
/**
 * `done` exists because the authorization happens in ANOTHER TAB. A toast fired at the moment
 * the poll sees the key would be announced to a window the user is not looking at, and by the
 * time they switch back it has faded — the outcome of the one step they left the app for is the
 * one thing they must not have to guess at. So the dialog stays put and says it instead, and is
 * dismissed deliberately.
 */
type OAuthPhase = "starting" | "ready" | "waiting" | "failed" | "done";

/** How often the redirect flow's outcome is asked for while the user is in the other tab. */
const OAUTH_POLL_MS = 2000;

/**
 * Mint a fresh group key for a provider group by authorizing in the browser: it is written as
 * the group's key, which every model without a key of its own uses.
 *
 * The dialog never handles the key, and never handles the PKCE verifier either: it opens a
 * flow, sends the user to the provider's page, and asks the server how that flow ended. Two
 * routes back — the provider redirects to the server (polled here), or, when that redirect
 * cannot reach the harness, the user carries a one-time code across by hand. The second is
 * also where the dialog lands on its own when the server says the redirect cannot reach it,
 * and what it offers when the person comes back from the provider and nothing has arrived.
 */
export function ModelOAuthDialog({
  projectId,
  provider,
  count,
  onClose,
  onApplied,
}: {
  projectId: string;
  provider: ModelProviderInfo;
  /** Models in the group with no key of their own: the ones that will use the new group key. */
  count: number;
  onClose: () => void;
  onApplied: (applied: number) => void;
}) {
  /** The route back the person asked for; the opened flow may say otherwise (model-oauth-mode.ts). */
  const [asked, setAsked] = useState<ModelOAuthMode>("callback");
  const [phase, setPhase] = useState<OAuthPhase>("starting");
  const [flow, setFlow] = useState<OpenedFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  /** How many models use the group key the flow wrote — the sentence the `done` phase reports. */
  const [applied, setApplied] = useState(0);
  /** Bumped to reopen a flow after a failure; switching modes reopens one too (the URL differs). */
  const [attempt, setAttempt] = useState(0);
  /** When this window regained focus while a redirect was awaited: the person came back. */
  const [returnedAt, setReturnedAt] = useState<number | null>(null);
  const [stalled, setStalled] = useState(false);
  // Latest-callback ref: the parent passes an inline arrow, and depending on its identity
  // would tear down and restart the poll interval on every render.
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  const mode = shownMode(asked, flow);
  const manual = mode === "manual";
  const fellBack = fellBackToManual(asked, flow);

  // A flow is opened as soon as the dialog shows, so the authorize URL is already in hand
  // when the button is pressed — window.open then runs inside that click's own user
  // activation, which is what keeps a popup blocker out of the way.
  useEffect(() => {
    let cancelled = false;
    setPhase("starting");
    setFlow(null);
    setError(null);
    setCode("");
    setReturnedAt(null);
    setStalled(false);
    void (async () => {
      try {
        const res = await api.startModelOAuth(projectId, { provider: provider.id, mode: asked });
        if (cancelled) return;
        setFlow(res);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setError(apiErrorText(e));
        setPhase("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, provider.id, asked, attempt]);

  // Redirect mode: the outcome lands on the server, so this tab only learns of it by asking.
  // A flow that has expired answers 404, which reads the same as never coming back.
  useEffect(() => {
    if (phase !== "waiting" || manual || flow === null) return;
    let stopped = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await api.getModelOAuthStatus(projectId, flow.flowId);
        if (stopped) return;
        if (res.status === "done") {
          // The server's own count, not the table in hand: `rows` is kept through a rejected
          // save so the user can fix and retry, so it can name models the server never wrote.
          const n = res.applied ?? count;
          setApplied(n);
          setPhase("done");
          onAppliedRef.current(n);
          return;
        }
        if (res.status === "error") {
          setError(res.error ? S.models.oauthErrors[res.error] : S.models.oauthTimedOut);
          setPhase("failed");
        }
      } catch {
        if (stopped) return;
        setError(S.models.oauthTimedOut);
        setPhase("failed");
      }
    };
    const timer = window.setInterval(() => void tick(), OAUTH_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase, manual, flow, projectId, count]);

  // The person returning to this window is the moment a stranded redirect becomes visible:
  // the provider sent their browser somewhere that never answered, and nothing arrives here.
  useEffect(() => {
    if (phase !== "waiting" || manual) return;
    const onFocus = (): void => setReturnedAt((at) => at ?? Date.now());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [phase, manual]);

  useEffect(() => {
    if (returnedAt === null || stalled) return;
    const check = (): void =>
      setStalled(
        stalledAfterReturn({ waiting: phase === "waiting", mode, returnedAt, now: Date.now() }),
      );
    const timer = window.setTimeout(check, OAUTH_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [returnedAt, stalled, phase, mode]);

  const openAuthorizePage = (): void => {
    if (flow === null) return;
    window.open(flow.authorizeUrl, "_blank", "noopener,noreferrer");
    if (!manual) setPhase("waiting");
  };

  const submitCode = async (): Promise<void> => {
    if (flow === null) return;
    setPhase("waiting");
    setError(null);
    try {
      const res = await api.submitModelOAuthCode(projectId, flow.flowId, code.trim());
      if (res.ok) {
        const n = res.applied ?? count;
        setApplied(n);
        setPhase("done");
        onAppliedRef.current(n);
        return;
      }
      setError(res.error ? S.models.oauthErrors[res.error] : S.models.oauthTimedOut);
      setPhase("failed");
    } catch (e) {
      setError(apiErrorText(e));
      setPhase("failed");
    }
  };

  const primary =
    phase === "failed" ? (
      <Button size="sm" variant="primary" onClick={() => setAttempt((n) => n + 1)}>
        {S.models.oauthRetry}
      </Button>
    ) : manual ? (
      <Button
        size="sm"
        variant="primary"
        disabled={flow === null || phase === "waiting" || !code.trim()}
        onClick={() => void submitCode()}
      >
        {S.models.oauthSubmitCode}
      </Button>
    ) : (
      <Button size="sm" variant="primary" disabled={flow === null} onClick={openAuthorizePage}>
        {S.models.oauthAuthorize}
      </Button>
    );

  return (
    <Modal
      open
      title={S.models.oauthTitle(provider.label)}
      onClose={onClose}
      footer={
        // Done is an outcome, not a choice: a "cancel" beside it would offer to undo a key that
        // is already written.
        phase === "done" ? (
          <Button size="sm" onClick={onClose}>
            {S.common.close}
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={onClose}>
              {S.common.cancel}
            </Button>
            {primary}
          </>
        )
      }
    >
      <div className="space-y-3">
        {phase === "done" ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {S.models.oauthAppliedBody(provider.label, applied)}
          </p>
        ) : (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {S.models.oauthIntro(provider.label, count)}
          </p>
        )}
        {phase !== "done" && fellBack && (
          <p className={`text-xs ${toneInk.attention}`}>{S.models.oauthCallbackUnreachable}</p>
        )}
        {phase !== "done" && manual && (
          <>
            {/* In the dialog body, directly above the code Input: it takes the same rung the
                field does, not the page-level md. */}
            <Button size="sm" variant="ghost" disabled={flow === null} onClick={openAuthorizePage}>
              <GlyphIcon d={ICONS.signIn} size={13} />
              {S.models.oauthAuthorize}
            </Button>
            <Input
              size="sm"
              label={S.models.oauthCodeLabel}
              hint={S.models.oauthManualHint}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          </>
        )}
        {phase === "waiting" && !manual && (
          <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <Spinner size="xs" label={S.common.loading} />
            {S.models.oauthWaiting}
          </p>
        )}
        {phase === "waiting" && !manual && stalled && (
          <div className="space-y-1.5">
            <p className={`text-xs ${toneInk.attention}`}>{S.models.oauthStalled}</p>
            <Button size="sm" onClick={() => setAsked("manual")}>
              {S.models.oauthStalledAction}
            </Button>
          </div>
        )}
        {error !== null && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {/* No way back to the redirect when the server has said it cannot be received: the
            switch would only open another flow that falls back again. */}
        {phase !== "done" && !fellBack && (
          <Button variant="link" size="sm" onClick={() => setAsked(manual ? "callback" : "manual")}>
            {manual ? S.models.oauthCallbackSwitch : S.models.oauthManualSwitch}
          </Button>
        )}
      </div>
    </Modal>
  );
}
