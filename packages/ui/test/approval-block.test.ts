/**
 * The approval band (src/components/chat/approval-block/approval-block.tsx): what a tool call
 * waiting on a person shows under its row. What the card around it renders while collapsed is
 * the tool-call card's test.
 *
 * - The band names its tone in the notice hook's words and declares itself a tone surface, so a
 *   custom background thins its amber the way it thins a notice's (how is the stylesheet's,
 *   wallpaper.css, checked in a browser).
 * - Pressing Allow or Deny hands that decision to the caller once, and both buttons hold still
 *   until the caller has settled it.
 *
 * vitest runs node-only here (no DOM), so nothing mounts the buttons: their one piece of state is
 * kept by a minimal stand-in for React's useState (slots in call order, the cursor rewound on
 * each render, as the copy button's write test does), the buttons are called as a plain
 * function, and their handlers are driven directly.
 */
import { createElement } from "react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApprovalBlock,
  ApprovalButtons,
} from "../src/components/chat/approval-block/approval-block";
import type { ApprovalChoice } from "../src/components/chat/approval-block/approval-block";
import { renderStatic } from "../src/testing";

/** Hook slots in call order, and the cursor rewound before each render. */
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T>(initial: T) => {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = initial;
      const set = (value: T) => {
        hooks.slots[i] = value;
      };
      return [hooks.slots[i] as T, set];
    },
  };
});

const labels = { allow: "Allow", deny: "Deny" };

type DecisionButton = ReactElement<{ disabled: boolean; onClick: () => void; children: string }>;

/** One render of the two buttons, by their words. */
function buttons(onDecide: (decision: ApprovalChoice) => Promise<void>) {
  hooks.cursor = 0;
  const row = ApprovalButtons({ onDecide, labels }) as ReactElement<{
    children: DecisionButton[];
  }>;
  const byLabel = (label: string) => row.props.children.find((b) => b.props.children === label)!;
  return { allow: byLabel(labels.allow), deny: byLabel(labels.deny) };
}

const disabled = (onDecide: (decision: ApprovalChoice) => Promise<void>) => {
  const { allow, deny } = buttons(onDecide);
  return [allow.props.disabled, deny.props.disabled];
};

/** Lets the decision's resolution and the `finally` behind it run. */
async function settle() {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
});

describe("ApprovalBlock", () => {
  it("names its tone as a notice does and declares itself a tone surface", () => {
    const html = renderStatic(
      createElement(ApprovalBlock, {
        name: "Run command",
        preview: "$ ls -la",
        onDecide: async () => {},
        labels,
      }),
    );
    const root = /^<[^>]*>/.exec(html)?.[0] ?? "";
    expect(root).toContain('data-wallpaper-surface="tone"');
    expect(root).toContain('data-tone="warning"');
  });

  it.each(["allow", "deny"] as const)(
    "hands %s to the caller once, and holds both buttons still until it settles",
    async (choice) => {
      let done!: () => void;
      const onDecide = vi.fn<(decision: ApprovalChoice) => Promise<void>>(
        () =>
          new Promise<void>((resolve) => {
            done = resolve;
          }),
      );
      expect(disabled(onDecide)).toEqual([false, false]);

      buttons(onDecide)[choice].props.onClick();

      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(onDecide).toHaveBeenCalledWith(choice);
      expect(disabled(onDecide)).toEqual([true, true]);

      done();
      await settle();

      expect(disabled(onDecide)).toEqual([false, false]);
      expect(onDecide).toHaveBeenCalledTimes(1);
    },
  );
});
