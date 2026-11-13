// @vitest-environment jsdom
/**
 * Streaming text fading in as it arrives (the UI package's StreamText, through AssistantText and
 * the plain host a tool's output uses), under Frost's reveal: `fade` at 220 characters a second
 * over a 360 ms reveal duration, set on the root the way the theme sheet sets them. The frame
 * clock — requestAnimationFrame, performance.now and timers — is faked and advanced; where a
 * scenario needs the runs' fades, the browser's Web Animations are the one other fake.
 *
 * - Given a reply streaming in, when the reveal puts new words on screen, they are there at once,
 *   in a run stamped with the moment they came; words already on screen in full ink are never put
 *   back into a run.
 * - Given a reply that finishes, once its last run has faded the host is exactly the markup of
 *   the same reply mounted finished — prose, a list, inline code, a link, a code block, a table and
 *   math — with no run, mark or style left on it.
 * - Given a burst far past the rate, the whole text is on screen within the reveal's lag cap, and
 *   never more than a bounded number of runs are live while it gets there.
 * - Given a tool's output, its new lines fade in as runs too, and it settles into one plain text.
 * - Given reduced motion, Primer's instant reveal or Console's typewriter, no text is ever a run.
 * - Given a run's element that React hands to a newer run, the fade on it starts again at the
 *   newer run's time; every run's fade starts when its run arrived, not when it was rendered.
 */
import { act, createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantText, StreamText } from "@prismshadow/penguin-ui";
import { mount, unmountAll } from "./helpers/dom";

const FROST = {
  "--ui-stream-reveal": "fade",
  "--ui-stream-rate": "220",
  "--ui-dur-reveal": "360ms",
};
const PRIMER = {
  "--ui-stream-reveal": "instant",
  "--ui-stream-rate": "0",
  "--ui-dur-reveal": "150ms",
};
const CONSOLE = {
  "--ui-stream-reveal": "typewriter",
  "--ui-stream-rate": "90",
  "--ui-dur-reveal": "0ms",
};

const REPLY = [
  "The workspace is **healthy**: see [the log](https://example.invalid/log) and `penguin.toml`.\n\n",
  "- the build directory is present\n",
  "- no stray lock files were left\n\n",
  "```bash\nfor f in build/*.js; do\n  test -s $f\ndone\n```\n\n",
  "| Check | Result |\n| --- | --- |\n| Build | ok |\n| Locks | none |\n\n",
  "The ratio stays near \\( \\frac{a}{b} \\) across runs.\n\n",
  "$$\nx^2 + y^2\n$$\n\n",
  "中文段落也要平滑地显现。One more line to finish.",
].join("");

function theme(tokens: Record<string, string>) {
  for (const [name, value] of Object.entries(tokens))
    document.documentElement.style.setProperty(name, value);
}

const host = () => document.querySelector<HTMLElement>(".ui-stream")!;

/** Moves the frame clock on, letting React commit what the frames and timers did. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** The host's text as shown, and which of its characters sit in a run. */
function read(element: HTMLElement): { shown: string; inRun: Set<number> } {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let shown = "";
  const inRun = new Set<number>();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement!;
    if (parent.closest('[data-slot="caret"]') !== null) continue;
    const run = parent.closest("[data-arrive]") !== null && element.contains(parent);
    for (let i = 0; i < node.textContent!.length; i++) if (run) inRun.add(shown.length + i);
    shown += node.textContent;
  }
  return { shown, inRun };
}

/** The distinct runs live in the host. */
const liveRuns = () =>
  new Set([...host().querySelectorAll("[data-arrive]")].map((el) => el.getAttribute("data-arrive")))
    .size;

/** Streams `text` into `render` in chunks every `every` ms, then closes the stream. */
async function stream(
  render: (text: string, streaming: boolean) => ReturnType<typeof h>,
  text: string,
  chunk: number,
  every: number,
  onFrame?: () => void,
) {
  const page = await mount(render("", true));
  for (let end = chunk; end < text.length + chunk; end += chunk) {
    await page.rerender(render(text.slice(0, end), true));
    await advance(every);
    onFrame?.();
  }
  await page.rerender(render(text, false));
  return page;
}

const reply = (text: string, streaming: boolean) => h(AssistantText, { text, streaming });
const output = (text: string, streaming: boolean) =>
  h(StreamText, { text, streaming, format: "plain", className: "font-mono" });

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
});

afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-motion");
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
});

describe("streaming text fading in", () => {
  it("puts new words on screen at once in a run stamped with when they came, and never re-runs old ink", async () => {
    theme(FROST);
    const page = await mount(reply("", true));
    const plain = new Set<number>();
    let before = 0;
    let text = "";
    for (const word of "The workspace is healthy and the build is green today, all of it".split(
      " ",
    )) {
      text += `${word} `;
      await page.rerender(reply(text, true));
      await advance(130);
      const { shown, inRun } = read(host());
      expect(text.startsWith(shown)).toBe(true);
      // What came on screen this step is in a run, stamped within the step…
      for (let i = before; i < shown.length; i++) expect(inRun.has(i)).toBe(true);
      const newest = [...host().querySelectorAll("[data-arrive]")].at(-1);
      if (shown.length > before) {
        const stamp = Number(newest?.getAttribute("data-arrive"));
        expect(stamp).toBeLessThanOrEqual(performance.now());
        expect(stamp).toBeGreaterThan(performance.now() - 130);
      }
      // …and nothing that already stood in full ink is ever in one again.
      for (const i of inRun) expect(plain.has(i)).toBe(false);
      for (let i = 0; i < shown.length; i++) if (!inRun.has(i)) plain.add(i);
      before = shown.length;
    }
    // The early words have long finished fading: they are plain text again.
    expect(plain.size).toBeGreaterThan(20);
  });

  it("settles into exactly the markup of a reply that never streamed", async () => {
    theme(FROST);
    await stream(reply, REPLY, 24, 60);
    await advance(3000);
    const settled = host().outerHTML;
    expect(host().querySelector("[data-arrive], [data-arrivals]")).toBeNull();
    expect(host().hasAttribute("style")).toBe(false);
    await unmountAll();
    await mount(reply(REPLY, false));
    expect(host().outerHTML).toBe(settled);
  });

  it("gets a burst on screen within the lag cap, with a bounded number of runs live", async () => {
    theme(FROST);
    // No math: a settled formula is typeset, so its text would differ from the streamed source.
    const burst = REPLY.slice(0, REPLY.indexOf("The ratio")).repeat(3);
    const page = await mount(reply("", true));
    await page.rerender(reply(burst, true));
    let most = 0;
    for (let t = 0; t < 1600; t += 16) {
      await advance(16);
      most = Math.max(most, liveRuns());
    }
    const whole = read(host()).shown;
    await page.rerender(reply(burst, false));
    await advance(1000);
    // The text the reveal ended on is the whole reply, as it reads once settled.
    expect(whole).toBe(read(host()).shown);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(16);
  });

  it("fades a tool's new lines in too, and settles into one plain text", async () => {
    theme(FROST);
    const lines = Array.from({ length: 12 }, (_, i) => `checking item ${i + 1}\n`).join("");
    let ran = false;
    await stream(output, lines, 17, 120, () => {
      ran ||= host().querySelector("span[data-arrive]") !== null;
    });
    expect(ran).toBe(true);
    await advance(3000);
    expect(host().outerHTML).toBe(
      `<pre class="ui-stream font-mono" data-state="done">${lines}</pre>`,
    );
  });

  it.each([
    ["reduced motion", FROST, "reduced"],
    ["Primer's instant reveal", PRIMER, null],
    ["Console's typewriter", CONSOLE, null],
  ] as const)("puts no text in a run under %s", async (_, tokens, motion) => {
    theme(tokens);
    if (motion !== null) document.documentElement.setAttribute("data-motion", motion);
    let runs = 0;
    await stream(reply, REPLY.slice(0, 400), 40, 60, () => {
      runs += liveRuns();
    });
    await advance(6000);
    expect(runs).toBe(0);
    expect(read(host()).shown.length).toBeGreaterThan(300);
  });

  it("starts every run's fade when the run arrived, also on an element handed to a newer run", async () => {
    theme(FROST);
    const fades = new WeakMap<Element, { effect: { target: Element }; startTime: number | null }>();
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value(this: Element, options?: { subtree?: boolean }) {
        if (options?.subtree !== true) return [];
        return [...this.querySelectorAll("[data-arrive]")].map((target) => {
          let fade = fades.get(target);
          if (fade === undefined) {
            fade = { effect: { target }, startTime: null };
            fades.set(target, fade);
          }
          return fade;
        });
      },
    });
    const stamps = new Map<Element, Set<string>>();
    const words = "one two three four five six seven eight nine ten eleven twelve ".repeat(3);
    await stream(reply, words, 6, 90, () => {
      for (const el of host().querySelectorAll("[data-arrive]")) {
        const stamp = el.getAttribute("data-arrive")!;
        expect(fades.get(el)?.startTime).toBe(Number(stamp));
        stamps.set(el, (stamps.get(el) ?? new Set()).add(stamp));
      }
    });
    // React did hand one run's element to a later run, and the fade followed it.
    expect([...stamps.values()].some((seen) => seen.size > 1)).toBe(true);
  });
});
