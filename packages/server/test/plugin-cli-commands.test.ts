import { describe, it, expect, vi } from "vitest";
import type { CliCommandCode, CliCommandProgram } from "@prismshadow/penguin-core/cli";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import { PluginHost } from "../src/plugin/host.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, tokenClient } from "./helpers.js";
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
