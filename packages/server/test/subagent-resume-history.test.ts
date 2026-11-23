import type { AmspRecord } from "@prismshadow/penguin-core";
import { expect, it } from "vitest";
import { apiClient, createTestApp, loginAdmin, restartTestApp } from "./helpers.js";
import { startMmspServer, textReply } from "./fixtures/mmsp-server.js";

function payloads(records: readonly AmspRecord[]) {
  return records
    .filter((record) => record.type === "model_msg" && !record.origin?.length)
    .map(
      (record) => record.payload as { type: string; role?: string; text?: string; output?: string },
    );
}
const project = "default_project";
const agent = "default_agent";
const usage = { prompt_tokens: 4, cached_tokens: 0, response_tokens: 4, thoughts_tokens: 0 };

it("keeps prior children addressable by their issued handles after reconnect and after a complete host restart", async () => {
  const pending = new Map<string, { name: string; args: Record<string, unknown> }>();
  const provider = await startMmspServer((request) => {
    const last = request.messages.at(-1);
    const texts = last?.content_items.map((item) => item.text ?? "").join(" ") ?? "";
    for (const [key, tool] of pending) {
      if (texts.trim() !== key || !request.config.tools) continue;
      pending.delete(key);
      return {
        events: [
          {
            role: "assistant",
            event_type: "delta",
            content_items: [
              {
                type: "tool_call.done",
                name: tool.name,
                tool_call_id: key,
                arguments: JSON.stringify(tool.args),
              },
            ],
            usage_metadata: null,
            finish_reason: null,
          },
          {
            role: "assistant",
            event_type: "stop",
            content_items: [],
            usage_metadata: usage,
            finish_reason: "tool_call",
          },
        ],
      };
    }
    return textReply(
      texts.includes("DELIVERY") ? "Child acknowledged " + texts : "Task complete",
      usage,
    );
  });
  let host = await createTestApp({ durableDatabase: true });
  let client = apiClient(host.app, (await loginAdmin(host.app)).cookie);
  try {
    const model = { provider: "custom", modelId: "test-child-model", contextWindow: 100000 };
    const config = await client.put("/api/projects/" + project + "/models", {
      providers: { custom: { clientType: "mmsp", baseUrl: provider.baseUrl, apiKey: "fixture" } },
      models: [model],
      defaultModel: model,
    });
    expect(config.status, await config.clone().text()).toBe(200);
    const created = await client.post(
      "/api/projects/" + project + "/agents/" + agent + "/sessions",
      { approvalMode: "allow-all" },
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const parent = ((await created.json()) as { session: { sessionId: string } }).session.sessionId;
    const url = "/api/sessions/" + parent;
    async function task(key: string, name: string, args: Record<string, unknown>) {
      pending.set(key, { name, args });
      const res = await client.post(url + "/tasks", { input: [{ type: "text", text: key }] });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      await expect
        .poll(
          async () => ({
            pending: pending.has(key),
            status: ((await (await client.get(url)).json()) as { session: { status: string } })
              .session.status,
          }),
          { timeout: 10000 },
        )
        .toEqual({ pending: false, status: "idle" });
    }
    async function roster() {
      const response = await client.get(url + "/subagents");
      expect(response.status).toBe(200);
      return ((await response.json()) as { items: Array<{ sessionId: string; turnKey: string }> })
        .items;
    }
    async function trace(sid: string) {
      return host.deps.traceService.readMessages(project, agent, sid);
    }
    for (const key of ["SPAWN_ONE", "SPAWN_TWO"])
      await task(key, "run_subagent", { prompt: "Check the notes", run_in_background: true });
    const initial = await roster();
    expect(initial, JSON.stringify(payloads(await trace(parent)))).toHaveLength(2);
    expect(initial[0]!.turnKey).not.toBe(initial[1]!.turnKey);
    const parentTrace = await trace(parent);
    const handles = payloads(parentTrace)
      .filter((p) => p.type === "tool_call_output")
      .map((p) => /with subagent_id (subagent-[a-f0-9]+);/.exec(p.output ?? "")?.[1])
      .filter((h): h is string => !!h);
    expect(handles).toHaveLength(2);
    const ids = initial.map((item) => item.sessionId).reverse();
    async function deliver(step: string, index: number) {
      const marker = "DELIVERY_" + step;
      await task("PARENT_" + step, "input_subagent", {
        subagent_id: handles[index],
        prompt: marker,
        yield_time_ms: 1000,
      });
      const actual = await trace(ids[index]!);
      expect(payloads(actual).some((r) => r.role === "user" && r.text?.includes(marker))).toBe(
        true,
      );
      expect(payloads(actual).some((r) => r.role === "assistant" && r.text?.includes(marker))).toBe(
        true,
      );
      expect(JSON.stringify(await trace(ids[1 - index]!))).not.toContain(marker);
    }
    await deliver("WARM", 0);
    client = apiClient(host.app, (await loginAdmin(host.app)).cookie);
    await deliver("RECONNECT", 1);
    host = await restartTestApp(host);
    client = apiClient(host.app, (await loginAdmin(host.app)).cookie);
    expect(await roster()).toEqual(initial);
    await deliver("AFTER_RESTART", 0);
    await deliver("SECOND_CHILD", 1);
    expect(await roster()).toEqual(initial);
  } finally {
    await host.cleanup();
    await provider.close();
  }
}, 45000);
