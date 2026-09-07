/**
 * The server's outline index for the open session (see OutlineIndexEntry): every turn,
 * whatever part of the transcript is loaded. Fetched when the session changes and again
 * each time a Task ENDS — a new turn is only in the index once its shard has been
 * scanned, and until then the loaded entries cover it (see mergeOutline); the start of a
 * Task changes nothing the index could know yet. A server without the endpoint, or a
 * failed fetch, leaves the previous answer standing (empty on a fresh session): the rail
 * then lists what is loaded, as it always could.
 */
import { useEffect, useRef, useState } from "react";
import type { OutlineIndexEntry, SessionStatus } from "@prismshadow/penguin-server/api";
import { getOutline } from "../../api/endpoints";

/** One shared empty answer: a fresh `[]` per render would defeat every memo keyed on the index. */
const NO_ENTRIES: OutlineIndexEntry[] = [];

export function useOutlineIndex(
  sessionId: string | null,
  taskState: SessionStatus,
): OutlineIndexEntry[] {
  const [index, setIndex] = useState<{ sessionId: string | null; entries: OutlineIndexEntry[] }>({
    sessionId: null,
    entries: NO_ENTRIES,
  });
  const [fetches, setFetches] = useState(0);
  const lastStateRef = useRef<SessionStatus>(taskState);
  // Only the running → idle edge refetches; the session change is its own trigger below.
  useEffect(() => {
    const was = lastStateRef.current;
    lastStateRef.current = taskState;
    if (was !== "idle" && taskState === "idle") setFetches((n) => n + 1);
  }, [taskState]);
  useEffect(() => {
    if (sessionId === null) return;
    let stale = false;
    getOutline(sessionId)
      .then((res) => {
        if (!stale) setIndex({ sessionId, entries: res.entries });
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [sessionId, fetches]);
  // A previous session's index never describes this one.
  return index.sessionId === sessionId ? index.entries : NO_ENTRIES;
}
