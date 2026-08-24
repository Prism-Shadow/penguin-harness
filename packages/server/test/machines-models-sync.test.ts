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

  it("points the machine's default at ours, even when it already had one", () => {
    // A Project with this id over there IS this Project. A default left pointing elsewhere is
    // how a Session started without an explicit model quietly runs on the wrong one — and a
    // freshly created Project is always seeded with a default, so "only if it has none" would
    // never once have fired.
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
    // Unsatisfiable, so left as theirs: omitting the field is what keeps their value, and
    // naming a pair we are not sending would be rejected by the endpoint anyway.
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
      projects: ["default_project", "theirs-only"],
      loadLocal: async (projectId) =>
        projectId === "default_project" ? { models: [local()] } : null,
    });
    expect(outcome).toEqual({ kind: "synced", projects: ["default_project"], created: [] });
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
      projects: ["default_project", "theirs-only"],
      loadLocal: async () => ({ models: [] }),
    });
    expect(outcome).toEqual({ kind: "synced", projects: [], created: [] });
    expect(machine.puts).toHaveLength(0);
  });

  it("writes only to the Projects entitled to that machine", async () => {
    const machine = fakeMachine({
      ...projects,
      "/api/projects/default_project/models": { status: 200, body: remoteTable() },
      "/api/projects/theirs-only/models": { status: 200, body: remoteTable() },
    });
    await syncModelsToMachine({
      api: machine.api,
      loadLocal: async () => ({ models: [local()] }),
      projects: ["theirs-only"],
    });
    expect(machine.puts.map((p) => p.path)).toEqual(["/api/projects/theirs-only/models"]);
  });

  it("creates an entitled Project the machine does not have, then fills it", async () => {
    const machine = fakeMachine({
      ...projects,
      "/api/projects/newcomer/models": { status: 200, body: remoteTable() },
    });
    const outcome = await syncModelsToMachine({
      api: machine.api,
      projects: ["newcomer"],
      loadLocal: async () => ({ models: [local()], name: "Newcomer" }),
    });
    // The id is the point: a Session started on that machine sends THIS id for it to resolve,
    // so the Project over there has to be this Project, not a lookalike.
    expect(machine.calls).toContainEqual({
      method: "POST",
      path: "/api/projects",
      body: { projectId: "newcomer", name: "Newcomer" },
    });
    expect(outcome).toEqual({ kind: "synced", projects: ["newcomer"], created: ["newcomer"] });
  });

  it("does not create a Project this side has nothing to put in", async () => {
    const machine = fakeMachine(projects);
    const outcome = await syncModelsToMachine({
      api: machine.api,
      projects: ["newcomer"],
      loadLocal: async () => ({ models: [] }),
    });
    // An empty shell is not worth a directory on somebody's machine.
    expect(machine.calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(outcome).toEqual({ kind: "synced", projects: [], created: [] });
  });

  it("stops at a machine that refuses to create the Project", async () => {
    const machine = {
      ...fakeMachine(projects),
      api: {
        request: async (method: string, path: string) =>
          method === "POST"
            ? { status: 409, text: '{"error":{"message":"Project id is already taken"}}' }
            : { status: 200, text: JSON.stringify({ projects: [] }) },
      } as MachineApi,
    };
    const outcome = await syncModelsToMachine({
      api: machine.api,
      projects: ["taken"],
      loadLocal: async () => ({ models: [local()] }),
    });
    // The machine saying no is an answer about a boundary — an id already belonging to
    // somebody else's Project — and writing models around it is not ours to decide.
    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && outcome.detail).toContain("refused to create taken");
  });

  it("reports a refusal in the machine's own terms", async () => {
    const machine = fakeMachine({ "/api/projects": { status: 403, body: {} } });
    const outcome = await syncModelsToMachine({
      api: machine.api,
      projects: ["default_project"],
      loadLocal: async () => ({ models: [local()] }),
    });
    expect(outcome).toEqual({
      kind: "failed",
      detail: "it answered 403 when asked its projects",
    });
  });

  it("treats a machine whose project list it cannot read as having none", async () => {
    // An older build, or a shape this side does not know: every entitled Project then reads
    // as missing, and creating one is a request that machine can refuse for itself.
    const machine = fakeMachine({ "/api/projects": { status: 200, body: { projects: "?" } } });
    const outcome = await syncModelsToMachine({
      api: machine.api,
      projects: [],
      loadLocal: async () => ({ models: [local()] }),
    });
    expect(outcome).toEqual({ kind: "synced", projects: [], created: [] });
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
    const { server, port } = await listening(machine.app.fetch);
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
        projects: ["default_project"],
        loadLocal: async (projectId) =>
          projectId === "default_project"
            ? { models: [local({ api_key: "sk-ours-0123456789" })] }
            : null,
      });
      expect(outcome).toEqual({ kind: "synced", projects: ["default_project"], created: [] });

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
        api: machineApi(port, cookie),
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
      });

      // Created for real: the DB row, the display name, and the built-in agents a Session
      // over there will be started against — not just a directory with a config in it.
      const listed = await machine.deps.projectService.listProjects("admin");
      expect(listed.find((entry) => entry.projectId === "field_work")?.name).toBe("Field work");
      expect((await machine.deps.agentService.listAgents("field_work")).length).toBeGreaterThan(0);

      // And the id resolves the model the way a Session started from here would ask it to.
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
