import { useMemo, useRef } from "react";
import type { StreamModel } from "../../../lib/omni/stream-model";
import { aggregateMemoryChanges, sameMemoryChanges } from "../../../lib/omni/memory-changes";
import { useOutlineRailFit } from "../conversation-outline";
import { buildInputHistory } from "../input-history";
import { buildOutline } from "../outline-model";
import { useMemoryListing } from "../use-memory-listing";
import { deletedChangeKeys } from "../memory-nav";
import { panelDock } from "../../dock";
import { machineForSession } from "../../../lib/session-machines";
import { useSessionDraft } from "../use-session-draft";
import { useSessionStream } from "../use-session-stream";
import type { useMainChatRouting } from "./main-chat-routing";

/** Exact consecutive main ChatPage statements 61..74; called once, in original order. */
export function useMainChatTranscript(scope: ReturnType<typeof useMainChatRouting>) {
  const { projectId, setTitle, routeSessionId, selected } = scope;

  // No handler for the sub-session registration the parent's channel announces: a subagent
  // Session is in no list (its parent's Agent panel opens it), so nothing here has to refresh.
  const stream = useSessionStream(
    selected?.sessionId ?? null,
    selected?.status ?? "idle",
    setTitle,
  );

  // Chat input area draft: caches text, both staged switch chips (`/agent` target, `/model`
  // target) and the selected skills keyed by sessionId; restored after navigating away and back
  // or a refresh, discarded on successful send.
  const {
    initial: sessionDraft,
    onTextChange: onDraftTextChange,
    onHandoffTargetChange: onDraftHandoffChange,
    onPendingModelChange: onDraftPendingModelChange,
    onSkillsChange: onDraftSkillsChange,
    discard: discardSessionDraft,
  } = useSessionDraft(selected?.sessionId ?? null);

  // The rendered transcript: backfilled older windows (frozen items, negative ids) ahead
  // of the live tail model's items. Keyed on the prefix's identity as well as the stream
  // version: the controller prepends synchronously and its repaint signal is throttled, so
  // a render forced by anything else in between must not pair the NEW prepend count (read
  // live below) with the OLD item list — the stream would anchor against a layout that has
  // not changed yet and leave the commit that does change it unanchored.
  const allItems = useMemo(
    () =>
      stream.prefixItems.length > 0
        ? [...stream.prefixItems, ...stream.model.items]
        : stream.model.items,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, stream.prefixItems, routeSessionId],
  );
  // Derivations over the stream items (the model mutates in place, so `version` — its own
  // repaint signal — keys the memos; the session id covers a switch racing a same-valued
  // version): the composer's ↑/↓ recall list and the left outline's entries. Both read the
  // LOADED transcript (prefix included), so backfilling extends recall and the index alike.
  const inputHistory = useMemo(
    () => buildInputHistory(allItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, routeSessionId],
  );
  const outline = useMemo(
    () => buildOutline(allItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, routeSessionId],
  );
  // The subagents panel's model view: the live model, with backfilled windows' items and
  // nested subagent models merged in — a chip clicked on a backfilled turn must still
  // resolve its historical Task slice and child conversation. Scalar fields snapshot per
  // version, which is exactly as fresh as everything else the panel renders.
  const panelModel = useMemo<StreamModel>(
    () =>
      stream.prefixItems.length > 0 || stream.prefixSubagents.size > 0
        ? {
            ...stream.model,
            items: [...allItems],
            subagents: new Map([...stream.prefixSubagents, ...stream.model.subagents]),
          }
        : stream.model,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, routeSessionId],
  );
  // This conversation's memory changes, aggregated across every visible Task for the Memory
  // panel and the card (version keys the memo like panelModel). Backfilled windows are read
  // here too, but each builds its own model, and a model derives rows only once a session_meta
  // has told it where the Memory root is — so a window that starts mid-shard contributes none
  // (see collectTaskMemoryChanges).
  const rawMemoryChanges = useMemo(
    () =>
      aggregateMemoryChanges(
        allItems.flatMap((it) =>
          it.kind === "task_stats" && it.memoryChanges !== undefined ? [it.memoryChanges] : [],
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, routeSessionId],
  );
  // Identity-stable view of the rows: the memo above re-derives on EVERY streamed message
  // (version bumps per tick), but downstream effects — the listing fetch, the detail
  // refetch — and memos key on the array's identity. Keeping the previous reference while
  // the content is unchanged is what stops the Memory panel flashing during a streaming
  // reply; only a settled Task that actually changed memory swaps it.
  const memoryChangesRef = useRef(rawMemoryChanges);
  if (!sameMemoryChanges(memoryChangesRef.current, rawMemoryChanges)) {
    memoryChangesRef.current = rawMemoryChanges;
  }
  const sessionMemoryChanges = memoryChangesRef.current;
  // The Agent's memory listing, fetched once the Memory tab exists (its body is mounted
  // even behind another tab) or this conversation has changes to mark; shared by the
  // Memory panel and the card's deleted-row marking. Read from the machine the conversation
  // is on: its Agent is that machine's, and so is its memory.
  const memoryListing = useMemoryListing(
    projectId,
    selected?.agentId ?? null,
    selected === null ? null : machineForSession(selected.sessionId),
    panelDock("memory") !== null || sessionMemoryChanges.length > 0,
    sessionMemoryChanges,
  );
  // Changed files the loaded listing no longer carries: the card drops those rows
  // (undefined while the listing hasn't loaded — "unknown" must not read as "deleted").
  const deletedMemoryKeys = useMemo(
    () => deletedChangeKeys(memoryListing.scopes, sessionMemoryChanges) ?? undefined,
    [memoryListing.scopes, sessionMemoryChanges],
  );
  // The message stream's scroll container, exposed by MessageStream for the outline's
  // jump/scrollspy (anchors are queried inside it, never document-wide).
  const streamScrollRef = useRef<HTMLDivElement | null>(null);
  // Which outline shape fits: the gutter tick rail, or (exactly when it can't show —
  // phones without hover, and any window whose gutter a docked panel ate) the toolbar's
  // dropdown index button.
  const railFit = useOutlineRailFit(streamScrollRef, stream.version);
  return {
    ...scope,
    stream,
    sessionDraft,
    onDraftTextChange,
    onDraftHandoffChange,
    onDraftPendingModelChange,
    onDraftSkillsChange,
    discardSessionDraft,
    allItems,
    inputHistory,
    outline,
    panelModel,
    rawMemoryChanges,
    memoryChangesRef,
    sessionMemoryChanges,
    memoryListing,
    deletedMemoryKeys,
    streamScrollRef,
    railFit,
  };
}
