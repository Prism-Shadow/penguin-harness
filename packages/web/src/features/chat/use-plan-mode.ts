import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionPlan, SessionStatus } from "@prismshadow/penguin-server/api";
import { changeSessionPlan, getSessionPlan } from "../../api/endpoints";
import { toastApiError } from "../../lib/toast-api-error";

export function usePlanMode(
  sessionId: string | undefined,
  status: SessionStatus,
  language: "zh" | "en",
) {
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [pending, setPending] = useState(false);
  const request = useRef(0);
  const current = useRef(sessionId);
  current.current = sessionId;
  useEffect(() => {
    setPlan(null);
    setPending(false);
  }, [sessionId]);
  const refresh = useCallback(() => {
    if (!sessionId) return;
    const id = ++request.current;
    void getSessionPlan(sessionId)
      .then((result) => {
        if (id === request.current && current.current === sessionId) setPlan(result.plan);
      })
      .catch(() => {});
  }, [sessionId]);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [status, refresh]);
  const change = async (action: "enable" | "exit" | "approve") => {
    if (pending) return;
    if (!sessionId) {
      setPlan(action === "enable" ? { proposal: null } : null);
      return;
    }
    ++request.current;
    setPending(true);
    try {
      const result = await changeSessionPlan(sessionId, action, plan?.proposal?.revision, language);
      if (current.current === sessionId) {
        ++request.current;
        setPlan(result.plan);
      }
    } catch (err) {
      toastApiError(err);
      refresh();
    } finally {
      if (current.current === sessionId) setPending(false);
    }
  };
  return { plan, pending, change };
}
