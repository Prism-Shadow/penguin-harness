import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import type { CliCommandCode, CliCommandProgram } from "@prismshadow/penguin-core/cli";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import { PluginHost } from "../src/plugin/host.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  provisionUser,
  restartTestApp,
  tokenClient,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";
import type { PluginCliCommandRunRequest } from "../src/api/types.js";
import { validPluginCommands, runPluginCommands } from "../src/plugin/cli-commands.js";

describe("validPluginCommands", () => {
  const packageOf = (module: string) => (module.startsWith("acme") ? "@acme/plugin" : undefined);
  const warnings: string[] = [];
  const warn = (line: string) => {
    warnings.push(line);
  };

  it("keeps valid contributions", () => {
    const collected = [
      {
        id: "acme.greet",
        from: "acme.greet",
        key: "greet",
        summary: { en: "Say hello", zh: "打招呼" },
        code: { register: vi.fn() } as unknown as CliCommandCode,
      },
    ];
    warnings.length = 0;
    const result = validPluginCommands(collected, packageOf, warn);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ package: "@acme/plugin", key: "greet" });
    expect(warnings).toHaveLength(0);
  });

  it("skips contributions with no package behind them", () => {
    const collected = [
      {
        id: "orphan.cmd",
        from: "orphan",
        key: "cmd",
        summary: { en: "", zh: "" },
        code: { register: vi.fn() } as unknown as CliCommandCode,
      },
    ];
    warnings.length = 0;
    const result = validPluginCommands(collected, packageOf, warn);
    expect(result).toHaveLength(0);
    expect(warnings.some((w) => w.includes("no loaded plugin package is behind it"))).toBe(true);
  });

  it("skips contributions with invalid keys", () => {
    const collected = [
      {
        id: "acme.bad",
        from: "acme.bad",
        key: "Not Lower",
        summary: { en: "", zh: "" },
        code: { register: vi.fn() } as unknown as CliCommandCode,
      },
    ];
    warnings.length = 0;
    const result = validPluginCommands(collected, packageOf, warn);
    expect(result).toHaveLength(0);
    expect(warnings.some((w) => w.includes("acme.bad") && w.includes("skipped"))).toBe(true);
  });

  it("drops both entries when the same package contributes a key twice", () => {
    const collected = [
      {
        id: "acme.greet-1",
        from: "acme.greet",
        key: "greet",
        summary: { en: "v1", zh: "" },
        code: { register: vi.fn() } as unknown as CliCommandCode,
      },
      {
        id: "acme.greet-2",
        from: "acme.greet",
        key: "greet",
        summary: { en: "v2", zh: "" },
        code: { register: vi.fn() } as unknown as CliCommandCode,
      },
    ];
    warnings.length = 0;
    const result = validPluginCommands(collected, packageOf, warn);
    expect(result).toHaveLength(0);
    expect(
      warnings.some(
        (w) => w.includes("contributes 'greet' more than once") && w.includes("acme.greet-1"),
      ),
    ).toBe(true);
    expect(
      warnings.some(
        (w) => w.includes("contributes 'greet' more than once") && w.includes("acme.greet-2"),
      ),
    ).toBe(true);
  });

  it("keeps the same key from different packages", () => {
    const packageOf2 = (module: string) => {
      if (module.startsWith("acme")) return "@acme/plugin";
      if (module.startsWith("beta")) return "@beta/plugin";
      return undefined;
    };
    const collected = [
      {
        id: "acme.deploy",
        from: "acme.deploy",
        key: "deploy",
        summary: { en: "", zh: "" },
        code: { register: vi.fn() } as unknown as CliCommandCode,
      },
      {
        id: "beta.deploy",
        from: "beta.deploy",
        key: "deploy",
        summary: { en: "", zh: "" },
        code: { register: vi.fn() } as unknown as CliCommandCode,
      },
    ];
    warnings.length = 0;
    const result = validPluginCommands(collected, packageOf2, warn);
    expect(result).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });
});

describe("runPluginCommands", () => {
  it("prints help when args is empty", async () => {
    const code: CliCommandCode = {
      register: (node) => {
        (node as any).argument("<name>").action((name: string) => {
          process.stdout.write(`Hello, ${name}!\n`);
        });
      },
    };
    const result = await runPluginCommands(
      [{ package: "@a/x", key: "greet", summary: { en: "Say hello", zh: "打招呼" }, code }],
      { args: [], language: "en", prog: "penguin" },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("penguin");
    expect(result.stderr).toBe("");
  });

  it("localizes the description by language", async () => {
    const code: CliCommandCode = {
      register: () => {},
    };
    const resultEn = await runPluginCommands(
      [{ package: "@a/x", key: "greet", summary: { en: "Say hello", zh: "打招呼" }, code }],
      { args: [], language: "en", prog: "penguin" },
    );
    expect(resultEn.stdout).toContain("Say hello");

    const resultZh = await runPluginCommands(
      [{ package: "@a/x", key: "greet", summary: { en: "Say hello", zh: "打招呼" }, code }],
      { args: [], language: "zh", prog: "penguin" },
    );
    expect(resultZh.stdout).toContain("打招呼");
  });

  it("captures what the command writes to the process, and its exit code", async () => {
    const code: CliCommandCode = {
      register: (node) => {
        (node as any).action(() => {
          process.stdout.write("out line\n");
          process.stderr.write("err line\n");
          process.exitCode = 3;
        });
      },
    };
    const priorExitCode = process.exitCode;
    const result = await runPluginCommands(
      [{ package: "@a/x", key: "cmd", summary: { en: "", zh: "" }, code }],
      { args: ["cmd"], language: "en", prog: "penguin" },
    );
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain("out line\n");
    expect(result.stderr).toContain("err line\n");
    // The host's own streams and exit code are restored after the run.
    expect(process.exitCode).toBe(priorExitCode);
  });

  it("serializes concurrent runs so neither captures the other's output", async () => {
    const code: CliCommandCode = {
      register: (node) => {
        (node as any).argument("<tag>").action(async (tag: string) => {
          process.stdout.write(`${tag} start\n`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          process.stdout.write(`${tag} end\n`);
        });
      },
    };
    const commands = [{ package: "@a/x", key: "cmd", summary: { en: "", zh: "" }, code }];
    const [first, second] = await Promise.all([
      runPluginCommands(commands, { args: ["cmd", "one"], language: "en", prog: "penguin" }),
      runPluginCommands(commands, { args: ["cmd", "two"], language: "en", prog: "penguin" }),
    ]);
    expect(first.stdout).toBe("one start\none end\n");
    expect(second.stdout).toBe("two start\ntwo end\n");
  });

  it("reports an unknown command on stderr with exit 1", async () => {
    const code: CliCommandCode = {
      register: () => {},
    };
    const result = await runPluginCommands(
      [{ package: "@a/x", key: "greet", summary: { en: "", zh: "" }, code }],
      { args: ["typo"], language: "en", prog: "penguin" },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown command");
    expect(result.stderr).toContain("typo");
  });

  it("reports unknown options", async () => {
    const code: CliCommandCode = {
      register: (node) => {
        (node as any).action(() => {});
      },
    };
    const result = await runPluginCommands(
      [{ package: "@a/x", key: "greet", summary: { en: "", zh: "" }, code }],
      { args: ["greet", "--nope"], language: "en", prog: "penguin" },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown option");
  });

  it("catches thrown errors and reports them on stderr with exit 1", async () => {
    const code: CliCommandCode = {
      register: (node) => {
        (node as any).action(() => {
          throw new Error("boom");
        });
      },
    };
    const result = await runPluginCommands(
      [{ package: "@a/x", key: "cmd", summary: { en: "", zh: "" }, code }],
      { args: ["cmd"], language: "en", prog: "penguin" },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("boom");
  });

  it("builds a fresh program for each call", async () => {
    const calls: string[] = [];
    const code: CliCommandCode = {
      register: (node) => {
        (node as any).action(() => {
          calls.push("action");
        });
      },
    };
    const commands = [{ package: "@a/x", key: "cmd", summary: { en: "", zh: "" }, code }];
    await runPluginCommands(commands, { args: ["cmd"], language: "en", prog: "penguin" });
    await runPluginCommands(commands, { args: ["cmd"], language: "en", prog: "penguin" });
    expect(calls).toEqual(["action", "action"]);
  });
});

describe("routes (e2e)", () => {
  function createGreetPlugin(): ModuleDef {
    const manifest = parseManifest({
      name: "AcmeGreet",
      requires: {},
      provides: {},
      contributes: {
        "PluginCliCommandsProvider.commands": [
          {
            id: "acme.greet",
            key: "greet",
            summary: { en: "Say hello", zh: "打招呼" },
          },
        ],
      },
      children: [],
    });
    const code: CliCommandCode = {
      register: (node) => {
        (node as any).argument("[name]", "Name to greet").action((name?: string) => {
          process.stdout.write(`Hello, ${name ?? "world"}!\n`);
        });
      },
    };
    return {
      manifest,
      create: () => ({
        api: {},
        bind: { "acme.greet": code },
      }),
    };
  }

  it("GET lists commands, any user can call", async () => {
    const host = new PluginHost();
    const greet = createGreetPlugin();
    host.use({
      specifier: "@acme/greet",
      modules: [greet],
      replaces: [],
    });
    const app = await createTestApp({ plugins: host });

    const { cookie: adminCookie } = await loginAdmin(app.app);
    const adminClient = apiClient(app.app, adminCookie);
    const adminResp = await adminClient.get("/api/cli/commands");
    expect(adminResp.status).toBe(200);
    const adminData = (await adminResp.json()) as { commands: unknown[] };
    expect(adminData.commands).toHaveLength(1);
    expect(adminData.commands[0]).toMatchObject({
      package: "@acme/greet",
      key: "greet",
      summary: { en: "Say hello", zh: "打招呼" },
    });

    const { cookie: userCookie } = await provisionUser(app.app, "user1");
    const userClient = apiClient(app.app, userCookie);
    const userResp = await userClient.get("/api/cli/commands");
    expect(userResp.status).toBe(200);

    const noCookie = apiClient(app.app, "");
    const noAuthResp = await noCookie.get("/api/cli/commands");
    expect(noAuthResp.status).toBe(401);

    app.cleanup();
  });

  it("POST run requires admin", async () => {
    const host = new PluginHost();
    const greet = createGreetPlugin();
    host.use({
      specifier: "@acme/greet",
      modules: [greet],
      replaces: [],
    });
    const app = await createTestApp({ plugins: host });

    const { cookie: userCookie } = await provisionUser(app.app, "user1");
    const userClient = apiClient(app.app, userCookie);
    const userResp = await userClient.post("/api/cli/commands/run", {
      package: "@acme/greet",
      args: ["greet"],
      language: "en",
      prog: "penguin",
    });
    expect(userResp.status).toBe(403);
    const userData = (await userResp.json()) as { error: { code: string } };
    expect(userData.error.code).toBe("admin_required");

    app.cleanup();
  });

  it("POST run works for admin cookie and local token", async () => {
    const host = new PluginHost();
    const greet = createGreetPlugin();
    host.use({
      specifier: "@acme/greet",
      modules: [greet],
      replaces: [],
    });
    const app = await createTestApp({ plugins: host });

    const { cookie: adminCookie } = await loginAdmin(app.app);
    const adminClient = apiClient(app.app, adminCookie);
    const adminResp = await adminClient.post("/api/cli/commands/run", {
      package: "@acme/greet",
      args: ["greet", "Alice"],
      language: "en",
      prog: "penguin",
    });
    expect(adminResp.status).toBe(200);
    const adminData = (await adminResp.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
    expect(adminData.exitCode).toBe(0);
    expect(adminData.stdout).toContain("Hello, Alice!");
    expect(adminData.stderr).toBe("");

    const tokenClient2 = tokenClient(app.app, app.deps.authService.localApiToken()!);
    const tokenResp = await tokenClient2.post("/api/cli/commands/run", {
      package: "@acme/greet",
      args: ["greet"],
      language: "zh",
      prog: "penguin exec @acme/greet",
    });
    expect(tokenResp.status).toBe(200);
    const tokenData = (await tokenResp.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
    expect(tokenData.exitCode).toBe(0);
    expect(tokenData.stdout).toContain("Hello, world!");

    app.cleanup();
  });

  it("POST returns 404 unknown_package when the package has no commands", async () => {
    const host = new PluginHost();
    const app = await createTestApp({ plugins: host });

    const { cookie: adminCookie } = await loginAdmin(app.app);
    const adminClient = apiClient(app.app, adminCookie);
    const resp = await adminClient.post("/api/cli/commands/run", {
      package: "@nope/nope",
      args: [],
      language: "en",
      prog: "penguin",
    });
    expect(resp.status).toBe(404);
    const data = (await resp.json()) as { error: { code: string } };
    expect(data.error.code).toBe("unknown_package");

    app.cleanup();
  });

  it("POST returns 400 bad_request for invalid args, language, prog", async () => {
    const host = new PluginHost();
    const greet = createGreetPlugin();
    host.use({
      specifier: "@acme/greet",
      modules: [greet],
      replaces: [],
    });
    const app = await createTestApp({ plugins: host });

    const { cookie: adminCookie } = await loginAdmin(app.app);
    const adminClient = apiClient(app.app, adminCookie);

    const badArgs = await adminClient.post("/api/cli/commands/run", {
      package: "@acme/greet",
      args: "not-an-array",
      language: "en",
      prog: "penguin",
    });
    expect(badArgs.status).toBe(400);

    const badLang = await adminClient.post("/api/cli/commands/run", {
      package: "@acme/greet",
      args: [],
      language: "fr",
      prog: "penguin",
    });
    expect(badLang.status).toBe(400);

    const badProg = await adminClient.post("/api/cli/commands/run", {
      package: "@acme/greet",
      args: [],
      language: "en",
      prog: "penguin; rm -rf /",
    });
    expect(badProg.status).toBe(400);

    // The explicit exec form names the package before the id, so prog carries a colon.
    const colonProg = await adminClient.post("/api/cli/commands/run", {
      package: "@acme/greet",
      args: ["greet"],
      language: "en",
      prog: "penguin exec @acme/greet:greet",
    });
    expect(colonProg.status).toBe(200);

    app.cleanup();
  });
});

/**
 * PRFC-0024 v1.1: member commands, the caller's context, and files.
 *
 * - Given a package with a member command and an admin command, a Project member runs the member
 *   one and reads the checked caller (Project, Session, Agent) from its context; the admin one
 *   refuses them before its code runs.
 * - Given a member command with no Project, it refuses; a Project the caller cannot see, or a
 *   Session of another Project, is not found.
 * - Given a file the terminal sent for an option, the command reads it by the option's value and
 *   hands a file back, which the reply carries; a name with a directory part fails the run.
 * - Given two member runs at once, neither waits for the other.
 * - Given a command that requires its plugin listed, a Project that does not list the package for
 *   this machine is refused before the code runs; once the Project lists it, it runs.
 */
describe("member commands, caller context and files", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let sessionId: string;
  /** What the first of two concurrent runs waits on, and the second opens. */
  const latch = { gate: Promise.resolve(), open: () => {} };
  const adminRan: string[] = [];
  const listedRan: string[] = [];

  function toolsPlugin(): ModuleDef {
    const manifest = parseManifest({
      name: "AcmeTools",
      requires: {},
      provides: {},
      contributes: {
        "PluginCliCommandsProvider.commands": [
          {
            id: "acme.whoami",
            key: "tools.whoami",
            summary: { en: "Who runs this", zh: "谁在运行" },
            access: "member",
          },
          {
            id: "acme.flip",
            key: "tools.flip",
            summary: { en: "Reverse a file", zh: "反转文件" },
            access: "member",
            files: { read: ["--input"], write: "--out" },
          },
          {
            id: "acme.wait",
            key: "tools.wait",
            summary: { en: "Wait for a release", zh: "等待" },
            access: "member",
          },
          { id: "acme.reset", key: "tools.reset", summary: { en: "Reset", zh: "重置" } },
          {
            id: "acme.listed",
            key: "tools.listed",
            summary: { en: "Only where enabled", zh: "仅在启用处" },
            access: "member",
            requiresProjectListing: true,
          },
        ],
      },
      children: [],
    });
    const node = (command: CliCommandProgram) => command as any;
    const bind: Record<string, CliCommandCode> = {
      "acme.listed": {
        register: (command, ctx) => {
          node(command).action(() => {
            listedRan.push(ctx.caller?.projectId ?? "");
          });
        },
      },
      "acme.whoami": {
        register: (command, ctx) => {
          node(command).action(() => {
            ctx.stdout.write(`${JSON.stringify(ctx.caller)}\n`);
          });
        },
      },
      "acme.flip": {
        register: (command, ctx) => {
          node(command)
            .option("--input <file>")
            .option("--out <dir>")
            .option("--name <name>", "", "flipped.txt")
            .action((opts: { input: string; name: string }) => {
              const file = ctx.input!(opts.input);
              if (file === undefined) {
                ctx.stderr.write("no file\n");
                ctx.exit(2);
                return;
              }
              const text = Buffer.from(file.data).toString("utf8");
              ctx.output!({
                name: opts.name,
                mimeType: "text/plain",
                data: Buffer.from([...text].reverse().join("")),
              });
              ctx.stdout.write(`flipped ${file.name}\n`);
            });
        },
      },
      "acme.wait": {
        register: (command, ctx) => {
          node(command)
            .argument("<tag>")
            .action(async (tag: string) => {
              if (tag === "first") await latch.gate;
              else latch.open();
              ctx.stdout.write(`${tag} done\n`);
            });
        },
      },
      "acme.reset": {
        register: (command) => {
          adminRan.push("register");
          node(command).action(() => {
            adminRan.push("action");
          });
        },
      },
    };
    return { manifest, create: () => ({ api: {}, bind }) };
  }

  const runAs = (client: ReturnType<typeof apiClient>, body: Record<string, unknown>) =>
    client.post("/api/cli/commands/run", {
      package: "@acme/tools",
      language: "en",
      prog: "penguin",
      ...body,
    });

  beforeAll(async () => {
    const host = new PluginHost();
    host.use({ specifier: "@acme/tools", modules: [toolsPlugin()], replaces: [] });
    app = await createTestApp({ plugins: host });
    admin = apiClient(app.app, (await loginAdmin(app.app)).cookie);
    const { cookie } = await provisionUser(app.app, "member_c");
    expect(
      (await admin.post("/api/projects/default_project/members", { userId: "member_c" })).status,
    ).toBe(201);
    member = apiClient(app.app, cookie);
    // A Session needs a model its client can be built for; nothing is ever sent to it.
    const model = { provider: "custom", modelId: "chat-model" };
    expect(
      (
        await admin.put("/api/projects/default_project/models", {
          providers: {
            custom: { clientType: "mmsp", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-unused" },
          },
          models: [model],
          defaultModel: model,
        })
      ).status,
    ).toBe(200);
    const created = await admin.post(
      "/api/projects/default_project/agents/default_agent/sessions",
      {},
    );
    expect(created.status).toBe(201);
    sessionId = ((await created.json()) as { session: { sessionId: string } }).session.sessionId;
  });

  afterAll(() => app?.cleanup());

  it("lists each command's access and files", async () => {
    const listed = (await (await member.get("/api/cli/commands")).json()) as {
      commands: { key: string; access: string; files?: unknown }[];
    };
    expect(listed.commands.find((c) => c.key === "tools.flip")).toMatchObject({
      access: "member",
      files: { read: ["--input"], write: "--out" },
    });
    expect(listed.commands.find((c) => c.key === "tools.reset")?.access).toBe("admin");
  });

  it("runs a member command for a member, who reads the checked caller", async () => {
    const res = await runAs(member, {
      args: ["tools", "whoami"],
      projectId: "default_project",
      sessionId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exitCode: number; stdout: string };
    expect(body.exitCode).toBe(0);
    expect(JSON.parse(body.stdout)).toEqual({
      userId: "member_c",
      isAdmin: false,
      projectId: "default_project",
      sessionId,
      agentId: "default_agent",
    });
  });

  it("refuses a member the package's admin command before its code runs", async () => {
    adminRan.length = 0;
    const res = await runAs(member, { args: ["tools", "reset"], projectId: "default_project" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("admin_required");
    expect(adminRan).toEqual([]);
  });

  it("needs a Project for a member command, one the caller can see, and a Session of it", async () => {
    const none = await runAs(member, { args: ["tools", "whoami"] });
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe(
      "project_required",
    );
    expect(
      (await runAs(member, { args: ["tools", "whoami"], projectId: "someone_elses" })).status,
    ).toBe(404);
    const foreign = await runAs(member, {
      args: ["tools", "whoami"],
      projectId: "default_project",
      sessionId: "session-2026-01-01-00-00-00-00000000",
    });
    expect(foreign.status).toBe(404);
  });

  it("reads a sent file by its option's value and hands a file back", async () => {
    const res = await runAs(member, {
      args: ["tools", "flip", "--input", "notes/a.txt"],
      projectId: "default_project",
      files: [{ value: "notes/a.txt", name: "a.txt", data: Buffer.from("abc").toString("base64") }],
    });
    const body = (await res.json()) as {
      exitCode: number;
      stdout: string;
      files?: { name: string; mimeType?: string; data: string }[];
    };
    expect(body.exitCode).toBe(0);
    expect(body.stdout).toBe("flipped a.txt\n");
    expect(body.files).toEqual([
      { name: "flipped.txt", mimeType: "text/plain", data: Buffer.from("cba").toString("base64") },
    ]);
  });

  it("fails a run that hands back a name with a directory part", async () => {
    const res = await runAs(member, {
      args: ["tools", "flip", "--input", "a.txt", "--name", "../escape.txt"],
      projectId: "default_project",
      files: [{ value: "a.txt", name: "a.txt", data: Buffer.from("x").toString("base64") }],
    });
    const body = (await res.json()) as { exitCode: number; stderr: string; files?: unknown };
    expect(body.exitCode).toBe(1);
    expect(body.stderr).toContain("not a plain file name");
    expect(body.files).toBeUndefined();
  });

  it("runs two member commands at once without one waiting for the other", async () => {
    latch.gate = new Promise<void>((resolve) => (latch.open = resolve));
    const first = runAs(member, { args: ["tools", "wait", "first"], projectId: "default_project" });
    // The second run releases the first: were runs queued, the first would never finish.
    const second = runAs(member, {
      args: ["tools", "wait", "second"],
      projectId: "default_project",
    });
    const [a, b] = await Promise.all([first, second]);
    expect(((await a.json()) as { stdout: string }).stdout).toBe("first done\n");
    expect(((await b.json()) as { stdout: string }).stdout).toBe("second done\n");
  });

  it("runs a command that requires its plugin listed only where the Project lists it", async () => {
    const store = app.deps.projectConfigService;
    const before = await store.getPluginTables("default_project");
    try {
      await store.setPluginTables("default_project", { all: {}, machines: {} });
      const refused = await runAs(admin, {
        args: ["tools", "listed"],
        projectId: "default_project",
      });
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
        "plugin_not_enabled",
      );
      expect(listedRan).toEqual([]);
      await store.setPluginTables("default_project", {
        all: { "@acme/tools": {} },
        machines: {},
      });
      const ran = await runAs(member, { args: ["tools", "listed"], projectId: "default_project" });
      expect(ran.status).toBe(200);
      expect(listedRan).toEqual(["default_project"]);
    } finally {
      await store.setPluginTables("default_project", before);
    }
  });
});

/**
 * `tokenCaller: "session-driver"`: whom the local API token — every Agent's credential, standing
 * for the administrator — runs such a command as.
 *
 * - Given a Session a member last started a run in, an Agent's token call naming it runs the
 *   command as that member, and an admin command of that kind refuses them; after a restart the
 *   answer is the same.
 * - Given a token call naming no Session, or a Session nobody is recorded as driving, or whose
 *   driver can no longer open the Project, it refuses; a Session of another Project is not found.
 * - Given a command without the opt-in, the token stays the administrator (PRFC-0024 v1.1); given
 *   a person's own sign-in, the person runs it whoever drives the Session.
 */
describe("a session-driver command and the local API token", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let sessionId: string;
  const ran: string[] = [];

  function whoPlugin(): ModuleDef {
    const manifest = parseManifest({
      name: "AcmeWho",
      requires: {},
      provides: {},
      contributes: {
        "PluginCliCommandsProvider.commands": [
          {
            id: "who.me",
            key: "who.me",
            summary: { en: "Who runs this", zh: "谁在运行" },
            access: "member",
            tokenCaller: "session-driver",
          },
          {
            id: "who.wipe",
            key: "who.wipe",
            summary: { en: "Admin only", zh: "仅管理员" },
            tokenCaller: "session-driver",
          },
          {
            id: "who.plain",
            key: "who.plain",
            summary: { en: "Who runs this, as v1.1", zh: "谁在运行（v1.1）" },
            access: "member",
          },
        ],
      },
      children: [],
    });
    const node = (command: CliCommandProgram) => command as any;
    const print = (id: string): CliCommandCode => ({
      register: (command, ctx) => {
        node(command).action(() => {
          ran.push(id);
          ctx.stdout.write(
            `${JSON.stringify({ userId: ctx.caller?.userId, isAdmin: ctx.caller?.isAdmin })}\n`,
          );
        });
      },
    });
    return {
      manifest,
      create: () => ({
        api: {},
        bind: {
          "who.me": print("who.me"),
          "who.wipe": print("who.wipe"),
          "who.plain": print("who.plain"),
        },
      }),
    };
  }

  const host = () => {
    const h = new PluginHost();
    h.use({ specifier: "@acme/who", modules: [whoPlugin()], replaces: [] });
    return h;
  };
  const agent = () => tokenClient(t.app, t.deps.authService.localApiToken()!);
  const run = (client: ReturnType<typeof apiClient>, body: Record<string, unknown>) =>
    client.post("/api/cli/commands/run", {
      package: "@acme/who",
      language: "en",
      prog: "penguin",
      projectId: "default_project",
      ...body,
    });
  const answer = async (res: Response) => {
    expect(res.status).toBe(200);
    return JSON.parse(((await res.json()) as { stdout: string }).stdout) as {
      userId: string;
      isAdmin: boolean;
    };
  };
  const refusal = async (res: Response) => ({
    status: res.status,
    code: ((await res.json()) as { error: { code: string } }).error.code,
  });
  /** A Session needs a model its client can be built for; nothing is ever sent to it. */
  const withModel = async (projectId: string) => {
    const model = { provider: "custom", modelId: "chat-model" };
    expect(
      (
        await admin.put(`/api/projects/${projectId}/models`, {
          providers: {
            custom: { clientType: "mmsp", baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-unused" },
          },
          models: [model],
          defaultModel: model,
        })
      ).status,
    ).toBe(200);
  };
  const newSession = async (projectId = "default_project") => {
    const created = await admin.post(
      `/api/projects/${projectId}/agents/default_agent/sessions`,
      {},
    );
    expect(created.status).toBe(201);
    return ((await created.json()) as { session: { sessionId: string } }).session.sessionId;
  };
  /** What the sessions route does when a signed-in person starts a run. */
  const startedBy = (id: string, userId: string) =>
    t.deps.tree
      .api<{ note(sessionId: string, userId: string): void }>(
        "SessionRuntimeModule",
        "SessionDrivers",
      )
      .note(id, userId);

  beforeAll(async () => {
    t = await createTestApp({ plugins: host(), durableDatabase: true });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    await provisionUser(t.app, "mia");
    expect(
      (await admin.post("/api/projects/default_project/members", { userId: "mia" })).status,
    ).toBe(201);
    await withModel("default_project");
    sessionId = await newSession();
    startedBy(sessionId, "mia");
  });

  afterAll(() => t?.cleanup());

  it("runs as the member who drives the Session, and refuses them an admin command", async () => {
    expect(await answer(await run(agent(), { args: ["who", "me"], sessionId }))).toEqual({
      userId: "mia",
      isAdmin: false,
    });
    ran.length = 0;
    expect(await refusal(await run(agent(), { args: ["who", "wipe"], sessionId }))).toEqual({
      status: 403,
      code: "admin_required",
    });
    expect(ran).toEqual([]);
  });

  it("refuses a token call that names no Session, before any code runs", async () => {
    ran.length = 0;
    expect(await refusal(await run(agent(), { args: ["who", "me"] }))).toEqual({
      status: 403,
      code: "session_required",
    });
    expect(ran).toEqual([]);
  });

  it("refuses a Session nobody is recorded as driving, never guessing its Project's owner", async () => {
    const idle = await newSession();
    expect(await refusal(await run(agent(), { args: ["who", "me"], sessionId: idle }))).toEqual({
      status: 403,
      code: "driver_unknown",
    });
  });

  it("does not borrow a person from a Session of another Project", async () => {
    expect(
      (await admin.post("/api/projects", { projectId: "elsewhere", name: "Elsewhere" })).status,
    ).toBe(201);
    await withModel("elsewhere");
    const other = await newSession("elsewhere");
    startedBy(other, "admin");
    expect(await refusal(await run(agent(), { args: ["who", "me"], sessionId: other }))).toEqual({
      status: 404,
      code: "session_not_found",
    });
  });

  it("keeps the token the administrator for a command without the opt-in, and a person themself", async () => {
    expect(await answer(await run(agent(), { args: ["who", "plain"], sessionId }))).toEqual({
      userId: "admin",
      isAdmin: true,
    });
    expect(await answer(await run(admin, { args: ["who", "me"], sessionId }))).toEqual({
      userId: "admin",
      isAdmin: true,
    });
  });

  it("refuses a driver who can no longer open the Project", async () => {
    const left = await newSession();
    await provisionUser(t.app, "leo");
    expect(
      (await admin.post("/api/projects/default_project/members", { userId: "leo" })).status,
    ).toBe(201);
    startedBy(left, "leo");
    expect((await admin.delete("/api/projects/default_project/members/leo")).status).toBeLessThan(
      300,
    );
    expect(await refusal(await run(agent(), { args: ["who", "me"], sessionId: left }))).toEqual({
      status: 403,
      code: "driver_unknown",
    });
  });

  // Last: it replaces `t` with the app booted on the same root.
  it("gives the same answer after a restart", async () => {
    t = await restartTestApp(t, { plugins: host() });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect(await answer(await run(agent(), { args: ["who", "me"], sessionId }))).toEqual({
      userId: "mia",
      isAdmin: false,
    });
  });
});
