/**
 * Given an explicitly selected model, the first send starts a talk-only Session once;
 * a refresh during a turn must not turn an empty snapshot into success. The second turn
 * uses that Session and the user's revisions, and produces only bounded checklist data.
 * Returning from model settings after a failed send restores the edits for the next attempt.
 * Invalid replies, launch failures and attempts to skip the conversation remain retryable.
 */
import { describe, expect, it, vi } from "vitest";
import { conversationDraft } from "../workbenches/first-workbench-guide/ui/draft.js";
import pkg from "../workbenches/first-workbench-guide/index";
const key = "a".repeat(32);
const model = { provider: "chosen-provider", modelId: "chosen-model" };
const first = { action: "chat", model, request: "Help me hand over the lab's inventory." };
const design = {
  title: "Inventory handover",
  items: [{ group: "Transfer", task: "Compare the two counts", doneWhen: "The totals match." }],
};

function fixture() {
  let state: unknown = null;
  const host = {
    createSession: vi.fn(async () => ({ sessionId: "s1", approvalMode: "deny-all" })),
    run: vi.fn(async () => {}),
    getState: () => state,
    setState: async (s: unknown) => {
      state = structuredClone(s);
    },
    sessionResult: vi.fn(async () => ({
      status: "running",
      text: "",
      error: null as string | null,
    })),
  };
  const open = () => pkg.modules.Workbench.create({ use: { host } } as never).api.main.handle;
  const call = (body?: unknown) =>
    open()({
      method: body ? "POST" : "GET",
      path: "/guides/" + key,
      headers: {},
      query: {},
      body: body ?? null,
    });
  return { host, open, call };
}
describe("first workbench conversation", () => {
  it("resumes real turns and uses the chosen model and the user's revisions only once", async () => {
    const { host, open, call } = fixture(),
      handle = open();
    const req = { method: "POST", path: "/guides/" + key, body: first, headers: {}, query: {} };
    await Promise.all([handle(req), handle(req)]);
    expect(host.createSession).toHaveBeenCalledExactlyOnceWith({ model, approvalMode: "deny-all" });
    expect(host.run.mock.calls[0]).toEqual([
      "s1",
      [{ text: expect.stringContaining(first.request) }],
    ]);
    expect((await call()).body).toMatchObject({ phase: "chatting" });
    host.sessionResult.mockResolvedValue({
      status: "completed",
      text: "Compare the two counts.",
      error: null,
    });
    expect((await call()).body).toMatchObject({
      phase: "answered",
      answer: "Compare the two counts.",
    });
    await call({ action: "generate", feedback: "Add a sign-off." });
    expect(host.run.mock.calls[1]).toEqual([
      "s1",
      [{ text: expect.stringContaining("Add a sign-off.") }],
    ]);
    host.sessionResult.mockResolvedValue({
      status: "completed",
      text: JSON.stringify({ ...design, code: "not part of the workbench" }),
      error: null,
    });
    expect((await call()).body).toMatchObject({ phase: "ready", design });
    expect((await call({ action: "generate" })).body.design).not.toHaveProperty("code");
    expect(host.run).toHaveBeenCalledTimes(2);
  });
  it("restores an edited request and replacement model after a failed conversation", async () => {
    const { host, call } = fixture();
    await call(first);
    host.sessionResult.mockResolvedValue({
      status: "failed",
      text: "",
      error: "Connection refused",
    });
    const failed = (await call()).body;
    const edits = {
      request: "Check expiration dates instead.",
      model: { provider: "local", modelId: "inventory", label: "Inventory" },
    };
    const resumed = conversationDraft(JSON.parse(JSON.stringify(edits)), failed);
    expect(resumed).toEqual(edits);
    await call({ action: "chat", ...resumed });
    expect(host.createSession).toHaveBeenLastCalledWith({
      model: { provider: "local", modelId: "inventory" },
      approvalMode: "deny-all",
    });
    expect(host.run.mock.calls.at(-1)).toEqual([
      "s1",
      [{ text: expect.stringContaining(edits.request) }],
    ]);
  });
  it("rejects skipped setup and recovers from a failed start and malformed design", async () => {
    const { host, call } = fixture();
    expect((await call({ action: "generate" })).status).toBe(409);
    expect((await call({ ...first, model: { provider: "", modelId: "none" } })).status).toBe(400);
    expect(host.createSession).not.toHaveBeenCalled();
    host.run.mockRejectedValueOnce(new Error("Service unavailable"));
    expect((await call(first)).body).toMatchObject({
      phase: "chat-error",
      error: "Service unavailable",
    });
    await call(first);
    host.sessionResult.mockResolvedValue({
      status: "completed",
      text: "Review stock.",
      error: null,
    });
    await call();
    await call({ action: "generate" });
    expect((await call()).body).toMatchObject({ phase: "design-error", error: "invalid-design" });
    await call({ action: "generate", feedback: "Include acceptance criteria." });
    host.sessionResult.mockResolvedValue({ status: "failed", text: "", error: "Cancelled" });
    expect((await call()).body).toMatchObject({ phase: "design-error", error: "Cancelled" });
    await call({ action: "generate" });
    host.sessionResult.mockResolvedValue({
      status: "completed",
      text: "```json\n" + JSON.stringify(design) + "\n```",
      error: null,
    });
    expect((await call()).body).toMatchObject({ phase: "ready", design });
  });
});
