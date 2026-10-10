/**
 * 流式输出: text as it streams in, under the current theme's reveal, on two of the surfaces that
 * stream it. A scripted Markdown answer (the streaming demo Session's,
 * src/app/mock/transcripts.ts) arrives in bursty chunks (src/app/mock/stream-script.ts) and goes
 * to the package's AssistantText — the body the app renders every reply through — and, the same
 * chunks at the same moments, to a `StreamText` in its plain format wearing a tool call's output
 * block, as a command's output streams. Both are the one `ui-stream` host, which paces the reveal
 * by the theme's `--ui-stream-reveal` and `--ui-stream-rate`: Primer shows each chunk at once,
 * Frost fades it in by word under a glowing veil, Console types it out behind a block caret. It
 * plays once on load and again on Replay, always on the same seed, so every theme replays the
 * same chunks at the same gaps and the reveals compare. The caption under both names the mode
 * read from this frame root.
 *
 * Each box is its finished text's height from the first chunk on (an invisible copy of it
 * shares the live text's grid cell), so the frame does not grow line by line as text arrives.
 * The output's copy is uncapped: the live output takes the output block's height cap only once
 * it is done, as it does in the transcript.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AssistantText,
  DISCLOSURE_OUTPUT_CAP_CLASS,
  DISCLOSURE_OUTPUT_CLASS,
  STREAM_REVEALS,
  StreamText,
  usePrefersReducedMotion,
} from "@prismshadow/penguin-ui";
import type { StreamReveal } from "@prismshadow/penguin-ui";
import { streamScript } from "../../app/mock/stream-script";
import { streamingAnswer } from "../../app/mock/transcripts";
import { BoardGroup, ReplayButton } from "../../foundations/shared";
import { useGallery } from "../../state";

/** The board's one seed: the same chunks at the same gaps under every theme. */
export const BOARD_SEED = 5;

const isStreamReveal = (value: string): value is StreamReveal =>
  (STREAM_REVEALS as readonly string[]).includes(value);

interface StreamTokens {
  /** The `--ui-stream-reveal` keyword as computed, trimmed; empty when unset. */
  reveal: string;
  /** `--ui-stream-rate` in characters a second; 0 when unset or not a number. */
  rate: number;
}

function readStreamTokens(): StreamTokens {
  const computed = getComputedStyle(document.documentElement);
  const reveal = computed.getPropertyValue("--ui-stream-reveal").trim();
  const rate = Number.parseFloat(computed.getPropertyValue("--ui-stream-rate"));
  return { reveal, rate: Number.isFinite(rate) ? rate : 0 };
}

/** The current theme's stream tokens, read again when the root's theme attributes change. */
function useStreamTokens(): StreamTokens | null {
  const [tokens, setTokens] = useState<StreamTokens | null>(null);
  useEffect(() => {
    const update = () => setTokens(readStreamTokens());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-motion", "style"],
    });
    return () => observer.disconnect();
  }, []);
  return tokens;
}

/**
 * Plays `text` as the script cuts it: the text received so far, and whether the stream is still
 * open. `run` restarts it from nothing.
 */
function useScriptedStream(text: string, run: number): { text: string; streaming: boolean } {
  const chunks = useMemo(() => streamScript(text, BOARD_SEED), [text]);
  // Where each chunk ends in the text: the chunks join back into it exactly.
  const ends = useMemo(() => {
    let end = 0;
    return chunks.map((chunk) => {
      end += chunk.text.length;
      return end;
    });
  }, [chunks]);
  const [received, setReceived] = useState(0);

  useEffect(() => {
    setReceived(0);
    let count = 0;
    let timer = 0;
    const step = () => {
      count += 1;
      setReceived(count);
      const next = chunks[count];
      if (next) timer = window.setTimeout(step, next.gap);
    };
    const first = chunks[0];
    if (first) timer = window.setTimeout(step, first.gap);
    return () => window.clearTimeout(timer);
  }, [chunks, run]);

  return {
    text: received === 0 ? "" : text.slice(0, ends[received - 1]),
    streaming: received < chunks.length,
  };
}

/** The current theme's mode, by name: the keyword, what it does, and its pace when it has one. */
function StreamCaption({ tokens }: { tokens: StreamTokens }) {
  const { S } = useGallery();
  const t = S.library.streaming;
  const { reveal, rate } = tokens;
  const known = isStreamReveal(reveal);
  // Either signal the theme honours: the operating system's preference or the root's switch
  // (a change to the switch reaches here through the token reader's observer).
  const reduced =
    usePrefersReducedMotion() || document.documentElement.dataset.motion === "reduced";
  return (
    <p className="lib-caption">
      <code className="gf-mono">--ui-stream-reveal: {reveal || S.section.unset}</code>
      {" · "}
      {known ? t.modes[reveal] : t.unset}
      {known && reveal !== "instant" && rate > 0 && ` · ${t.rate(rate)}`}
      {reduced && ` · ${t.reduced}`}
    </p>
  );
}

export function StreamingBoard() {
  const { S, state } = useGallery();
  const t = S.library.streaming;
  const answer = streamingAnswer(state.lang);
  const [run, setRun] = useState(0);
  const stream = useScriptedStream(answer, run);
  const tokens = useStreamTokens();

  return (
    <div className="gf-board">
      <BoardGroup
        title={t.reply}
        aside={stream.streaming ? t.receiving : t.received}
        action={<ReplayButton onClick={() => setRun((n) => n + 1)} />}
      >
        <div className="lib-box lib-stream">
          <div className="lib-stream-sizer" aria-hidden inert>
            <AssistantText text={answer} streaming={false} />
          </div>
          <div className="lib-stream-live">
            {/* A replay mounts a fresh reply, so no pacing state carries over. */}
            <AssistantText key={run} text={stream.text} streaming={stream.streaming} />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.output} aside={stream.streaming ? t.receiving : t.received}>
        <div className="lib-stream lib-stream-output">
          <div className="lib-stream-sizer" aria-hidden inert>
            <StreamText
              format="plain"
              className={DISCLOSURE_OUTPUT_CLASS}
              text={answer}
              streaming={false}
            />
          </div>
          <div className="lib-stream-live">
            <StreamText
              key={run}
              format="plain"
              className={DISCLOSURE_OUTPUT_CLASS}
              settledClassName={DISCLOSURE_OUTPUT_CAP_CLASS}
              text={stream.text}
              streaming={stream.streaming}
            />
          </div>
        </div>
        {tokens === null ? (
          <p className="lib-caption">{S.intro.resolving}</p>
        ) : (
          <StreamCaption tokens={tokens} />
        )}
      </BoardGroup>
    </div>
  );
}
