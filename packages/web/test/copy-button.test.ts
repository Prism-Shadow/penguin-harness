/**
 * The copy button's feedback follows the WRITE: the check (and the tooltip's flip to the
 * copied label) appears only once writeClipboard reports the text reached the clipboard,
 * and a refused write leaves the control idle. clipboard.test.ts pins the entry itself; this
 * pins the one place its answer is consumed, so dropping the `if (!ok) return;` guard in
 * useCopied (back to an unconditional check) fails here.
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), so nothing mounts the
 * component: React's hooks are replaced by a minimal slot store — useState / useRef keep
 * their value across calls in call order, useEffect is inert (it only arms the unmount
 * cleanup) — and CopyButton is called as a plain function, its button's onClick driven
 * directly and the button re-read on the next "render". Both directions are asserted, or a
 * button that never shows the check would pass too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { CopyButton } from "../src/components/ui/copy-button";
import { S } from "../src/lib/strings";

/** Hook slots in call order, the cursor rewound on each render, and every value `copied` was set to. */
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  copiedSets: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T>(initial: T) => {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = initial;
      const set = (value: T) => {
        hooks.slots[i] = value;
        hooks.copiedSets.push(value);
      };
      return [hooks.slots[i] as T, set];
    },
    useRef: <T>(initial: T) => {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
      return hooks.slots[i];
    },
    useEffect: () => {},
  };
});

/** The clipboard entry's answer for the next write (its own behaviour is clipboard.test.ts's). */
const writeClipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());

vi.mock("../src/lib/clipboard", () => ({ writeClipboard }));

type Button = ReactElement<{ title: string; onClick: () => void }>;

const LABEL = "Copy session id";

/** One render of the button, returning the <button> element (the fragment's first child). */
function render(): Button {
  hooks.cursor = 0;
  const fragment = CopyButton({ text: "sess-42", label: LABEL }) as ReactElement<{
    children: ReactNode[];
  }>;
  return fragment.props.children[0] as Button;
}

/** Lets the write's resolution and the `.then` behind it run. */
async function settle() {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  hooks.slots = [];
  hooks.copiedSets = [];
});

afterEach(() => {
  vi.useRealTimers();
  writeClipboard.mockReset();
});

describe("CopyButton: the check follows the write", () => {
  it("shows no check when the write is refused", async () => {
    writeClipboard.mockResolvedValue(false);
    const idle = render();
    expect(idle.props.title).toBe(LABEL);

    idle.props.onClick();
    await settle();

    expect(writeClipboard).toHaveBeenCalledTimes(1);
    expect(writeClipboard.mock.calls[0]?.[0]).toBe("sess-42");
    expect(hooks.copiedSets).not.toContain(true);
    expect(render().props.title).toBe(LABEL);
  });

  it("shows the check once the write landed, and clears it after the window", async () => {
    writeClipboard.mockResolvedValue(true);
    render().props.onClick();
    await settle();

    expect(hooks.copiedSets).toEqual([true]);
    expect(render().props.title).toBe(S.common.copied);

    vi.runAllTimers();
    expect(hooks.copiedSets).toEqual([true, false]);
    expect(render().props.title).toBe(LABEL);
  });
});
