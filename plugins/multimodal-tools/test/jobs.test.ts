/** Retried briefs create one Session. A different brief gets its own result, including failures. */
import { expect, it, vi } from "vitest";
import workbench from "../workbenches/images/index";
it("isolates briefs, persists a rejected run and deduplicates a retried submission", async () => {
  let state: unknown;
  const host = {
    getState: () => state,
    setState: async (next: unknown) => {
      state = structuredClone(next);
    },
    createSession: vi
      .fn()
      .mockResolvedValueOnce({ sessionId: "first" })
      .mockResolvedValueOnce({ sessionId: "second" }),
    run: vi
      .fn()
      .mockResolvedValueOnce({ sessionId: "first", queued: false })
      .mockRejectedValueOnce(new Error("model unavailable")),
    sessionResult: vi.fn().mockResolvedValue({ status: "completed", text: "Done", error: null }),
  };
  const { handle } = workbench.modules.Workbench.create({ use: { host } } as never).api.main;
  const a = { id: crypto.randomUUID(), prompt: "draw a small desk", ratio: "4:3", lang: "en" };
  const b = { ...a, id: crypto.randomUUID(), prompt: "another picture" };
  await Promise.all([
    handle({ method: "POST", path: "/jobs", body: a } as never),
    handle({ method: "POST", path: "/jobs", body: a } as never),
  ]);
  await handle({ method: "POST", path: "/jobs", body: b } as never);
  expect(host.createSession).toHaveBeenCalledTimes(2);
  expect(host.run.mock.calls[0]?.[1][0].text).toMatch(
    /^\[use_skills\]\nskills: multimodal-tools\n\[\/use_skills\]\n\n/,
  );
  expect(host.run.mock.calls[0]?.[1][0].text).toContain("penguin tools t2i");
  expect(host.run.mock.calls[0]?.[1][0].text).toContain("--json");
  expect(host.run.mock.calls[0]?.[0]).toBe("first");
  expect(host.run.mock.calls[1]?.[0]).toBe("second");
  expect((await handle({ method: "GET", path: "/jobs/" + b.id } as never)).body).toMatchObject({
    job: { sessionId: "second" },
    session: { status: "failed", error: "model unavailable" },
  });
  expect((await handle({ method: "GET", path: "/jobs/" + a.id } as never)).body).toMatchObject({
    job: { sessionId: "first" },
    session: { status: "completed" },
  });
  expect(host.sessionResult).toHaveBeenCalledWith("first");
});
