/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../src/api/client";
import { getWorkbench } from "../src/api/endpoints";
import {
  guideClosed,
  closeGuide,
  guideStorage,
  guideLocation,
  loadGuideProgress,
  persistGuideProgress,
  installGuideBoard,
  verifyGuideBoard,
  type Guide,
} from "../src/lib/first-workbench-tour";

vi.mock("../src/api/client", async (original) => ({
  ...(await original<typeof import("../src/api/client")>()),
  apiFetch: vi.fn(),
}));
vi.mock("../src/api/endpoints", () => ({ getSession: vi.fn(), getWorkbench: vi.fn() }));
const loc = guideLocation("project", "reader", "desk");
const guide: Guide = {
  sessionId: "session",
  boardId: "checklist-qa",
  request: "Review",
  phase: "ready",
  design: { title: "Review", items: [] },
};
const key = "a".repeat(32);
afterEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it("resumes a prior tab’s draft but persists only scoped milestones across restarts", () => {
  const storage = guideStorage("owner", loc.pathname);
  const model = { provider: "test", modelId: "sample", label: "Transient label" };
  const previous = {
    key,
    model,
    tourSession: "session",
    request: "Unsent private text",
    feedback: "Pending edit",
  };
  sessionStorage.setItem(storage, JSON.stringify(previous));
  expect(loadGuideProgress(storage)).toEqual(previous);
  persistGuideProgress(storage, previous);
  sessionStorage.clear();
  expect(loadGuideProgress(storage)).toEqual({
    key,
    model: { provider: "test", modelId: "sample" },
    tourSession: "session",
  });
  closeGuide(storage);
  expect(guideClosed(storage)).toBe(true);
  expect(guideClosed(guideStorage("other", loc.pathname))).toBe(false);
  expect(
    guideClosed(guideStorage("owner", guideLocation("project", "reader", null).pathname)),
  ).toBe(false);
  expect(
    guideClosed(guideStorage("owner", guideLocation("project", "other", "desk").pathname)),
  ).toBe(false);
});

it("resumes an already installed checklist only when its real tab and board match", async () => {
  const call = vi.mocked(apiFetch);
  call
    .mockResolvedValueOnce({ dataBase64: "archive" })
    .mockRejectedValueOnce(new ApiError(409, "conflict", "exists"))
    .mockResolvedValueOnce({ id: guide.boardId, title: "Review", items: [] });
  vi.mocked(getWorkbench).mockResolvedValueOnce({
    workbenches: [{ id: guide.boardId, tabs: [{ key: "main" }] }],
  } as never);
  await installGuideBoard(loc, key, guide);
  expect(getWorkbench).toHaveBeenCalledWith("project", "reader", guide.boardId, "desk");
  call
    .mockResolvedValueOnce({ dataBase64: "archive" })
    .mockRejectedValueOnce(new ApiError(409, "conflict", "exists"));
  vi.mocked(getWorkbench).mockResolvedValueOnce({
    workbenches: [{ id: guide.boardId, tabs: [] }],
  } as never);
  await expect(installGuideBoard(loc, key, guide)).rejects.toThrow("did not load");
});

it("checks real saved state and removes only its temporary item when a write fails", async () => {
  const rows = new Map([["original", { id: "original", task: "Keep", done: false }]]);
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    expect(options?.server).toBe("desk");
    if (path.endsWith("/board"))
      return { id: guide.boardId, title: "Review", items: [...rows.values()] };
    const { op, id, task } = options?.body as { op: string; id: string; task: string };
    if (op === "add") rows.set(id, { id, task, done: false });
    if (op === "remove") rows.delete(id);
    if (op === "check") throw Error("Connection closed");
  });
  await expect(verifyGuideBoard(loc, guide, "Temporary")).rejects.toThrow("Connection closed");
  expect([...rows.keys()]).toEqual(["original"]);
});
