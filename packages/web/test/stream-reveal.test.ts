/**
 * The streaming reveal: the theme's stream tokens (lib/stream-style.ts), the pacing
 * (features/chat/stream-reveal.ts) and the reply body that applies them.
 *
 * The pacing is a pure function of an explicit clock, so these tests drive the clock
 * themselves, frame by frame, the way use-stream-reveal.ts does from requestAnimationFrame:
 * typewriter by character, fade by word, the 1.5 s backlog cap, finishing at the rate after the
 * stream ends, and `instant` (Primer, no tokens, reduced motion) showing the text whole. The
 * suite renders no React, so the body's markup is pinned against its source at the bottom.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STREAM_STYLE,
  effectiveReveal,
  nextStreamStyle,
  readStreamStyle,
} from "../src/lib/stream-style";
import type { StreamRevealMode } from "../src/lib/stream-style";
import {
  REVEAL_MAX_LAG_MS,
  receiveText,
  revealCut,
  revealFrameMs,
  startReveal,
  stepReveal,
  visibleLength,
} from "../src/features/chat/stream-reveal";
import type { RevealState } from "../src/features/chat/stream-reveal";

const FRAME = 16;

const reader = (tokens: Record<string, string>) => (name: string) => tokens[name] ?? "";

/** A reply that opened empty at `t = 0` and has just received `text`. */
function opened(text: string, rate: number, at = 0): RevealState {
  return receiveText(startReveal("", 0, { streaming: true, rate }), text, at);
}

/** What shows at `t` after stepping frame by frame from the state's clock. */
function showAt(
  state: RevealState,
  t: number,
  rate: number,
  mode: StreamRevealMode,
  streaming = true,
): { state: RevealState; shown: string } {
  let s = state;
  for (let at = s.at + FRAME; at < t; at += FRAME) s = stepReveal(s, at, rate);
  s = stepReveal(s, t, rate);
  return { state: s, shown: s.text.slice(0, visibleLength(s, mode, streaming, t)) };
}

interface Chunk {
  at: number;
  text: string;
}

/**
 * Plays a stream frame by frame: each chunk is received at its own time, the stream closes at
 * `closeAt`, and every frame records the visible length and the text received so far.
 */
function play(opts: {
  chunks: readonly Chunk[];
  closeAt: number;
  until: number;
  rate: number;
  mode: StreamRevealMode;
}): { t: number; shown: number; received: number }[] {
  let state = startReveal("", 0, { streaming: true, rate: opts.rate });
  let received = "";
  let next = 0;
  const frames: { t: number; shown: number; received: number }[] = [];
  for (let t = FRAME; t <= opts.until; t += FRAME) {
    while (next < opts.chunks.length && opts.chunks[next]!.at <= t) {
      const chunk = opts.chunks[next++]!;
      received += chunk.text;
      state = receiveText(state, received, Math.max(chunk.at, state.at));
    }
    state = stepReveal(state, t, opts.rate);
    const streaming = t < opts.closeAt;
    const shown = visibleLength(state, opts.mode, streaming, t);
    frames.push({ t, shown, received: received.length });
  }
  return frames;
}

describe("readStreamStyle", () => {
  it("reads the two tokens a theme defines", () => {
    expect(
      readStreamStyle(
        reader({ "--ui-stream-reveal": " typewriter", "--ui-stream-rate": " 90" }),
        null,
      ),
    ).toEqual({ reveal: "typewriter", rate: 90, reducedMotion: false });
    expect(
      readStreamStyle(reader({ "--ui-stream-reveal": "fade", "--ui-stream-rate": "220" }), null),
    ).toMatchObject({ reveal: "fade", rate: 220 });
  });

  it("reads a missing, unknown or unusable token as instant with no pace", () => {
    expect(readStreamStyle(reader({}), null)).toEqual(DEFAULT_STREAM_STYLE);
    expect(
      readStreamStyle(reader({ "--ui-stream-reveal": "wiggle", "--ui-stream-rate": "x" }), null),
    ).toEqual(DEFAULT_STREAM_STYLE);
    expect(readStreamStyle(reader({ "--ui-stream-rate": "-5" }), null).rate).toBe(0);
  });

  it("carries the root's reduced-motion switch", () => {
    expect(readStreamStyle(reader({}), "reduced").reducedMotion).toBe(true);
    expect(readStreamStyle(reader({}), "full").reducedMotion).toBe(false);
  });

  it("hands out the same record while nothing it reads changed", () => {
    const first = readStreamStyle(reader({ "--ui-stream-reveal": "fade" }), null);
    const again = readStreamStyle(reader({ "--ui-stream-reveal": "fade" }), null);
    expect(nextStreamStyle(first, again)).toBe(first);
    const changed = readStreamStyle(reader({ "--ui-stream-reveal": "typewriter" }), null);
    expect(nextStreamStyle(first, changed)).toBe(changed);
  });
});

describe("effectiveReveal", () => {
  const typewriter = { reveal: "typewriter", rate: 90, reducedMotion: false } as const;

  it("paces in the theme's mode when it has a rate", () => {
    expect(effectiveReveal(typewriter, false)).toBe("typewriter");
    expect(effectiveReveal({ ...typewriter, reveal: "fade", rate: 220 }, false)).toBe("fade");
  });

  it("is instant with no rate, and under reduced motion by either signal", () => {
    expect(effectiveReveal({ ...typewriter, rate: 0 }, false)).toBe("instant");
    expect(effectiveReveal({ ...typewriter, reducedMotion: true }, false)).toBe("instant");
    expect(effectiveReveal(typewriter, true)).toBe("instant");
    expect(effectiveReveal(DEFAULT_STREAM_STYLE, false)).toBe("instant");
  });
});

describe("the paced reveal", () => {
  it("types character by character at the rate", () => {
    const s = opened("Hello world", 100);
    const early = showAt(s, 50, 100, "typewriter");
    expect(early.shown).toBe("Hello");
    expect(showAt(early.state, 80, 100, "typewriter").shown).toBe("Hello wo");
  });

  it("fades word by word at the same characters-per-second pace", () => {
    const s = opened("Hello world", 100);
    expect(showAt(s, 50, 100, "fade").shown).toBe("");
    const first = showAt(s, 60, 100, "fade");
    expect(first.shown).toBe("Hello ");
    // Caught up at the live edge: the partial last word waits for the next delta…
    const edge = showAt(first.state, 200, 100, "fade");
    expect(edge.shown).toBe("Hello ");
    // …and shows once the stream has ended, or once its arrival is past the deadline.
    expect(visibleLength(edge.state, "fade", false, 200)).toBe(11);
    expect(showAt(edge.state, REVEAL_MAX_LAG_MS, 100, "fade").shown).toBe("Hello world");
  });

  it("treats every CJK character as a word of its own", () => {
    expect(showAt(opened("你好世界", 100), 20, 100, "fade").shown).toBe("你好");
  });

  it("shows the text whole when instant", () => {
    const s = opened("Hello world", 100);
    expect(visibleLength(s, "instant", true, 0)).toBe(11);
    // No rate: nothing to pace with, so the reply starts, and stays, whole.
    const unpaced = startReveal("Hello", 0, { streaming: true, rate: 0 });
    expect(visibleLength(unpaced, "fade", true, 0)).toBe(5);
  });

  it("returns the whole text under reduced motion, whatever the theme asks for", () => {
    const frost = { reveal: "fade", rate: 220, reducedMotion: false } as const;
    const s = opened("Hello world", frost.rate);
    // The operating system's preference, then the root's switch.
    expect(visibleLength(s, effectiveReveal(frost, true), true, 0)).toBe(11);
    const switched = effectiveReveal({ ...frost, reducedMotion: true }, false);
    expect(visibleLength(s, switched, true, 0)).toBe(11);
  });

  it("speeds up smoothly so a burst is on screen within the lag cap", () => {
    const text = "abc ".repeat(750); // 3,000 characters in one burst
    let s = opened(text, 10);
    let last = 0;
    let t = 0;
    let largest = 0;
    while (t < REVEAL_MAX_LAG_MS) {
      t += FRAME;
      s = stepReveal(s, t, 10);
      const shown = visibleLength(s, "typewriter", true, t);
      expect(shown).toBeGreaterThanOrEqual(last);
      largest = Math.max(largest, shown - last);
      last = shown;
      if (t === 752) expect(shown).toBeGreaterThan(1400); // halfway there at halfway through
    }
    expect(last).toBe(3000);
    // At 10 characters a second it would have shown 15; it got there in even frames instead.
    expect(largest).toBeLessThanOrEqual(40);
  });

  it("never trails a fast stream by more than the cap, and eases along without jumps", () => {
    const chunk = "lorem ipsum dolor sit amet ok "; // 30 characters, every 100 ms: 300 a second
    const chunks = Array.from({ length: 50 }, (_, i) => ({ at: i * 100, text: chunk }));
    const frames = play({ chunks, closeAt: 5000, until: 8000, rate: 50, mode: "typewriter" });
    const arrivedBy = (time: number) =>
      time < 0 ? 0 : Math.min(1500, (Math.floor(time / 100) + 1) * chunk.length);
    let previous = 0;
    for (const f of frames) {
      expect(f.shown).toBeGreaterThanOrEqual(arrivedBy(f.t - REVEAL_MAX_LAG_MS));
      expect(f.shown).toBeLessThanOrEqual(f.received);
      expect(f.shown - previous).toBeLessThanOrEqual(12);
      previous = f.shown;
    }
    // Still revealing after the stream closed, and done once the last deadline passed.
    expect(frames.find((f) => f.t === 5008)!.shown).toBeLessThan(1500);
    expect(frames.find((f) => f.t === 6400)!.shown).toBe(1500);
  });

  it("finishes the rest at the rate once the stream ends, without jumping to the end", () => {
    // 100 characters: few enough that the rate, not the lag cap, sets the pace.
    const text = "abcd ".repeat(20);
    const s = opened(text, 100);
    const half = showAt(s, 496, 100, "typewriter", false);
    expect(half.shown.length).toBeGreaterThanOrEqual(45);
    expect(half.shown.length).toBeLessThanOrEqual(55);
    expect(showAt(half.state, 1008, 100, "typewriter", false).shown).toBe(text);
  });

  it("does not count time spent caught up as reveal time", () => {
    const caughtUp = showAt(opened("Hello", 100), 1000, 100, "typewriter").state;
    const s = receiveText(caughtUp, "Hello world", 10_000);
    expect(showAt(s, 10_016, 100, "typewriter").shown).toBe("Hello ");
  });

  it("falls back to the shared prefix when the text is replaced", () => {
    const shown = showAt(opened("Hello world", 100), 2000, 100, "typewriter", false).state;
    const replaced = receiveText(shown, "Hello there!", 2000);
    expect(replaced.cursor).toBe(6);
    expect(showAt(replaced, 2030, 100, "typewriter").shown).toBe("Hello the");
  });

  it("starts a reply that mounts mid-stream near its end, and a settled one whole", () => {
    const text = "a".repeat(1000);
    expect(startReveal(text, 0, { streaming: true, rate: 100 }).cursor).toBe(850);
    expect(startReveal(text, 0, { streaming: false, rate: 100 }).cursor).toBe(1000);
    expect(startReveal("", 0, { streaming: true, rate: 100 }).cursor).toBe(0);
  });

  it("hands React fewer prefixes as the reply grows", () => {
    expect(revealFrameMs(0)).toBe(33);
    expect(revealFrameMs(6000)).toBe(60);
    expect(revealFrameMs(50_000)).toBe(120);
  });
});

describe("revealCut (half-typed Markdown)", () => {
  /** The text shown when the cursor has reached the end of `upTo`, a prefix of `text`. */
  const cut = (text: string, upTo: string) =>
    text.slice(0, revealCut(text, upTo.length, "typewriter"));

  it("holds a list mark until the item has text, so a paragraph never flips to a heading", () => {
    const text = "Steps:\n- install\n- run";
    expect(cut(text, "Steps:\n-")).toBe("Steps:\n");
    expect(cut(text, "Steps:\n- ")).toBe("Steps:\n");
    expect(cut(text, "Steps:\n- i")).toBe("Steps:\n- i");
    expect(cut("1. one\n2. two", "1. one\n2")).toBe("1. one\n");
  });

  it("holds a heading's marks, a quote's and a table's rule until text follows", () => {
    expect(cut("## Setup", "#")).toBe("");
    expect(cut("## Setup", "## ")).toBe("");
    expect(cut("## Setup", "## S")).toBe("## S");
    expect(cut("> quoted", "> ")).toBe("");
    const table = "| a | b |\n|---|---|\n| x | y |";
    expect(cut(table, "| a | b |\n|---|-")).toBe("| a | b |\n");
    expect(cut(table, "| a | b |\n|---|---|\n| x")).toBe("| a | b |\n|---|---|\n| x");
  });

  it("opens a fence with its info string or first line, and closes it only when whole", () => {
    const text = "```ts\nconst a = 1;\n```\nafter";
    expect(cut(text, "``")).toBe("");
    expect(cut(text, "```")).toBe("");
    expect(cut(text, "```t")).toBe("```t");
    expect(cut(text, "```ts\nconst a = 1;\n``")).toBe("```ts\nconst a = 1;\n");
    expect(cut(text, "```ts\nconst a = 1;\n```\na")).toBe("```ts\nconst a = 1;\n```\na");
    const bare = "```\nx\n```";
    expect(cut(bare, "```\n")).toBe("```\n");
    expect(cut(bare, "```\nx")).toBe("```\nx");
  });

  it("never splits a run of marks or a surrogate pair", () => {
    expect(cut("a **b** c", "a *")).toBe("a **");
    expect(cut("use `x`", "use `")).toBe("use `");
    expect(cut("a😀b", "a\ud83d")).toBe("a😀");
  });

  it("leaves plain text where the cursor is", () => {
    expect(cut("plain words here", "plain wo")).toBe("plain wo");
  });
});

/**
 * Source of the reply body, its caret and the item that renders it. The suite renders no React,
 * so the markup the theme recipes select on is pinned against the text that writes it.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const body = read("../src/features/chat/assistant-reply-body.tsx");
const caret = read("../src/features/chat/streaming-caret.tsx");
const item = read("../src/features/chat/message-item.tsx");
const hook = read("../src/features/chat/use-stream-reveal.ts");

describe("the reply body (source contract)", () => {
  it("is the ui-stream host, streaming until the reveal has caught up and done after", () => {
    expect(body).toMatch(/className="ui-stream md-body /);
    expect(body).toContain('data-state={live ? "streaming" : "done"}');
    expect(body).toContain("const revealed = useStreamReveal(text, streaming);");
    expect(body).toContain("const live = streaming || revealed.length < text.length;");
  });

  it("renders the revealed prefix, in Markdown's streaming mode while live", () => {
    expect(body).toContain("<Md text={revealed} streaming={live} />");
  });

  it("shows the caret slot while live, and the item's extras only once the reply is whole", () => {
    expect(body).toContain("{live && <StreamingCaret />}");
    expect(body).toContain("{!live && children}");
    expect(caret).toContain('data-slot="caret"');
    expect(caret).toContain('aria-hidden="true"');
    // Primer's caret as it always was: a soft pulsing bar in the muted ink.
    expect(caret).toContain('className="animate-pulse text-gray-400"');
    expect(caret).toContain("▌");
  });

  it("is how the transcript renders every assistant reply", () => {
    expect(item).toContain("<AssistantReplyBody text={item.text} streaming={item.streaming}>");
    expect(item).not.toContain("▌");
    expect(item).not.toMatch(/<Md\b/);
  });

  it("drives the pacing from animation frames and cancels them on cleanup", () => {
    expect(hook).toContain("requestAnimationFrame(tick)");
    expect(hook).toContain("cancelAnimationFrame(frame)");
    expect(hook).toMatch(/if \(!paced\) return text;/);
  });
});
