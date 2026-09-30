/**
 * An assistant reply's body in the transcript: the Markdown, the streaming caret, and whatever
 * the item adds once the reply is whole. MessageItem renders every reply through it, and the
 * gallery renders it on its own, so a theme's reveal is seen exactly as the transcript shows it.
 *
 * The body is the `ui-stream` host: `data-state` is `streaming` while the reply is still coming
 * in — the stream is open, or the paced reveal (use-stream-reveal.ts) has not caught up with it
 * — and `done` after, and the caret is its `caret` slot. Primer gives the hook nothing and
 * reveals instantly, so the body renders as it always has; Frost fades the new text in under a
 * soft veil at the body's foot, and Console types it out behind a block caret.
 *
 * Markdown renders the revealed prefix, so code blocks and lists grow as they are typed. It
 * stays in its streaming mode (no highlighting, no KaTeX; see md.tsx) until the reveal is done,
 * and `children` (the stop reason, a nested reply's files card) wait for the same moment, so
 * nothing lands under text that is still coming in.
 */
import type { ReactNode } from "react";
import { Md } from "@prismshadow/penguin-ui";
import { StreamingCaret } from "./streaming-caret";
import { useStreamReveal } from "./use-stream-reveal";

export function AssistantReplyBody({
  text,
  streaming,
  children,
}: {
  /** The reply's text received so far. */
  text: string;
  /** The stream is still open. */
  streaming: boolean;
  /** Rendered after the reply once it is fully revealed. */
  children?: ReactNode;
}) {
  const revealed = useStreamReveal(text, streaming);
  const live = streaming || revealed.length < text.length;
  return (
    <div
      className="ui-stream md-body anim-msg my-3 font-sans text-base leading-relaxed text-gray-800 dark:text-gray-100"
      data-state={live ? "streaming" : "done"}
    >
      {/* Re-renders the revealed text directly while live; memoized, so a settled reply skips the re-parse, and code blocks highlight once on settle (see md.tsx). */}
      <Md text={revealed} streaming={live} />
      {live && <StreamingCaret />}
      {!live && children}
    </div>
  );
}
