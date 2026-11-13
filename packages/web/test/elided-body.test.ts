// @vitest-environment jsdom
/**
 * A folded value whose whole text could not be fetched (features/chat/elided-body.tsx), under
 * an opened tool or thinking row.
 *
 * - Given the fetch failed, the row says so on a notice line like the transcript's others — what
 *   failed and why, in sight — with Retry after it, and no retry row's frame or "?".
 * - Given Retry pressed, the whole text is asked for again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { ElidedBodiesContext, ElidedBodyNote } from "../src/features/chat/elided-body";
import type { ThinkingItem } from "../src/lib/amsp/stream-model";
import { S } from "../src/lib/strings";
import { button, click, mount, unmountAll } from "./helpers/dom";

const failed: ThinkingItem = {
  kind: "thinking",
  id: 1,
  thinking: "Looking at the release notes…",
  streaming: false,
  bodyLoad: { doneBytes: 0, totalBytes: 0, error: "socket closed" },
};

afterEach(async () => {
  await unmountAll();
});

describe("a folded value that could not be fetched", () => {
  it("says so on a notice line with the failure in sight and Retry, which asks again", async () => {
    const load = vi.fn();
    const { container } = await mount(
      h(ElidedBodiesContext.Provider, { value: { load } }, h(ElidedBodyNote, { item: failed })),
    );
    expect(container.textContent).toContain(S.chat.historyTransfer.bodyFailed("socket closed"));
    expect(container.querySelector("[data-retry-phase]")).toBeNull();
    // Opening the row asked once; Retry asks again.
    expect(load).toHaveBeenCalledTimes(1);
    await click(button(S.common.retry));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
