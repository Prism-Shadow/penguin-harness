import { useEffect, useMemo, useRef, useState } from "react";
import { FIRST_PAINT_BYTES, TAIL_UNITS, apiErrorText, createStreamModel, getChildSessions, openHistoryStream, pushMessages, readHistory, seedHistoryWindow } from "@prismshadow/penguin-web/internal";
import type { StreamModel } from "@prismshadow/penguin-web/internal";

import { ChildSessionHistory } from "./child-session-history";

/** Scoped by the keyed parent panel. Only one read may extend its cursor chain at a time. */
export function useChildSessions(
  sessionId: string,
  machineId: string | null,
  change: string,
  connection: number,
  anchor: string | null,
) {
  const index = useMemo(
    () => new ChildSessionHistory((before) => getChildSessions(sessionId, before, machineId)),
    [sessionId, machineId],
  );
  const queue = useRef(Promise.resolve());
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const refreshed = useRef<string | null>(null);
  const token = JSON.stringify([sessionId, change, connection, attempt]);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError(null);
    queue.current = queue.current
      .then(async () => {
        if (!current) return;
        if (refreshed.current !== token) {
          await index.refresh();
          refreshed.current = token;
        }
        if (!current) return;
        await index.completeTurn(anchor);
        if (current) setRevision((value) => value + 1);
      })
      .catch((reason: unknown) => {
        if (current) setError(apiErrorText(reason));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [index, token, anchor]);
  const turns = useMemo(() => {
    const groups = new Map<string, typeof index.items>();
    for (const child of index.items) {
      const group = groups.get(child.turnKey);
      if (group) group.push(child);
      else groups.set(child.turnKey, [child]);
    }
    return [...groups.values()];
  }, [index, revision]);
  return { turns, busy, error, retry: () => setAttempt((value) => value + 1) };
}

/** Historical children outside the parent's loaded transcript read only their own tail. */
export function useChildTranscript(sessionId: string | null, machineId: string | null) {
  const [result, setResult] = useState<{ id: string; model?: StreamModel; error?: string } | null>(
    null,
  );
  useEffect(() => {
    if (!sessionId) return;
    const read = readHistory(
      (query, handlers) => openHistoryStream(sessionId, query, handlers, machineId),
      { kind: "tail", limit: TAIL_UNITS, budget: FIRST_PAINT_BYTES },
      {
        onWindow(window) {
          const model = createStreamModel();
          if (window.page) seedHistoryWindow(model, window.page, sessionId);
          pushMessages(model, window.messages, Date.now(), window.serverNowMs);
          setResult({ id: sessionId, model });
        },
        onError(message) {
          setResult({ id: sessionId, error: message });
        },
      },
    );
    return read.close;
  }, [sessionId, machineId]);
  return result?.id === sessionId ? result : null;
}
