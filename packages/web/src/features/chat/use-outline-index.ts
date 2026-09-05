/**
 * The server's outline index for the open session (see OutlineIndexEntry): every turn,
 * whatever part of the transcript is loaded. Fetched when the session changes and again
 * each time a Task ends — a new turn is only in the index once its shard has been
 * scanned, and until then the loaded entries cover it (see mergeOutline). A server
 * without the endpoint, or a failed fetch, leaves the previous answer standing (empty on
 * a fresh session): the rail then lists what is loaded, as it always could.
 */
import { useEffect, useState } from "react";
import type { OutlineIndexEntry, SessionStatus } from "@prismshadow/penguin-server/api";
import { getOutline } from "../../api/endpoints";

export function useOutlineIndex(
  sessionId: string | null,
  taskState: SessionStatus,
): OutlineIndexEntry[] {
  const [index, setIndex] = useState<{ sessionId: string | null; entries: OutlineIndexEntry[] }>({
    sessionId: null,
    entries: [],
  });
  const idle = taskState === "idle";
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
  }, [sessionId, idle]);
  // A previous session's index never describes this one.
  return index.sessionId === sessionId ? index.entries : [];
}
