/**
 * The open pull request the conversation's Workspace is on, for the header chip.
 *
 * Asked of the server, which runs `gh` in that Workspace and caches the answer briefly
 * (server/services/pull-request-service.ts). Nothing here retries or reports: a Workspace
 * with no PR, a checkout with no `gh`, and a failed call are one state — no chip.
 *
 * Re-asked when the conversation changes and when the window regains focus, which is what
 * makes the chip follow a branch the user switched in a terminal without a reload. Both are
 * cheap: the server answers a repeated question from its own short-lived cache.
 */
import { useEffect, useState } from "react";
import * as api from "../../api/endpoints";
import type { WorkspacePullRequestResponse } from "@prismshadow/penguin-server/api";

export type WorkspacePr = WorkspacePullRequestResponse["pullRequest"];

export function useWorkspacePullRequest(sessionId: string | null): WorkspacePr {
  const [pr, setPr] = useState<WorkspacePr>(null);

  useEffect(() => {
    if (sessionId === null) {
      setPr(null);
      return;
    }
    let cancelled = false;
    const load = (): void => {
      void api
        .getWorkspacePullRequest(sessionId)
        .then((res) => {
          if (!cancelled) setPr(res.pullRequest);
        })
        .catch(() => {
          // The chip is decoration; a failure to fetch it is not the reader's problem. Keep
          // whatever is on screen rather than blanking a link that may still be good.
        });
    };
    // Cleared first: the previous conversation's PR must not sit in the header of this one
    // for as long as the fetch takes.
    setPr(null);
    load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [sessionId]);

  return pr;
}
