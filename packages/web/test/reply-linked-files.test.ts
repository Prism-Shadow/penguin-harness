// @vitest-environment jsdom
/**
 * A reply that links a Workspace file (features/chat/message-item.tsx, message-files-card.tsx),
 * an audio one here: the app draws no player or other renderer for it.
 *
 * - The link stays a link with no player beside it, and a click opens the file in the Files
 *   panel.
 * - Once the Task ends, its files card lists the file the reply names, and the card's row opens it
 *   too.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageStream, type StreamRenderContext } from "../src/features/chat/message-stream";
import type { ChatItem } from "../src/lib/amsp/stream-model";
import { S } from "../src/lib/strings";
import { LocaleProvider } from "../src/state/locale";
import { ThemeProvider } from "../src/state/theme";
import { click, mount, unmountAll, waitFor } from "./helpers/dom";

const WS = "/home/user/workspaces/song";
const REPLY = "I saved the take as [`take.mp3`](take.mp3).";

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
});

describe("a reply linking an audio file", () => {
  it("keeps the link a link, and the Task's files card lists the file", async () => {
    const onOpenFile = vi.fn();
    const asked: string[][] = [];
    const ctx: StreamRenderContext = {
      pendingApprovals: new Map(),
      onApprove: async () => {},
      origin: [],
      taskRunning: false,
      workspace: WS,
      onOpenFile,
      statFiles: async (paths) => {
        asked.push(paths);
        return new Set(paths);
      },
    };
    const items = [
      { kind: "assistant_text", id: 1, text: REPLY, streaming: false },
      { kind: "task_stats", id: 2, stats: null, assistantText: REPLY },
    ] as ChatItem[];
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    const page = await mount(
      createElement(
        LocaleProvider,
        null,
        createElement(
          ThemeProvider,
          null,
          createElement(MessageStream, { items, version: 1, ctx, onAddExcerpt: () => {} }),
        ),
      ),
    );

    expect(page.container.querySelector("audio")).toBeNull();
    const link = [...page.container.querySelectorAll("a")].find(
      (a) => a.textContent === "take.mp3",
    );
    expect(link).toBeDefined();
    await click(link!);
    expect(onOpenFile).toHaveBeenLastCalledWith("take.mp3");

    await waitFor(() => page.container.textContent?.includes(S.chat.filesInMessage(1)) ?? false);
    expect(asked).toEqual([["take.mp3"]]);
    const row = [...page.container.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("take.mp3") ?? false,
    );
    expect(row).toBeDefined();
    onOpenFile.mockClear();
    await click(row!);
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith("take.mp3");
  });
});
