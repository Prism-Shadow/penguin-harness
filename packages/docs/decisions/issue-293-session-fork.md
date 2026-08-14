# Issue #293 — Session fork behavior and verification checklist

This document fixes the product contract before implementation. It is also the review checklist
for the draft PR: an item is checked only after an automated test or a captured browser result
proves it.

## Expected behavior

- [x] A **Fork** action appears beside the existing copy action under every completed root-session
      assistant turn.
- [x] Streaming replies, user messages, nested subagent replies, and turns without a completed
      assistant reply do not expose the action.
- [x] Clicking **Fork** creates a new Session for the same Project and Agent.
- [x] The fork keeps the source Session's model reference, Workspace, approval mode, and title.
- [x] The forked transcript contains the source transcript through the selected completed turn,
      including its tool calls/results, and excludes every later turn.
- [ ] The source and fork can receive different follow-up Tasks without changing one another's
      Trace.
- [x] A successful fork is added to the Session list and opens immediately.
- [ ] While the request is in flight, the action cannot be triggered twice; a failure leaves the
      user in the source Session and shows the normal localized API error toast.

## Boundary behavior

### Trace cut and runtime state

- [x] The client sends a stable Trace position, not a display index, timestamp, or message text.
- [x] The server accepts only a position that identifies the final root assistant text record of a
      completed Task; a forged/stale/malformed position is rejected.
- [x] Forking is rejected while the source is running or compacting, even if another client calls
      the API directly.
- [ ] The cut never splits a request, tool-call/result pair, steering group, or compaction span.
- [x] A fork before a later automatic compaction excludes that compaction; a fork after compaction
      preserves the earlier display history while resuming from the selected shard's valid context.
- [x] Multi-shard Sessions clone every earlier shard and only the selected prefix of the final
      cloned shard, with the new Session id in every `session_meta` record.
- [ ] The fork is resumable after a server restart, not only through an in-memory runtime created by
      the fork request.

### Files, images, and paths

- [x] The source scratchpad is snapshotted into the fork's own scratchpad directory.
- [x] System-generated `[attached image: ...]` and `[attached file: ...]` paths that point at the
      source scratchpad are rewritten to the fork scratchpad in cloned user messages.
- [x] HTTP(S) image URLs and marker-shaped user text that does not point at the source scratchpad
      are left unchanged.
- [x] Vision-model images stored inline as data URLs remain byte-identical in the cloned Trace.
- [x] Forked attachment/image endpoints resolve through the new Session id and return the copied
      bytes.
- [x] Deleting the source Session does not remove or break the fork's copied files or images.
- [x] Deleting the fork removes only its own Trace and scratchpad; the source remains intact.
- [x] A missing source scratchpad is treated as an empty snapshot.
- [ ] A real copy/write failure rolls back the partially created fork.

### Access, lifecycle, and presentation

- [x] The existing Session access check protects the endpoint; a caller cannot fork a Session they
      cannot read.
- [x] Scheduled/subagent Sessions do not accidentally become scheduled/subagent runs; the fork is a
      normal user-created Session.
- [x] The fork is not archived even when the source is archived.
- [x] Source deletion, fork creation, and concurrent fork requests cannot overwrite an existing
      Trace or Session id.
- [x] Chinese and English labels/tooltips/error messages are present, keyboard focus works, and the
      action remains available on touch layouts where hover does not exist.

## Implementation outline

1. Attach an optional immutable Trace coordinate (`fileIndex`, `ordinal`) to root messages returned
   by the history API. Carry the last assistant record's coordinate into the turn footer.
2. Add `POST /api/sessions/:sessionId/fork` with that coordinate. Resolve the source row, require an
   idle Session, scan raw Trace records to validate that the coordinate is the final assistant reply
   of a completed Task, and choose the safe cut after its closing request records but before later
   compaction or user input.
3. Allocate a collision-resistant Session id, clone Trace shards through the cut, rewrite each
   shard's source `session_meta` with the new id and paths, clear scheduled/subagent provenance,
   rewrite only recognized source-scratchpad attachment markers, and register the new row/Trace
   with cleanup on failure.
4. Snapshot the source scratchpad under the new id before exposing the Session. Do not create an
   in-memory runtime: the fork follows the ordinary load-and-resume path on its first Task.
5. Add the footer action, pending state, localized copy, Session-list insertion, and navigation.
6. Cover the checklist with focused core/server/web tests plus one browser flow. Store review
   screenshots under `pr-assets/issue-293/` and link them from the Draft PR.

## Review evidence

- Automated checks:
  - `pnpm typecheck`
  - `pnpm test` (all workspace packages)
  - `packages/server/test/session-fork.test.ts` (8 integration scenarios)
  - `packages/web/test/stream-model.test.ts` (history-coordinate propagation and SSE dedup)
- Browser scenario: a deterministic two-turn Session with one image and one file was forked after
  the first reply. The fork opened immediately, excluded the second turn, retained both
  attachments, and still rendered the copied image after the source Session was deleted.
- Screenshots:
  - [`01-source-fork-action.jpg`](../../../pr-assets/issue-293/01-source-fork-action.jpg)
  - [`02-forked-transcript.jpg`](../../../pr-assets/issue-293/02-forked-transcript.jpg)
  - [`03-fork-survives-source-delete.jpg`](../../../pr-assets/issue-293/03-fork-survives-source-delete.jpg)
- Known limitations / remaining verification:
  - Forking intentionally duplicates the retained scratchpad and therefore its disk usage.
  - The UI does not display parent/child lineage; both Sessions are ordinary independent entries.
  - A real provider-backed follow-up after a process restart and injected filesystem write failures
    remain unchecked above; the implementation deliberately creates no fork runtime and cleans up
    Trace/index/scratchpad state on every caught write or database failure.
