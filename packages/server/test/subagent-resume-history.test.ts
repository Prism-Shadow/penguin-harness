import type { AmspRecord } from "@prismshadow/penguin-core";
import { expect, it } from "vitest";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  provisionUser,
  restartTestApp,
  writeTraceFile,
} from "./helpers.js";
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

it("addresses and stops original child Sessions by true ID across authorized parents and a cold restart", async () => {
  const pending = new Map<string, { name: string; args: Record<string, unknown> }>();
  let deletedInputs = 0;
  const provider = await startMmspServer((request) => {
    const last = request.messages.at(-1);
    const texts = last?.content_items.map((item) => item.text ?? "").join(" ") ?? "";
    if (texts.trim() === "MUST_NOT_RECREATE_THE_CHILD") deletedInputs++;
    if (/^HOLD_UNTIL_ABORT_[A-Z0-9_]+$/.test(texts.trim())) return { hang: true };
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
    async function task(key: string, name: string, args: Record<string, unknown>, from = url) {
      pending.set(key, { name, args });
      const res = await client.post(from + "/tasks", { input: [{ type: "text", text: key }] });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      await expect
        .poll(
          async () => ({
            pending: pending.has(key),
            status: ((await (await client.get(from)).json()) as { session: { status: string } })
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
      .map((p) => /with subagent_id ([0-9a-f]{8});/.exec(p.output ?? "")?.[1])
      .filter((h): h is string => !!h);
    expect(handles).toHaveLength(2);
    const ids = initial.map((item) => item.sessionId).reverse();
    expect(handles).toEqual(ids.map((id) => id.slice(-8)));
    async function deliver(step: string, index: number) {
      const marker = "DELIVERY_" + step;
      await task("PARENT_" + step, "input_subagent", {
        subagent_id: step === "FULL_ID" ? ids[index] : handles[index],
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
    const other = await client.post("/api/projects/" + project + "/agents/" + agent + "/sessions", {
      approvalMode: "allow-all",
    });
    expect(other.status).toBe(201);
    const otherId = ((await other.json()) as { session: { sessionId: string } }).session.sessionId;
    async function fromOtherParent(address: string, marker: string) {
      await task(
        "ACCESS_" + marker,
        "input_subagent",
        {
          subagent_id: address,
          prompt: marker,
          yield_time_ms: 1000,
        },
        "/api/sessions/" + otherId,
      );
      await expect
        .poll(
          async () =>
            payloads(await trace(ids[0]!)).some(
              (r) => r.role === "assistant" && r.text?.includes(marker),
            ),
          { timeout: 5000 },
        )
        .toBe(true);
      expect(JSON.stringify(await trace(ids[1]!))).not.toContain(marker);
    }
    await fromOtherParent(ids[0]!.slice(-8), "DELIVERY_FROM_SECOND_PARENT");
    for (const [i, id] of ids.entries()) {
      await task(
        "HOLD_MANAGED_" + i,
        "input_subagent",
        {
          subagent_id: id,
          prompt: "HOLD_UNTIL_ABORT_" + i,
          yield_time_ms: 250,
        },
        url,
      );
    }
    const managed = () =>
      host.deps.manager
        .subagentsOf(parent)
        .filter((item) => item.running)
        .map((item) => item.sessionId)
        .sort();
    expect(managed()).toEqual([...ids].sort());
    // A credential change replaces the parent's runtime while its two live child requests
    // remain with the original owner. Both the tool and the panel must still target it.
    host.deps.manager.invalidateProjectRuntimes(project);
    await host.deps.manager.preload(parent);
    expect(managed()).toEqual([...ids].sort());
    await task(
      "STOP_FROM_OTHER_PARENT",
      "input_subagent",
      { subagent_id: ids[0]!.slice(-8), abort: true, yield_time_ms: 250 },
      "/api/sessions/" + otherId,
    );
    await expect.poll(managed).toEqual([ids[1]]);
    expect((await client.post(url + "/subagents/" + ids[1] + "/abort", {})).status).toBe(202);
    await deliver("WARM", 0);
    client = apiClient(host.app, (await loginAdmin(host.app)).cookie);
    await deliver("RECONNECT", 1);
    host = await restartTestApp(host);
    client = apiClient(host.app, (await loginAdmin(host.app)).cookie);
    const direct = "/api/sessions/" + ids[0];
    expect(
      (
        await client.post(direct + "/tasks", {
          input: [{ type: "text", text: "HOLD_UNTIL_ABORT_STANDALONE" }],
        })
      ).status,
    ).toBeLessThan(300);
    await expect.poll(() => host.deps.manager.statusOf(ids[0]!)).toBe("running");
    await task(
      "STOP_STANDALONE",
      "input_subagent",
      { subagent_id: ids[0], abort: true, yield_time_ms: 250 },
      "/api/sessions/" + otherId,
    );
    await expect.poll(() => host.deps.manager.statusOf(ids[0]!)).toBe("idle");
    expect(
      (
        await client.post(direct + "/tasks", {
          input: [{ type: "text", text: "HOLD_UNTIL_ABORT_PANEL" }],
        })
      ).status,
    ).toBeLessThan(300);
    expect((await client.post(url + "/subagents/" + ids[0] + "/abort", {})).status).toBe(202);
    await expect.poll(() => host.deps.manager.statusOf(ids[0]!)).toBe("idle");
    expect(await roster()).toEqual(initial);
    await deliver("AFTER_RESTART", 0);
    await deliver("SECOND_CHILD", 1);
    await deliver("FULL_ID", 0);
    await fromOtherParent(ids[0]!, "DELIVERY_AFTER_COLD_REOPEN");
    expect(await roster()).toEqual(initial);

    const outsider = apiClient(host.app, (await provisionUser(host.app, "address_visitor")).cookie);
    expect((await outsider.get(direct)).status).toBe(404);
    const foreignProject = "address_visitor-default_project";
    const configured = await outsider.put("/api/projects/" + foreignProject + "/models", {
      providers: { custom: { clientType: "mmsp", baseUrl: provider.baseUrl, apiKey: "fixture" } },
      models: [model],
      defaultModel: model,
    });
    expect(configured.status).toBe(200);
    const foreign = await outsider.post(
      "/api/projects/" + foreignProject + "/agents/" + agent + "/sessions",
      { approvalMode: "allow-all" },
    );
    const foreignId = ((await foreign.json()) as { session: { sessionId: string } }).session
      .sessionId;
    pending.set("VISITOR_ACCESS", {
      name: "input_subagent",
      args: { subagent_id: ids[0], prompt: "DELIVERY_FORBIDDEN", yield_time_ms: 250 },
    });
    await outsider.post("/api/sessions/" + foreignId + "/tasks", {
      input: [{ type: "text", text: "VISITOR_ACCESS" }],
    });
    await expect
      .poll(() => ({
        called: !pending.has("VISITOR_ACCESS"),
        state: host.deps.manager.statusOf(foreignId),
      }))
      .toEqual({ called: true, state: "idle" });
    expect(JSON.stringify(await trace(ids[0]!))).not.toContain("DELIVERY_FORBIDDEN");
    expect(
      payloads(await host.deps.traceService.readMessages(foreignProject, agent, foreignId)).some(
        (item) => item.output?.includes("unknown subagent_id"),
      ),
    ).toBe(true);
    await task(
      "ORDINARY_SESSION_IS_NOT_A_CHILD",
      "input_subagent",
      { subagent_id: parent, prompt: "NO_ORDINARY_DELIVERY", yield_time_ms: 250 },
      "/api/sessions/" + otherId,
    );
    expect(
      payloads(await trace(otherId)).some((p) => p.output?.includes("unknown subagent_id")),
    ).toBe(true);
    const real = host.deps.sessionsRepo.findById(ids[0]!)!;
    const sameSuffix = "session-2010-01-01-00-00-00-" + ids[0]!.slice(-8);
    host.deps.sessionsRepo.insert({ ...real, sessionId: sameSuffix });
    const original = await trace(ids[0]!);
    const head = original.find((record) => record.type === "session_meta")!;
    await writeTraceFile(host.root, project, agent, "2010-01-01", sameSuffix, 1, [
      { ...head, payload: { ...head.payload, session_id: sameSuffix } } as AmspRecord,
    ]);
    await task(
      "COLLIDING_SUFFIX",
      "input_subagent",
      { subagent_id: ids[0]!.slice(-8), prompt: "NO_AMBIGUOUS_DELIVERY", yield_time_ms: 250 },
      "/api/sessions/" + otherId,
    );
    expect(
      payloads(await trace(otherId)).some((p) => p.output?.includes("Ambiguous Session suffix")),
    ).toBe(true);
    expect(JSON.stringify(await trace(ids[0]!))).not.toContain("NO_AMBIGUOUS_DELIVERY");
    expect(JSON.stringify(await trace(sameSuffix))).not.toContain("NO_AMBIGUOUS_DELIVERY");
    await fromOtherParent(ids[0]!.slice(-19), "DELIVERY_LONG_SUFFIX");
    // Fork at a real completed reply after both delegations. Its copied history still
    // describes those children, but only the original parent owns their conversations.
    const file = (await host.deps.traceService.listTraceFiles(project, agent, parent)).at(-1)!;
    const { events } = await host.deps.traceService.readEvents(
      project,
      agent,
      parent,
      file.index,
      0,
      1000,
    );
    const ordinal = events.findLastIndex(
      (record) =>
        record.type === "model_msg" &&
        !record.origin?.length &&
        (record.payload as { role?: string }).role === "assistant" &&
        typeof (record.payload as { text?: string }).text === "string",
    );
    expect(ordinal).toBeGreaterThan(0);
    const forked = await client.post(url + "/fork", {
      position: { fileIndex: file.index, ordinal },
    });
    expect(forked.status, await forked.clone().text()).toBe(201);
    const forkId = ((await forked.json()) as { session: { sessionId: string } }).session.sessionId;
    expect(JSON.stringify(await trace(forkId))).toContain(ids[0]);
    const forkRoster = await client.get("/api/sessions/" + forkId + "/subagents");
    expect(forkRoster.status).toBe(200);
    expect(await forkRoster.json()).toEqual({ items: [], nextCursor: null });
    expect(await roster()).toEqual(initial);
    // A live parent's remembered child cannot supersede the authenticated Session index
    // after an explicit deletion. Do not run or register the old object again.
    const removed = ids[1]!;
    expect((await client.delete("/api/sessions/" + removed)).status).toBe(204);
    await task("DELETED_CHILD", "input_subagent", {
      subagent_id: removed,
      prompt: "MUST_NOT_RECREATE_THE_CHILD",
      yield_time_ms: 250,
    });
    expect(host.deps.sessionsRepo.findById(removed)).toBeFalsy();
    expect(deletedInputs).toBe(0);
    expect(
      payloads(await trace(parent)).some((item) =>
        item.output?.includes("unknown subagent_id " + removed),
      ),
    ).toBe(true);
  } finally {
    await host.cleanup();
    await provider.close();
  }
}, 45000);
