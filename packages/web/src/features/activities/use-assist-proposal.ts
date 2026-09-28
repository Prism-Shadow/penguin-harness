/**
 * The proposal of the activity's current conversation, read by the page so that every
 * surface that shows it — the conversation's card, the script editor's diff and heading
 * marks — shows the same one, whether or not the conversation panel is open.
 *
 * It is read when the conversation changes and whenever `reload` is called, which the
 * conversation panel does each time a reply ends: each reply may write a new proposal, and
 * nothing else says it did.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import type { AssistProposal } from "./proposal";

export interface ProposalRead {
  /** The run whose proposal this is. */
  runId: string;
  proposal: AssistProposal | null;
  error: string | null;
}

export function useAssistProposal(endpoint: string, runId: string | null) {
  const [read, setRead] = useState<ProposalRead | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    void apiFetch<{ proposal: AssistProposal | null; error: string | null }>(
      `${endpoint}/runs/${encodeURIComponent(runId)}/proposal`,
    )
      .then((value) => {
        if (!cancelled) setRead({ runId, proposal: value.proposal, error: value.error });
      })
      .catch(() => {
        /* Reading a proposal is a courtesy; the conversation stands without it. */
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, runId, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  // A read for another conversation is not this one's.
  return { read: read && read.runId === runId ? read : null, reload };
}
