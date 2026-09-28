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
  return (
    <div className="max-h-[28rem] min-h-40 overflow-y-auto border-t border-gray-200 dark:border-gray-800">
      <MessageStream
        items={items}
        version={stream.version}
        ctx={ctx}
        older={older}
        onAddExcerpt={() => {}}
      />
      {(error ?? stream.error) && (
        <p role="alert" className={`px-4 py-2 text-xs ${toneInk.danger}`}>
          {error ?? stream.error}
        </p>
      )}
    </div>
  );
}
