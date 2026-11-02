/**
 * A completed provider response carries known usage before its final text finishes writing.
 * Removing its parent during that write must not lose the ensuing usage record.
 * Controls: a live child and a removed main Session preserve the same reported usage.
 * Removed Sessions publish no late child messages; deleting their Project discards usage.
 * Project deletion advances its bounded cleanup deadline with fake timers before releasing
 * the child's final write, including when Session deletion precedes Project deletion.
 * Real model, engine, Environment, server recorder and SQLite; only provider output and the
 * completion of a Trace write are gated. No real model calls or spending.
 */
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import {
  Session,
  Environment,
  GenerativeModel,
  Writer,
  tracesDir,
  requestBegin,
  subagentEvent,
  toolCall,
  userText,
  withOrigin,
  sessionMeta,
} from "@prismshadow/penguin-core";
import type { AmspRecord, SessionMetaPayload, SubagentHandle } from "@prismshadow/penguin-core";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { adoptSession, fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const kind = (msg: AmspRecord) => (msg.payload as { type?: string }).type;
let t: TestApp;
let api: ReturnType<typeof apiClient>;
let projects = 0;
beforeAll(async () => {
  t = await createTestApp({ loader: { load: async (row) => fakeSession(row.sessionId) } });
  api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
});
afterAll(async () => {
  await t.cleanup();
});

it.each([
  "live-child",
  "removed-child-active-parent",
  "removed-child-idle-parent",
  "removed-main",
  "removed-project",
  "removed-session-then-project",
  "recreated-project",
  "reloaded-recreated-project",
] as const)(
  "%s accounts for completed usage without reviving deleted data or streams",
  async (scenario) => {
    const parentId = uniqueSessionId();
    const projectId = `owner-late_usage_${++projects}`;
    expect((await api.post("/api/projects", { projectId, name: "Late usage" })).status).toBe(201);
    const main = scenario === "removed-main";
    const removeProject =
      scenario === "removed-project" ||
      scenario === "removed-session-then-project" ||
      scenario === "recreated-project" ||
      scenario === "reloaded-recreated-project";
    const childId = main ? parentId : uniqueSessionId();
    const textWriting = gate();
    const releaseText = gate();
    const parentStarted = gate();
    const parentStopped = gate();
    const releaseParent = gate();
    const disposed = gate();
    const childFinished = gate();
    let providerCompleted = false;
    let requests = 0;
    let requestSignal: AbortSignal | undefined;
    let deliveredUsage = 0;
    const tracedUsage: number[] = [];
    const writer = new Writer({
      tracesDir: tracesDir(t.root, projectId, "default_agent"),
      sessionId: childId,
    });
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
        requestSignal = signal;
        requests += 1;
        yield {
          role: "assistant" as const,
          event_type: "delta" as const,
          content_items: [{ type: "text.delta" as const, text: "finished answer" }],
          usage_metadata: null,
          finish_reason: null,
        };
        providerCompleted = true;
        // Normal stop closes the text item and carries the completed response's usage.
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
    const meta: SessionMetaPayload = {
      session_id: childId,
      provider: "custom",
      model_id: "gpt-test",
      model_context_window: 10000,
      system_prompt: "test",
      agent_state: t.root,
      workspace: t.root,
      source: main ? "user" : "subagent",
    };
    const session = new Session({
      meta,
      bootstrap: async () => ({ llm: new Model() }),
      imagesDir: t.root,
      modelHasVision: true,
      trace: {
        async write(msg) {
          await writer.write(msg);
          if (kind(msg) === "text" && (msg.payload as { role?: string }).role === "assistant") {
            textWriting.resolve();
            await releaseText.promise;
          }
          if (kind(msg) === "token_usage")
            tracedUsage.push((msg.payload as { request: { total: number } }).request.total);
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
    let env: Environment | undefined;
    let deletion: Promise<Response> | undefined;
    if (main) {
      adoptSession(t.deps, session, { projectId, modelId: "gpt-test" });
      await t.deps.manager.startTask(parentId, [userText("work")]);
    } else {
      const handle: SubagentHandle = {
        sessionId: childId,
        async *run({ messages, signal }) {
          yield withOrigin(session.metaMessage, childId);
          const run = session.run(messages, { signal });
          for (;;) {
            const next = await run.next();
            if (next.done) {
              childFinished.resolve();
              return next.value;
            }
            yield withOrigin(next.value, childId);
          }
        },
        dispose: () => {
          session.dispose();
        },
      };
      env = new Environment({
        workspaceDir: t.root,
        toolConfig: {
          customTools: [{ name: "run_subagent", description: "test", permission: "rw" }],
          mcpServers: [],
        },
        services: { subagentRunner: { spawn: async () => handle } },
      });
      const environment = env;
      adoptSession(
        t.deps,
        fakeSession(parentId, {
          dispose: () => {
            disposed.resolve();
            return environment.dispose();
          },
          onBackgroundMessage: (cb) =>
            environment.setBackgroundMessageListener((msg) => {
              if (kind(msg) === "token_usage") deliveredUsage += 1;
              cb(msg);
            }),
          listBackgroundSubagents: () => environment.listBackgroundSubagents(),
          abortBackgroundSubagentRun: (id) => environment.abortBackgroundSubagentRun(id),
          async *run(_input, { signal }) {
            parentStarted.resolve();
            yield requestBegin();
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener("abort", () => resolve(), { once: true });
            });
            parentStopped.resolve();
            await releaseParent.promise;
          },
        }),
        { projectId, createdAt: "2026-01-01T00:00:00.000Z" },
      );
      t.deps.sessionsRepo.insert(
        sessionRow(childId, {
          projectId,
          modelId: "gpt-test",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      );
      const parentWriter = new Writer({
        tracesDir: tracesDir(t.root, projectId, "default_agent"),
        sessionId: parentId,
      });
      await parentWriter.write(sessionMeta({ ...meta, session_id: parentId, source: "user" }));
      await parentWriter.write(subagentEvent(childId));
      for await (const record of environment.executeTool({
        toolCall: toolCall({
          name: "run_subagent",
          toolCallId: "spawn",
          arguments: JSON.stringify({ prompt: "work", run_in_background: true }),
        }),
      }))
        void record;
      if (scenario === "removed-child-active-parent") {
        await t.deps.manager.startTask(parentId, [userText("parent work")]);
        await parentStarted.promise;
      }
    }
    await textWriting.promise;
    expect(providerCompleted).toBe(true);
    if (scenario === "reloaded-recreated-project") {
      t.deps.manager.invalidateAgentRuntimes(projectId, "default_agent");
      await t.deps.manager.preload(parentId);
    }
    const published: AmspRecord[] = [];
    const unsubscribe = t.deps.channels.get(parentId).subscribe((event) => {
      if (!event.event) published.push(JSON.parse(event.data) as AmspRecord);
    });
    try {
      if (scenario !== "live-child") {
        if (removeProject) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        deletion = Promise.resolve(
          api.delete(
            removeProject && scenario !== "removed-session-then-project"
              ? `/api/projects/${projectId}`
              : `/api/sessions/${parentId}`,
          ),
        );
        if (scenario === "removed-child-active-parent") await parentStopped.promise;
        else if (!main) await disposed.promise;
        else await waitFor(() => requestSignal?.aborted === true);
      }
      if (removeProject) {
        await vi.advanceTimersByTimeAsync(5000);
        expect((await deletion!).status).toBe(204);
        if (scenario === "removed-session-then-project")
          expect((await api.delete(`/api/projects/${projectId}`)).status).toBe(204);
        vi.useRealTimers();
        if (scenario === "recreated-project" || scenario === "reloaded-recreated-project") {
          expect(
            (await api.post("/api/projects", { projectId, name: "New lifetime" })).status,
          ).toBe(201);
        }
      }
      published.length = 0;
      releaseText.resolve();
      if (!main) await childFinished.promise;
      if (scenario === "removed-child-active-parent") {
        expect(deliveredUsage).toBe(1);
        releaseParent.resolve();
      }
      if (deletion) expect((await deletion).status).toBe(204);
      else await waitFor(() => tracedUsage.length === 1);
      expect(requests).toBe(1);
      // Project deletion also removes the Trace directory; only retained Projects can write it.
      expect(tracedUsage).toEqual(removeProject ? [] : [12]);
      if (!main && !removeProject) expect(deliveredUsage).toBe(1);
      const childMessages = published.filter((msg) => msg.origin?.includes(childId));
      if (scenario === "live-child")
        expect(childMessages.some((msg) => kind(msg) === "token_usage")).toBe(true);
      else if (!main) expect(childMessages).toEqual([]);
      const rows = t.deps.db
        .prepare("SELECT total, model_id FROM usage_records WHERE session_id = ?")
        .all(parentId);
      expect(rows).toEqual(removeProject ? [] : [{ total: 12, model_id: "gpt-test" }]);
    } finally {
      vi.useRealTimers();
      unsubscribe();
      releaseText.resolve();
      releaseParent.resolve();
      if (deletion) await deletion;
      env?.dispose();
    }
  },
);
