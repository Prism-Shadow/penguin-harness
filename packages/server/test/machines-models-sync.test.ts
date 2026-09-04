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
import { planModelSync, syncModelsToMachine } from "../src/machines/models-sync.js";
import type { LocalModels } from "../src/machines/models-sync.js";
import { machineApi } from "../src/machines/machine-api.js";
import type { MachineApi } from "../src/machines/machine-api.js";
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

/**
 * Serves an app on a free port. Port 0: the OS picks one, so this never has to guess on a
 * shared machine — and the address is only known once it is listening, which serve() reports
 * through its callback rather than from a synchronous address().
 */
function listening(
  fetch: Parameters<typeof serve>[0]["fetch"],
): Promise<{ server: ReturnType<typeof serve>; port: number }> {
  return new Promise((resolve) => {
    const started = serve({ fetch, port: 0, hostname: "127.0.0.1" }, (info) =>
      resolve({ server: started, port: (info as AddressInfo).port }),
    );
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
    expect(theirs).toBeDefined();
    expect(theirs?.contextWindow).toBe(200000);
    expect(theirs?.baseUrl).toBe("https://theirs.example");
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
    const plan = planModelSync(
      { models: [local({ api_key: undefined, base_url: "https://gw.example" })] },
      remoteTable(),
    );
    expect(plan.models[0]).not.toHaveProperty("apiKey");
    expect(plan.models[0]).not.toHaveProperty("clearApiKey");
    expect(plan.models[0]?.baseUrl).toBe("https://gw.example");
  });

  it("points the machine's default at ours, even when it already had one", () => {
    const mine: LocalModels = {
      models: [local()],
      defaultModel: { provider: "deepseek", model_id: "deepseek-v4-flash" },
    };
    const theirs = { provider: "anthropic", modelId: "claude-opus-5" };
    const ours = { provider: "deepseek", modelId: "deepseek-v4-flash" };
    expect(planModelSync(mine, remoteTable({ defaultModel: theirs })).defaultModel).toEqual(ours);
    expect(planModelSync(mine, remoteTable()).defaultModel).toEqual(ours);
  });

  it("does not name a pointer that is not in the table it sends", () => {
    const plan = planModelSync(
      {
        models: [local()],
        defaultModel: { provider: "openai", model_id: "gpt-5" },
        visionModel: { provider: "openai", model_id: "gpt-5" },
      },
      remoteTable(),
    );
    expect(plan.defaultModel).toBeUndefined();
    expect(plan.visionModel).toBeUndefined();
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
      postBytes: async () => ({ status: 500, text: "not used by the model sync" }),
      request: async (method, path, body) => {
        calls.push({ method, path, ...(body === undefined ? {} : { body }) });
        if (method === "PUT") {
          puts.push({ path, body: body as ModelsUpdateRequest });
          return { status: 200, text: "{}" };
        }
        // A method-qualified key wins, so a POST can be scripted apart from the GET of one path.
        const answer = answers[`${method} ${path}`] ?? answers[path];
        if (answer === undefined) return { status: 404, text: "{}" };
        return { status: answer.status, text: JSON.stringify(answer.body) };
      },
    },
  };
}

describe("syncModelsToMachine, against a scripted machine", () => {
  it("a Project the machine refuses is reported and skipped; the ones after it are still written", async () => {
    const machine = fakeMachine({
      "/api/projects": { status: 200, body: { projects: [{ projectId: "default_project" }] } },
      "/api/projects/default_project/models": { status: 200, body: remoteTable() },
      "/api/projects/alice-lab/models": { status: 200, body: remoteTable() },
      // The machine's own rule: an admin-created id may not carry the namespace hyphen.
      "POST /api/projects": { status: 400, body: { error: { code: "invalid_project_id" } } },
    });
    const outcome = await syncModelsToMachine({
      api: machine.api,
      projects: ["alice-lab", "default_project"],
      loadLocal: async () => ({ models: [local()] }),
    });
    expect(outcome).toEqual({
      kind: "synced",
      projects: ["default_project"],
      created: [],
      refused: [
        { projectId: "alice-lab", detail: expect.stringContaining("refused to create alice-lab") },
      ],
    });
    expect(machine.puts.map((p) => p.path)).toEqual(["/api/projects/default_project/models"]);
  });

  it("the channel giving out fails the sync as a whole — nothing after it would fare better", async () => {
    const api: MachineApi = {
      postBytes: async () => ({ status: 500, text: "" }),
      request: async (method, path) => {
        if (path === "/api/projects") {
          return { status: 200, text: JSON.stringify({ projects: [{ projectId: "a" }] }) };
        }
        if (method === "GET") throw new Error("the machine's server closed mid-answer");
        return { status: 200, text: "{}" };
      },
    };
    const outcome = await syncModelsToMachine({
      api,
      projects: ["a", "b"],
      loadLocal: async () => ({ models: [local()] }),
    });
    expect(outcome).toEqual({ kind: "failed", detail: "the machine's server closed mid-answer" });
  });
});

describe("machineApi", () => {
  it("rejects, rather than hangs, when the machine closes the answer before its body", async () => {
    // Headers, part of a body, then the socket closes: `end` never fires, `close` does.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "content-length": "100" });
      res.write('{"partial":');
      setTimeout(() => res.socket?.destroy(), 20);
    });
    const port = await new Promise<number>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
    );
    try {
      const api = machineApi(new http.Agent(), port, "penguin_session=x");
      await expect(api.request("GET", "/api/projects")).rejects.toThrow(
        /closed mid-answer|socket hang up|aborted/,
      );
    } finally {
      server.close();
    }
  });
});

describe("syncModelsToMachine, against a running server", () => {
  it("lands our key on it and leaves its own entry intact", async () => {
    const machine = await createTestApp();
    const { server, port } = await listening(machine.app.fetch);
    try {
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
        api: machineApi(new http.Agent(), port, cookie),
        projects: ["default_project"],
        loadLocal: async (projectId) =>
          projectId === "default_project"
            ? { models: [local({ api_key: "sk-ours-0123456789" })] }
            : null,
      });
      expect(outcome).toEqual({
        kind: "synced",
        projects: ["default_project"],
        created: [],
        refused: [],
      });

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

  it("creates the Project over there under the same id, and it works", async () => {
    const machine = await createTestApp();
    const { server, port } = await listening(machine.app.fetch);
    try {
      const login = await post(port, "/api/auth/login", {
        userId: "admin",
        password: machine.adminPassword,
      });
      const cookie = login.setCookie.map((line) => line.split(";")[0]?.trim() ?? "").join("; ");

      const outcome = await syncModelsToMachine({
        api: machineApi(new http.Agent(), port, cookie),
        projects: ["field_work"],
        loadLocal: async () => ({
          models: [local({ api_key: "sk-ours-0123456789" })],
          defaultModel: { provider: "deepseek", model_id: "deepseek-v4-flash" },
          name: "Field work",
        }),
      });
      expect(outcome).toEqual({
        kind: "synced",
        projects: ["field_work"],
        created: ["field_work"],
        refused: [],
      });

      const listed = await machine.deps.projectService.listProjects("admin");
      expect(listed.find((entry) => entry.projectId === "field_work")?.name).toBe("Field work");
      expect((await machine.deps.agentService.listAgents("field_work")).length).toBeGreaterThan(0);

      const config = await machine.deps.projectConfigService.loadConfig("field_work");
      expect(config.default_model).toEqual({ provider: "deepseek", model_id: "deepseek-v4-flash" });
      expect(config.models.find((m) => m.model_id === "deepseek-v4-flash")?.api_key).toBe(
        "sk-ours-0123456789",
      );
    } finally {
      server.close();
      await machine.cleanup();
    }
  });
});
