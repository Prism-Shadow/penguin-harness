/**
 * Giving a machine the Model credentials its Agents need (machines/models-sync.ts).
 *
 * The whole feature rests on one asymmetry of the models endpoint: a PUT replaces the whole
 * table, and an entry sent WITHOUT `apiKey` keeps the key already stored. Every test that
 * matters here is about that — a merge that forgets to re-send a machine's own entries
 * deletes them, and one that re-sends the masked key it just read overwrites a working
 * credential with `sk-1…abcd`. Neither failure says anything at the time; both are found
 * later, by the machine, as an auth error.
 *
 * The machine's API is faked. What travels between the two servers is HTTP through a tunnel
 * that already exists, so there is nothing ssh-shaped left to exercise at this level.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { ModelEntry } from "@prismshadow/penguin-core";
import type { ModelsResponse, ModelsUpdateRequest } from "../src/api/types.js";
import { machineApi, planModelSync, syncModelsToMachine } from "../src/machines/models-sync.js";
import type { LocalModels, MachineApi } from "../src/machines/models-sync.js";
import { createTestApp } from "./helpers.js";

/**
 * One POST to the machine under test. node:http with an explicit Host header, for the reason
 * machineApi gives: the API answers only under the canonical app host while the connection
 * goes to 127.0.0.1, and fetch will not let that header be set.
 */
function post(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          host: `localhost:${port}`,
          "content-type": "application/json",
          "content-length": String(payload.length),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, setCookie: res.headers["set-cookie"] ?? [] }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const local = (over: Partial<ModelEntry> = {}): ModelEntry => ({
  provider: "deepseek",
  model_id: "deepseek-v4-flash",
  api_key: "sk-local-0123456789",
  ...over,
});

/** What that machine's GET answers: keys masked, exactly as the real endpoint reports them. */
const remoteTable = (over: Partial<ModelsResponse> = {}): ModelsResponse => ({
  models: [],
  ...over,
});

describe("planModelSync", () => {
  it("sends our entry with its key in plaintext", () => {
    const plan = planModelSync({ models: [local()] }, remoteTable());
    expect(plan.models).toEqual([
      { provider: "deepseek", modelId: "deepseek-v4-flash", apiKey: "sk-local-0123456789" },
    ]);
  });

  it("re-sends a machine's own entry, and never its masked key", () => {
    const plan = planModelSync(
      { models: [local()] },
      remoteTable({
        models: [
          {
            provider: "anthropic",
            modelId: "claude-opus-5",
            isDefault: false,
            contextWindow: 200000,
            credential: { apiKeyMasked: "sk-a…wxyz", baseUrl: "https://theirs.example" },
          },
        ],
      }),
    );
    const theirs = plan.models.find((m) => m.modelId === "claude-opus-5");
    // Present, so the whole-table replace does not delete it...
    expect(theirs).toBeDefined();
    expect(theirs?.contextWindow).toBe(200000);
    expect(theirs?.baseUrl).toBe("https://theirs.example");
    // ...and carrying no key, which is what makes the server keep the real one.
    expect(theirs).not.toHaveProperty("apiKey");
    expect(JSON.stringify(plan)).not.toContain("…");
  });

  it("replaces a machine's entry for the same pair with ours", () => {
    const plan = planModelSync(
      { models: [local({ api_key: "sk-newer-0123456789" })] },
      remoteTable({
        models: [
          {
            provider: "deepseek",
            modelId: "deepseek-v4-flash",
            isDefault: true,
            credential: { apiKeyMasked: "sk-o…lder" },
          },
        ],
      }),
    );
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]?.apiKey).toBe("sk-newer-0123456789");
  });

  it("omits a key we do not have, rather than clearing theirs", () => {
    // An entry configured here to read this machine's ANTHROPIC_API_KEY: the variable is not
    // ours to carry, and the machine may hold its own key for the same pair.
    const plan = planModelSync(
      { models: [local({ api_key: undefined, base_url: "https://gw.example" })] },
      remoteTable(),
    );
    expect(plan.models[0]).not.toHaveProperty("apiKey");
    expect(plan.models[0]).not.toHaveProperty("clearApiKey");
    expect(plan.models[0]?.baseUrl).toBe("https://gw.example");
  });

  it("leaves a machine's default alone and offers ours only when it has none", () => {
    const mine: LocalModels = {
      models: [local()],
      defaultModel: { provider: "deepseek", model_id: "deepseek-v4-flash" },
    };
    const theirs = { provider: "anthropic", modelId: "claude-opus-5" };
    expect(planModelSync(mine, remoteTable({ defaultModel: theirs })).defaultModel).toBeUndefined();
    expect(planModelSync(mine, remoteTable()).defaultModel).toEqual({
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
    });
  });

  it("does not name a default that is not in the table it sends", () => {
    const plan = planModelSync(
      { models: [local()], defaultModel: { provider: "openai", model_id: "gpt-5" } },
      remoteTable(),
    );
    expect(plan.defaultModel).toBeUndefined();
  });
});

/** Records every call, answering GETs from a table keyed by path. */
function fakeMachine(answers: Record<string, { status: number; body: unknown }>): {
  api: MachineApi;
  calls: Array<{ method: string; path: string; body?: unknown }>;
  puts: Array<{ path: string; body: ModelsUpdateRequest }>;
} {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const puts: Array<{ path: string; body: ModelsUpdateRequest }> = [];
  return {
    calls,
    puts,
    api: {
      request: async (method, path, body) => {
        calls.push({ method, path, ...(body === undefined ? {} : { body }) });
        if (method === "PUT") {
          puts.push({ path, body: body as ModelsUpdateRequest });
          return { status: 200, text: "{}" };
        }
        const answer = answers[path];
        if (answer === undefined) return { status: 404, text: "{}" };
        return { status: answer.status, text: JSON.stringify(answer.body) };
      },
    },
  };
}

describe("syncModelsToMachine", () => {
  const projects = {
    "/api/projects": {
      status: 200,
      body: { projects: [{ projectId: "default_project" }, { projectId: "theirs-only" }] },
    },
  };

  it("writes only the Projects both servers have", async () => {
    const machine = fakeMachine({
      ...projects,
      "/api/projects/default_project/models": { status: 200, body: remoteTable() },
      "/api/projects/theirs-only/models": { status: 200, body: remoteTable() },
    });
    const outcome = await syncModelsToMachine({
      api: machine.api,
      // "theirs-only" is a Project id this server does not have: a different Project, not a
      // missing one.
      loadLocal: async (projectId) =>
        projectId === "default_project" ? { models: [local()] } : null,
    });
    expect(outcome).toEqual({ kind: "synced", projects: ["default_project"] });
    expect(machine.puts.map((p) => p.path)).toEqual(["/api/projects/default_project/models"]);
  });

  it("never sends an empty table over a machine's models", async () => {
    const machine = fakeMachine({
      ...projects,
      "/api/projects/default_project/models": { status: 200, body: remoteTable() },
      "/api/projects/theirs-only/models": { status: 200, body: remoteTable() },
    });
    // Nothing configured here: a whole-table replace built from it would delete every model
    // that machine has.
    const outcome = await syncModelsToMachine({
      api: machine.api,
      loadLocal: async () => ({ models: [] }),
    });
    expect(outcome).toEqual({ kind: "synced", projects: [] });
    expect(machine.puts).toHaveLength(0);
  });

  it("restricts to one Project when a local config change names it", async () => {
    const machine = fakeMachine({
      ...projects,
      "/api/projects/default_project/models": { status: 200, body: remoteTable() },
      "/api/projects/theirs-only/models": { status: 200, body: remoteTable() },
    });
    await syncModelsToMachine({
      api: machine.api,
      loadLocal: async () => ({ models: [local()] }),
      only: "theirs-only",
    });
    expect(machine.puts.map((p) => p.path)).toEqual(["/api/projects/theirs-only/models"]);
  });

  it("reports a refusal in the machine's own terms", async () => {
    const machine = fakeMachine({ "/api/projects": { status: 403, body: {} } });
    const outcome = await syncModelsToMachine({
      api: machine.api,
      loadLocal: async () => ({ models: [local()] }),
    });
    expect(outcome).toEqual({
      kind: "failed",
      detail: "it answered 403 when asked its projects",
    });
  });

  it("survives an older machine that answers a shape it does not know", async () => {
    const machine = fakeMachine({ "/api/projects": { status: 200, body: { projects: "?" } } });
    const outcome = await syncModelsToMachine({
      api: machine.api,
      loadLocal: async () => ({ models: [local()] }),
    });
    expect(outcome).toEqual({ kind: "synced", projects: [] });
  });
});

/**
 * The same sync against a REAL server over a real socket — the half the fake cannot check.
 *
 * Everything between the two servers is HTTP: a Host header the API insists on, a cookie
 * built from Set-Cookie lines, and a body the models endpoint validates for itself. A merge
 * that is right in the abstract still fails if the endpoint rejects the shape it is sent, and
 * that rejection would only ever be seen on somebody's machine.
 */
describe("syncModelsToMachine, against a running server", () => {
  it("lands our key on it and leaves its own entry intact", async () => {
    const machine = await createTestApp();
    // Port 0: the OS picks a free one, so this never has to guess on a shared machine. The
    // address is only known once it is listening, which serve() reports through its callback.
    const { server, port } = await new Promise<{
      server: ReturnType<typeof serve>;
      port: number;
    }>((resolve) => {
      const started = serve({ fetch: machine.app.fetch, port: 0, hostname: "127.0.0.1" }, (info) =>
        resolve({ server: started, port: (info as AddressInfo).port }),
      );
    });
    try {
      // That machine's own model, configured over there by somebody else. Its key must come
      // through this untouched: the GET we merge from reports it masked.
      await machine.deps.projectConfigService.updateModels("default_project", {
        models: [
          { provider: "anthropic", modelId: "claude-opus-5", apiKey: "sk-theirs-9876543210" },
        ],
      });

      const login = await post(port, "/api/auth/login", {
        userId: "admin",
        password: machine.adminPassword,
      });
      expect(login.status).toBe(200);
      const cookie = login.setCookie.map((line) => line.split(";")[0]?.trim() ?? "").join("; ");

      const outcome = await syncModelsToMachine({
        api: machineApi(port, cookie),
        loadLocal: async (projectId) =>
          projectId === "default_project"
            ? { models: [local({ api_key: "sk-ours-0123456789" })] }
            : null,
      });
      expect(outcome).toEqual({ kind: "synced", projects: ["default_project"] });

      // Read from that machine's own config, plaintext: the endpoint masks, the file does not.
      const config = await machine.deps.projectConfigService.loadConfig("default_project");
      const ours = config.models.find((m) => m.model_id === "deepseek-v4-flash");
      const theirs = config.models.find((m) => m.model_id === "claude-opus-5");
      expect(ours?.api_key).toBe("sk-ours-0123456789");
      expect(theirs?.api_key).toBe("sk-theirs-9876543210");
    } finally {
      server.close();
      await machine.cleanup();
    }
  });
});
