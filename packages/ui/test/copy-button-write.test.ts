/**
 * The copy button's feedback follows the WRITE: the check appears only once the clipboard
 * writer reports the text reached the clipboard, and a refused write leaves the control idle.
 * The tooltip names the action throughout and never flips to the result. The app's writer is
 * pinned by its own tests; this pins the one place its answer is consumed, so dropping the
 * `if (!ok) return;` guard in useCopied (back to an unconditional check) fails here.
 *
 * vitest runs node-only here (`environment: "node"`, no jsdom), so nothing mounts the
 * component: React's hooks are replaced by a minimal slot store — useState / useRef keep
 * their value across calls in call order, useEffect is inert (it only arms the unmount
 * cleanup), useContext hands over the writer under test — and CopyButton is called as a plain
 * function, its button's onClick driven directly and the button re-read on the next "render".
 * Both directions are asserted, or a button that never shows the check would pass too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { CopyButton } from "../src/components/actions/copy-button/copy-button";

/** Hook slots in call order, the cursor rewound on each render, and every value `copied` was set to. */
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  copiedSets: [] as unknown[],
}));

/** The writer's answer for the next write, handed to the button as its context value. */
const write = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());

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
    useContext: () => write,
  };
});

type Button = ReactElement<{
  "data-tooltip": string;
  onClick: () => void;
  children: ReactElement<{ copied: boolean }>;
}>;

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
  write.mockReset();
});

describe("CopyButton: the check follows the write", () => {
  it("shows no check when the write is refused", async () => {
    write.mockResolvedValue(false);
    const idle = render();
    expect(idle.props["data-tooltip"]).toBe(LABEL);
    expect(idle.props.children.props.copied).toBe(false);

    idle.props.onClick();
    await settle();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe("sess-42");
    expect(hooks.copiedSets).not.toContain(true);
    expect(render().props.children.props.copied).toBe(false);
  });

  it("shows the check once the write landed, and clears it after the window", async () => {
    write.mockResolvedValue(true);
    render().props.onClick();
    await settle();

    expect(hooks.copiedSets).toEqual([true]);
    const copied = render();
    expect(copied.props.children.props.copied).toBe(true);
    expect(copied.props["data-tooltip"]).toBe(LABEL);

    vi.runAllTimers();
    expect(hooks.copiedSets).toEqual([true, false]);
    expect(render().props.children.props.copied).toBe(false);
  });
});
