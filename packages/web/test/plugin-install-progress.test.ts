import { describe, expect, it, vi } from "vitest";
import { apiFetchStream } from "../src/api/client";
import { installPluginStream } from "../src/api/endpoints";

vi.mock("../src/api/client", async (original) => ({
  ...(await original<typeof import("../src/api/client")>()),
  apiFetchStream: vi.fn(),
}));

describe("the market install progress stream", () => {
  it("advances through the npm marker, comments, split downloads and final response", async () => {
    const chunks = [
      "event: npm\ndata: {}\n\n: heartbeat\n\nevent: dow",
      'nload\ndata: {"received":2,"total":4}\n\nevent: download\ndata: {"received":4,"total":4}\n\n',
      'event: result\ndata: {"plugins":[]}\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    vi.mocked(apiFetchStream).mockResolvedValue(new Response(stream));
    const progress = vi.fn();
    await expect(installPluginStream("here", "demo@1.1.0", null, progress)).resolves.toEqual({
      plugins: [],
    });
    expect(progress.mock.calls).toEqual([
      [2, 4],
      [4, 4],
    ]);
  });
});
