/**
 * Text arriving in the transcript, one effect wherever it streams: an assistant reply's body
 * (`AssistantText`), a thinking row's text, a compaction's summary and a tool call's output. It is
 * the `ui-stream` host, so a theme's reveal is the same on all four: Primer shows the text as it
 * lands under a pulsing bar, Frost lets words in under a soft veil over the trailing lines (no
 * caret), Console types it out behind a blinking block.
 *
 * `data-state` is `streaming` while the text is still coming in — the stream is open, or the
 * paced reveal (use-stream-reveal.ts, on the theme's `--ui-stream-reveal` / `--ui-stream-rate`)
 * has not caught up with it — and `done` after; until then the caret (`StreamingCaret`) is the
 * host's last child, the stream's edge, and `children` (a stop reason, a files card) wait, so
 * nothing lands under text that is still coming in.
 *
 * Two formats. `markdown` renders the revealed prefix through `Md` in its streaming mode (no
 * highlighting, no KaTeX) until done, so blocks grow as they are typed. `plain` renders it
 * verbatim in a `<pre>`, the text node followed by the caret, so Console's cursor sits right after
 * the last character and Frost's veil anchors to the host's foot. A class that would fight a live
 * tail — a height cap, whose inner scroll would carry the veil off with its first screen — goes in
 * `settledClassName`, which the host takes only once done.
 */
import type { ReactNode } from "react";
import { Md } from "../../content/prose/prose";
import { StreamingCaret } from "../assistant-text/streaming-caret";
import { useStreamReveal } from "../assistant-text/use-stream-reveal";

export interface StreamTextProps {
  /** The text received so far. */
  text: string;
  /** The stream is still open. */
  streaming: boolean;
  /** `markdown` (default) renders through Md, blocks growing as typed; `plain` renders the text verbatim in a `<pre>`. */
  format?: "markdown" | "plain";
  /** The host's own look: its type, padding and ink. */
  className?: string;
  /** Classes the host takes once the text is whole (a height cap with its scroll). */
  settledClassName?: string;
  /** Rendered after the text once it is fully revealed (a stop reason, a files card). */
  children?: ReactNode;
}

export function StreamText({
  text,
  streaming,
  format = "markdown",
  className = "",
  settledClassName = "",
  children,
}: StreamTextProps) {
  const revealed = useStreamReveal(text, streaming);
  const live = streaming || revealed.length < text.length;
  const look = [className, live ? "" : settledClassName].filter((part) => part !== "").join(" ");
  const state = live ? "streaming" : "done";
  if (format === "plain") {
    return (
      <pre className={`ui-stream ${look}`.trimEnd()} data-state={state}>
        {revealed}
        {live && <StreamingCaret />}
        {!live && children}
      </pre>
    );
  }
  return (
    <div className={`ui-stream ${look}`.trimEnd()} data-state={state}>
      {/* Re-renders the revealed text directly while live; memoized, so a settled body skips the re-parse, and code blocks highlight once on settle (see prose.tsx). */}
      <Md text={revealed} streaming={live} />
      {live && <StreamingCaret />}
      {!live && children}
    </div>
  );
}
