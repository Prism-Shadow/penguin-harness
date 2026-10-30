/**
 * A main Task may spend time in interrupt cleanup while its background child is generating.
 * Session/Agent/Project deletion and shutdown must cancel that child's provider request before
 * waiting for the main Task, so completing a tool turn cannot open another paid request.
 * An ordinary Task stop deliberately leaves the child running and able to finish its work.
 * The provider and main Task are scripted; the child model, engine, registry and server are real.
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import {
  Session,
  Environment,
  GenerativeModel,
  Writer,
  tracesDir,
  requestBegin,
  subagentEvent,
  toolCall,
  toolCallOutput,
  userText,
  withOrigin,
  sessionMeta,
} from "@prismshadow/penguin-core";
import type { SubagentHandle, SessionMetaPayload } from "@prismshadow/penguin-core";
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
let t: TestApp;
let api: ReturnType<typeof apiClient>;
const projectId = "owner-default_project";
beforeAll(async () => {
  t = await createTestApp();
  api = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
});
afterAll(async () => {
  await t.cleanup();
});

it.each(["session", "agent", "project", "task", "shutdown"] as const)(
  "%s respects child lifetime while main Task cleanup is blocked",
  async (scope) => {
    const parentId = uniqueSessionId();
    const childId = uniqueSessionId();
    const finishFirst = gate();
    const firstStarted = gate();
    const runFinished = gate();
    const parentStopped = gate();
    const parentStarted = gate();
    const releaseParent = gate();
    const childDone = gate();
    let requests = 0;
    let upstreamSignal: AbortSignal | undefined;
    class Model extends GenerativeModel {
      constructor() {
        super({
          modelId: "gpt-test",
          apiKey: "test-key",
          clientType: "openai-chat",
          tools: [],
          requestTimeoutMs: 0,
        });
      }
      protected override async *openStream(_message: unknown, signal: AbortSignal) {
        upstreamSignal = signal;
        requests += 1;
        if (requests === 1) {
          firstStarted.resolve();
          await Promise.race([
            finishFirst.promise,
            new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener("abort", () => resolve(), { once: true });
            }),
          ]);
          if (signal.aborted) return;
          yield {
            role: "assistant" as const,
            event_type: "delta" as const,
            content_items: [
              {
                type: "tool_call.done" as const,
                name: "probe_tool",
                arguments: {},
                tool_call_id: "probe_call",
              },
            ],
            usage_metadata: null,
            finish_reason: null,
          };
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
            finish_reason: "tool_call" as const,
          };
        } else {
          yield {
            role: "assistant" as const,
            event_type: "delta" as const,
            content_items: [
              { type: "text.done" as const, text: "second request completed after deletion" },
            ],
            usage_metadata: null,
            finish_reason: null,
          };
          yield {
            role: "assistant" as const,
            event_type: "stop" as const,
            content_items: [],
            usage_metadata: {
              cached_tokens: 0,
              prompt_tokens: 3,
              response_tokens: 1,
              thoughts_tokens: 0,
            },
            finish_reason: "stop" as const,
          };
        }
      }
    }
    const child = new Session({
      meta: {
        session_id: childId,
        provider: "custom",
        model_id: "gpt-test",
        model_context_window: 10000,
        system_prompt: "test",
        workspace: t.root,
        agent_state: t.root,
        source: "subagent",
      },
      bootstrap: async () => ({ llm: new Model() }),
      imagesDir: t.root,
      modelHasVision: true,
      environment: {
        listTools: async () => [],
        toolPermission: () => "r",
        async *executeTool({ toolCall: call }) {
          yield toolCallOutput({
            output: "done",
            toolCallId: call.payload.tool_call_id,
            status: "completed",
          });
        },
        dispose: () => {
          childDone.resolve();
        },
      },
    });
    const handle: SubagentHandle = {
      sessionId: childId,
      async *run({ messages, signal }) {
        const run = child.run(messages, { signal, approve: async () => "allow" });
        for (;;) {
          const next = await run.next();
          if (next.done) {
            runFinished.resolve();
            return next.value;
          }
          yield withOrigin(next.value, childId);
        }
      },
      dispose: () => {
        child.dispose();
      },
    };
    const env = new Environment({
      workspaceDir: t.root,
      toolConfig: {
        customTools: [{ name: "run_subagent", description: "test", permission: "rw" }],
        mcpServers: [],
      },
      services: { subagentRunner: { spawn: async () => handle } },
    });
    adoptSession(
      t.deps,
      fakeSession(parentId, {
        dispose: () => env.dispose(),
        onBackgroundMessage: (cb) => env.setBackgroundMessageListener(cb),
        listBackgroundSubagents: () => env.listBackgroundSubagents(),
        abortBackgroundSubagentRun: (id) => env.abortBackgroundSubagentRun(id),
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
      sessionRow(childId, { projectId, createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    const writer = new Writer({
      tracesDir: tracesDir(t.root, projectId, "default_agent"),
      sessionId: parentId,
    });
    await writer.write(
      sessionMeta({
        ...(child.metaMessage.payload as SessionMetaPayload),
        session_id: parentId,
        source: "user",
      }),
    );
    await writer.write(subagentEvent(childId));
    for await (const record of env.executeTool({
      toolCall: toolCall({
        name: "run_subagent",
        toolCallId: "spawn",
        arguments: JSON.stringify({ prompt: "work", run_in_background: true }),
      }),
    }))
      void record;
    await firstStarted.promise;
    await t.deps.manager.startTask(parentId, [userText("parent task")]);
    await parentStarted.promise;
    const closing =
      scope === "session"
        ? api.delete(`/api/sessions/${parentId}`)
        : scope === "agent"
          ? Promise.all(t.deps.manager.beginAgentDeletion(projectId, "default_agent"))
          : scope === "project"
            ? Promise.all(t.deps.manager.abortProject(projectId))
            : scope === "shutdown"
              ? t.deps.manager.shutdown()
              : Promise.resolve(t.deps.manager.abortTask(parentId));
    try {
      await parentStopped.promise;
      const cancelledBeforeCleanup = upstreamSignal?.aborted;
      // The main Task remains gated. A child not cancelled here can run the tool and request
      // another model turn, including after a deletion's bounded wait has expired.
      finishFirst.resolve();
      await runFinished.promise;
      expect(requests).toBe(scope === "task" ? 2 : 1);
      expect(cancelledBeforeCleanup).toBe(scope !== "task");
    } finally {
      releaseParent.resolve();
      finishFirst.resolve();
      const result = await closing;
      if (scope === "session") expect((result as Response).status).toBe(204);
      env.dispose();
      await childDone.promise;
      await waitFor(() => t.deps.manager.statusOf(parentId) === "idle");
      t.deps.manager.endAgentDeletion(projectId, "default_agent");
    }
  },
);
