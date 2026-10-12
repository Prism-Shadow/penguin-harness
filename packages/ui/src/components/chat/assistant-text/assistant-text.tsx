/**
 * An assistant reply's body in the transcript: the reply's Markdown streaming through
 * `StreamText` — the one `ui-stream` host, so a reply reveals exactly as a thinking row, a
 * compaction summary and a tool's output do — on the reply's reading type, and whatever the
 * caller adds once the reply is whole (a stop reason, a nested reply's files card). The Web App
 * renders every reply through it, and the gallery renders it on its own, so a theme's reveal is
 * seen exactly as the transcript shows it.
 */
import type { ReactNode } from "react";
import { StreamText } from "../stream-text/stream-text";

export interface AssistantTextProps {
  /** The reply's text received so far. */
  text: string;
  /** The stream is still open. */
  streaming: boolean;
  /** Rendered after the reply once it is fully revealed. */
  children?: ReactNode;
}

export function AssistantText({ text, streaming, children }: AssistantTextProps) {
  return (
    <StreamText
      text={text}
      streaming={streaming}
      className="md-body anim-msg my-3 font-sans text-base leading-relaxed text-fg"
    >
      {children}
    </StreamText>
  );
}
