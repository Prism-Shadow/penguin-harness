/**
 * One run's session, read in place: the same transcript the chat page shows, without
 * leaving the activity. Approvals still work — they are part of the stream.
 */
import { MessageStream } from "../chat/message-stream";
import { toneInk } from "../../lib/tone";
import { useSessionTranscript } from "./use-session-transcript";

export function RunTranscript({ sessionId, running }: { sessionId: string; running: boolean }) {
  const { stream, ctx, items, older, error } = useSessionTranscript(
    sessionId,
    running ? "running" : "idle",
  );
  // A fixed height, not a max: MessageStream fills its parent and scrolls itself, and its
  // follow, jump-to-latest and load-older all read that inner scroller. A wrapper that
  // scrolled instead would leave them reading a scroller that never moves.
  return (
    <div className="flex h-[28rem] flex-col border-t border-gray-200 dark:border-gray-800">
      <div className="min-h-0 flex-1">
        <MessageStream items={items} version={stream.version} ctx={ctx} older={older} />
      </div>
      {(error ?? stream.error) && (
        <p role="alert" className={`px-4 py-2 text-xs ${toneInk.danger}`}>
          {error ?? stream.error}
        </p>
      )}
    </div>
  );
}
