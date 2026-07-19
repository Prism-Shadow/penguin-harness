/**
 * Subagent card: nested inside a run_subagent card (or as a
 * standalone card), renders the subsession's full streaming process by following the origin
 * chain — expanded by default while running, collapsed once finished; nesting inside the card
 * uses the same rendering recursively.
 */
import { useEffect, useRef, useState } from "react";
import { S } from "../../lib/strings";
import type { StreamModel } from "../../lib/omni/stream-model";
import { Chevron } from "../../components/ui/chevron";
import { MessageItems } from "./message-stream";
import type { StreamRenderContext } from "./message-stream";

export function SubagentCard({
  sessionId,
  model,
  running,
  ctx,
}: {
  sessionId: string;
  model: StreamModel;
  running: boolean;
  ctx: StreamRenderContext;
}) {
  const [open, setOpen] = useState(running);
  const userToggled = useRef(false);
  const wasRunning = useRef(running);

  // Append this card's subsession id to the nesting level: tool cards within the card match
  // pending approvals by the full origin chain; the running state inside the subsession follows
  // this card's own running prop, not the parent session's taskRunning.
  const nestedCtx: StreamRenderContext = {
    ...ctx,
    ...(sessionId ? { origin: [...ctx.origin, sessionId] } : {}),
    taskRunning: running,
  };

  useEffect(() => {
    // Auto-collapse once finished (respects the user's choice if they manually toggled it).
    if (wasRunning.current && !running && !userToggled.current) setOpen(false);
    wasRunning.current = running;
  }, [running]);

  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/40">
      <button
        type="button"
        onClick={() => {
          userToggled.current = true;
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-2 rounded-t-md px-3 py-1.5 text-left text-xs text-gray-500 transition-colors duration-200 hover:bg-gray-100/70 dark:text-gray-400 dark:hover:bg-gray-800/50"
      >
        <Chevron open={open} />
        <span className="font-semibold text-gray-700 dark:text-gray-300">{S.chat.subagent}</span>
        {sessionId && <span className="truncate font-mono text-gray-400">{sessionId}</span>}
        {running && (
          <span className="ml-auto flex items-center gap-1 text-gray-500 dark:text-gray-400">
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-gray-400 border-t-transparent" />
            {S.chat.subagentRunning}
          </span>
        )}
      </button>
      {open && (
        <div className="anim-fade border-t border-dashed border-gray-200 px-3 py-1 dark:border-gray-800">
          <MessageItems items={model.items} ctx={nestedCtx} />
        </div>
      )}
    </div>
  );
}
