/**
 * A completed provider response is waiting for its final text Trace write. When Project
 * deletion reaches its cleanup deadline, subsequent usage must not recreate deleted rows.
 * Controls: the same response remains metered with a live Project, even if only its Session
 * was deleted. Recreating the Project's ID must not inherit its previous requests' usage.
 * Real model adapter, Session, Trace, server and SQLite; scripted provider and
 * gated Trace completion. The deletion deadline uses fake timers, not a real wait.
 */
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GenerativeModel, Session, Writer, tracesDir, userText } from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { adoptSession, uniqueSessionId } from "./fixtures/session.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let t: TestApp;
let api: ReturnType<typeof apiClient>;
let projects = 0;
beforeAll(async () => {
  t = await createTestApp();
  api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
});
afterAll(async () => {
  await t.cleanup();
});

it.each(["project", "recreated", "session", "neither"] as const)(
  "keeps usage consistent when deleting %s during a completed response's final write",
  async (removal) => {
    const projectId = `owner-late_main_${++projects}`;
    expect((await api.post("/api/projects", { projectId, name: "Late main usage" })).status).toBe(
      201,
    );
    const sessionId = uniqueSessionId();
    const textWriting = gate();
    const releaseText = gate();
    const requestEnded = gate();
    const writer = new Writer({
      tracesDir: tracesDir(t.root, projectId, "default_agent"),
      sessionId,
    });
    let requests = 0;
    let completedResponse = false;
    let requestSignal: AbortSignal | undefined;
    class Model extends GenerativeModel {
      constructor() {
        super({
          modelId: "gpt-test",
          clientType: "openai-chat",
          apiKey: "test-key",
          tools: [],
          requestTimeoutMs: 0,
        });
      }
      protected override async *openStream(_input: unknown, signal: AbortSignal) {
        requests++;
        requestSignal = signal;
        yield {
          role: "assistant" as const,
          event_type: "delta" as const,
          content_items: [{ type: "text.delta" as const, text: "finished answer" }],
          usage_metadata: null,
          finish_reason: null,
        };
        completedResponse = true;
        yield {
          role: "assistant" as const,
          event_type: "stop" as const,
          content_items: [],
          usage_metadata: {
            cached_tokens: 0,
            prompt_tokens: 10,
            response_tokens: 2,
            thoughts_tokens: 0,
          },
          finish_reason: "stop" as const,
        };
      }
    }
    const session = new Session({
      meta: {
        session_id: sessionId,
        provider: "custom",
        model_id: "gpt-test",
        model_context_window: 10000,
        system_prompt: "test",
        agent_state: t.root,
        workspace: t.root,
        source: "user",
      },
      bootstrap: async () => ({ llm: new Model() }),
      imagesDir: t.root,
      modelHasVision: true,
      trace: {
        async write(msg) {
          await writer.write(msg);
          if (
            (msg.payload as { type?: string }).type === "text" &&
            (msg.payload as { role?: string }).role === "assistant"
          ) {
            textWriting.resolve();
            await releaseText.promise;
          }
        },
      },
      environment: {
        listTools: async () => [],
        toolPermission: () => undefined,
        async *executeTool() {
          throw new Error("unexpected tool");
        },
        dispose() {},
      },
    });
    await writer.write(session.metaMessage);
    adoptSession(t.deps, session, { projectId, modelId: "gpt-test" });
    const unsubscribe = t.deps.channels.get(sessionId).subscribe((event) => {
      if (event.event) return;
      const msg = JSON.parse(event.data) as AmspRecord;
      if ((msg.payload as { type?: string }).type === "request_end") requestEnded.resolve();
    });
    let deletion: Promise<unknown> | undefined;
    try {
      await t.deps.manager.startTask(sessionId, [userText("work")]);
      await textWriting.promise;
      expect(completedResponse).toBe(true);
      if (removal === "project" || removal === "recreated") {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        deletion = t.deps.projectService.deleteProject("owner", projectId);
        expect(requestSignal?.aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        await deletion;
        vi.useRealTimers();
        expect(
          t.deps.db.prepare("SELECT project_id FROM projects WHERE project_id = ?").all(projectId),
        ).toEqual([]);
        expect(
          t.deps.db.prepare("SELECT total FROM usage_records WHERE project_id = ?").all(projectId),
        ).toEqual([]);
      } else if (removal === "session") {
        deletion = Promise.resolve(api.delete(`/api/sessions/${sessionId}`)).then((res) => {
          expect(res.status).toBe(204);
        });
        await waitFor(() => requestSignal?.aborted === true);
      }
      if (removal === "recreated") {
        expect(
          (await api.post("/api/projects", { projectId, name: "Recreated project" })).status,
        ).toBe(201);
      }
      releaseText.resolve();
      await requestEnded.promise;
      await deletion;
      expect(requests).toBe(1);
      expect(
        t.deps.db
          .prepare("SELECT total, model_id FROM usage_records WHERE project_id = ?")
          .all(projectId),
      ).toEqual(
        removal === "project" || removal === "recreated"
          ? []
          : [{ total: 12, model_id: "gpt-test" }],
      );
    } finally {
      vi.useRealTimers();
      releaseText.resolve();
      await deletion;
      unsubscribe();
      session.dispose();
    }
  },
);
