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
 * The moment the text is whole the host also carries `data-settling`, for as long as a theme's
 * transition of `--_stream-veil` runs on it — Frost's veil easing away — and drops it when that
 * transition ends, or at once when nothing transitions (the other themes, reduced motion). The
 * veil can hold its mask exactly that long, so the newest lines settle into full ink instead of
 * snapping, and a settled reply carries no mask. A host that mounts finished never settles.
 *
 * Two formats. `markdown` renders the revealed prefix through `Md` in its streaming mode (no
 * highlighting, no KaTeX) until done, so blocks grow as they are typed. `plain` renders it
 * verbatim in a `<pre>`, the text node followed by the caret, so Console's cursor sits right after
 * the last character and Frost's veil anchors to the host's foot. A class that would fight a live
 * tail — a height cap, whose inner scroll would carry the veil off with its first screen — goes in
 * `settledClassName`, which the host takes only once done.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
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

/** The registered property a theme's veil transitions; see theme.css. */
const VEIL_PROPERTY = "--_stream-veil";

/** The veil transitions running on the host, if any (none where a browser has no Web Animations). */
function veilTransitions(host: HTMLElement): Animation[] {
  if (typeof host.getAnimations !== "function") return [];
  return host
    .getAnimations()
    .filter(
      (animation) =>
        "transitionProperty" in animation &&
        (animation as Animation & { transitionProperty: string }).transitionProperty ===
          VEIL_PROPERTY,
    );
}

/**
 * Whether the host is easing its veil away: true from the moment the text turns whole until the
 * veil's transition ends, false otherwise.
 */
function useSettling(live: boolean, host: RefObject<HTMLElement | null>): boolean {
  const [settling, setSettling] = useState(false);
  const [wasLive, setWasLive] = useState(live);
  // Adjusted during render, so the commit that ends the stream already carries the attribute and
  // the veil never drops for a frame between the two.
  if (wasLive !== live) {
    setWasLive(live);
    setSettling(!live);
  }
  useEffect(() => {
    if (!settling) return;
    const element = host.current;
    const running = element === null ? [] : veilTransitions(element);
    if (running.length === 0) {
      setSettling(false);
      return;
    }
    let current = true;
    const end = () => {
      if (current) setSettling(false);
    };
    // A transition that is cancelled (the host left the page, motion was reduced) ends it too.
    void Promise.all(running.map((animation) => animation.finished)).then(end, end);
    return () => {
      current = false;
    };
  }, [settling, host]);
  return settling;
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
  const host = useRef<HTMLElement | null>(null);
  const setHost = useCallback((element: HTMLElement | null) => {
    host.current = element;
  }, []);
  const settling = useSettling(live, host);
  const look = [className, live ? "" : settledClassName].filter((part) => part !== "").join(" ");
  const state = live ? "streaming" : "done";
  const settle = settling ? { "data-settling": "" } : {};
  if (format === "plain") {
    return (
      <pre ref={setHost} className={`ui-stream ${look}`.trimEnd()} data-state={state} {...settle}>
        {revealed}
        {live && <StreamingCaret />}
        {!live && children}
      </pre>
    );
  }
  return (
    <div ref={setHost} className={`ui-stream ${look}`.trimEnd()} data-state={state} {...settle}>
      {/* Re-renders the revealed text directly while live; memoized, so a settled body skips the re-parse, and code blocks highlight once on settle (see prose.tsx). */}
      <Md text={revealed} streaming={live} />
      {live && <StreamingCaret />}
      {!live && children}
    </div>
  );
}
