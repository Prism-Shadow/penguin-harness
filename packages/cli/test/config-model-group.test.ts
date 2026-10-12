/**
 * Integration tests for the group form of `penguin config model` (run through commander's
 * parseAsync for the full command path): `model add --provider <group>` without `--model-id`
 * writes the group's connection to `[providers.<id>]` in the hidden .project_config.toml under
 * --root (mode 0600), sets and clears each field on its own, takes a protocol on any group, and
 * never touches a model's own value; the flags that describe one model, and a base URL that is
 * not an absolute http(s) URL, are refused there.
 * `model remove --provider <group>` without `--model-id` drops the table and keeps the models.
 * The `--clear-*` flags clear a model's own value too. `model list` prints the groups' tables,
 * then what each model is used with, read from the file alone: a group value marked
 * `(provider)`, nothing from the catalog, and the group key only where it reaches the model.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { parse as parseToml } from "smol-toml";
import { DEFAULT_PROJECT_ID, projectConfigPath } from "@prismshadow/penguin-core";
import { registerConfigCommand } from "../src/commands/config.js";
import { getMessages } from "../src/i18n.js";

let tmpHome: string;
let tmpRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cli-home-"));
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cli-root-"));
  process.env.PENGUIN_HOME = tmpHome;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/**
 * Runs a `penguin config model …` command, capturing stdout / stderr and the exit code
 * (commander usage errors are thrown under exitOverride and turned into a non-zero code).
 */
async function run(args: string[]): Promise<{ out: string; err: string; code: number }> {
  const program = new Command();
  program.exitOverride();
  registerConfigCommand(program, getMessages("en"));
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  const prevExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync(["node", "penguin", "config", "model", ...args, "--root", tmpRoot]);
    return { out: out.join(""), err: err.join(""), code: Number(process.exitCode ?? 0) };
  } catch (e) {
    const exitCode = (e as { exitCode?: number }).exitCode;
    return { out: out.join(""), err: err.join(""), code: exitCode || 1 };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = prevExitCode;
  }
}

interface StoredConfig {
  providers?: Record<string, Record<string, unknown>>;
  models: Array<Record<string, unknown>>;
}

const configFile = (): string => projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID);

async function readConfig(): Promise<StoredConfig> {
  return parseToml(await fs.readFile(configFile(), "utf8")) as unknown as StoredConfig;
}

/** The `model list` line of one (provider, model_id) pair. */
async function listLine(provider: string, modelId: string): Promise<string | undefined> {
  const list = await run(["list"]);
  return list.out
    .split("\n")
    .find(
      (l) =>
        l.trim().replace(/^\* /, "").split(/\s+/).slice(0, 2).join(" ") ===
        `${provider} ${modelId}`,
    );
}

/** The line of one group in the `Groups:` block of `model list`. */
async function groupLine(group: string): Promise<string | undefined> {
  const list = await run(["list"]);
  const [groups = ""] = list.out.split("Models:");
  return groups.split("\n").find((l) => l.split(/\s+/)[0] === group);
}

describe("penguin config model add without --model-id: the group's connection", () => {
  it("writes the group key once under --root (0600), and the group's models use it", async () => {
    const set = await run(["add", "--provider", "tokendance", "--api-key", "td-group-key-aaaa"]);
    expect(set.code).toBe(0);

    if (process.platform !== "win32") {
      expect((await fs.stat(configFile())).mode & 0o777).toBe(0o600);
    }
    // --root beats PENGUIN_HOME.
    await expect(fs.access(projectConfigPath(tmpHome, DEFAULT_PROJECT_ID))).rejects.toThrow();

    const stored = await readConfig();
    expect(stored.providers?.tokendance?.api_key).toBe("td-group-key-aaaa");
    expect(typeof stored.providers?.tokendance?.created_at).toBe("string");
    // The key is stored on the group, not copied onto its rows.
    const rows = stored.models.filter((m) => m.provider === "tokendance");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((m) => m.api_key === undefined)).toBe(true);

    const line = await listLine("tokendance", "kimi-k3");
    expect(line).toContain("api_key=****aaaa (provider)");
    expect(await groupLine("tokendance")).toContain("api_key=****aaaa");
    expect((await run(["list"])).out).not.toContain("td-group-key-aaaa");
  });

  it("leaves a model's own key in place and says how many models keep their own", async () => {
    await run([
      "add",
      "--provider",
      "tokendance",
      "--model-id",
      "kimi-k3",
      "--api-key",
      "td-own-key-bbbb",
    ]);

    const set = await run(["add", "--provider", "tokendance", "--api-key", "td-group-key-aaaa"]);
    expect(set.code).toBe(0);
    expect(set.out).toContain("1 model sets its own value and is unaffected");

    const stored = await readConfig();
    const own = stored.models.find((m) => m.provider === "tokendance" && m.model_id === "kimi-k3");
    expect(own?.api_key).toBe("td-own-key-bbbb");
    // The override is used as the model's own; its neighbours follow the group.
    expect(await listLine("tokendance", "kimi-k3")).toMatch(/api_key=\*{4}bbbb(\s|$)/);
    expect(await listLine("tokendance", "glm-5.3")).toContain("api_key=****aaaa (provider)");
  });

  it("a group key does not reach a model whose own base URL is on another host, and the count says so", async () => {
    // Custom's preset carries its own endpoint; a key issued for the group's endpoint (or for
    // no endpoint at all) is not sent there.
    const set = await run(["add", "--provider", "custom", "--api-key", "custom-key-cccc"]);
    expect(set.code).toBe(0);
    expect(set.out).toContain("1 model sets its own value and is unaffected");
    expect(await listLine("custom", "Atria-Dawn-Preview")).toContain("api_key=-");

    // A model added without a base URL of its own goes where the group goes and takes the key.
    await run([
      "add",
      "--provider",
      "custom",
      "--base-url",
      "http://127.0.0.1:11434/v1",
      "--client-type",
      "openai-chat",
    ]);
    await run(["add", "--provider", "custom", "--model-id", "qwen3.8-27b-local"]);
    expect(await listLine("custom", "qwen3.8-27b-local")).toContain("api_key=****cccc (provider)");
    expect(await listLine("custom", "Atria-Dawn-Preview")).toContain("api_key=-");
  });

  it("sets and clears each field on its own; a cleared field falls to the client default, never to the catalog", async () => {
    // A new Project's file already holds OpenRouter's endpoint and protocol on the group.
    expect(await groupLine("openrouter")).toMatch(
      /base_url=https:\/\/openrouter\.ai\/api\/v1\s+client_type=openai-responses\s+api_key=-/,
    );
    await run([
      "add",
      "--provider",
      "openrouter",
      "--base-url",
      "https://proxy.example/openrouter/v1",
      "--client-type",
      "openai-chat",
    ]);
    const followed = await listLine("openrouter", "openrouter/free");
    expect(followed).toContain("client_type=openai-chat (provider)");
    expect(followed).toContain("base_url=https://proxy.example/openrouter/v1 (provider)");

    const cleared = await run(["add", "--provider", "openrouter", "--clear-base-url"]);
    expect(cleared.code).toBe(0);
    expect((await readConfig()).providers?.openrouter).toEqual({ client_type: "openai-chat" });
    // Cleared: nothing stands in for it; the model goes to its client's default endpoint.
    expect(await listLine("openrouter", "openrouter/free")).not.toContain("base_url=");
    expect(await groupLine("openrouter")).toContain("base_url=-");

    await run(["add", "--provider", "openrouter", "--clear-client-type"]);
    expect((await readConfig()).providers?.openrouter).toBeUndefined();
    expect(await listLine("openrouter", "openrouter/free")).not.toContain("client_type=");
    expect(await groupLine("openrouter")).toBeUndefined();
  });

  it("any group takes a protocol, Penguin Go and OpenCode Go included; a model's own protocol still wins", async () => {
    for (const group of ["penguin-go", "opencode-go"]) {
      const set = await run(["add", "--provider", group, "--client-type", "openai-chat"]);
      expect(set.code, group).toBe(0);
      expect((await readConfig()).providers?.[group]?.client_type, group).toBe("openai-chat");
    }
    // The Penguin Go presets store their own protocol, which the group's does not override.
    const gemini = await listLine("penguin-go", "gemini-3.8-flash");
    expect(gemini).toContain("client_type=google-genai");
    expect(gemini).not.toContain("client_type=google-genai (provider)");
  });

  it("a group of the user's own takes its connection first, and the models added to it follow", async () => {
    const set = await run([
      "add",
      "--provider",
      "my-ollama",
      "--base-url",
      "http://127.0.0.1:11434/v1",
      "--client-type",
      "openai-chat",
      "--api-key",
      "ollama-placeholder-dddd",
    ]);
    expect(set.code).toBe(0);
    expect(set.out).toContain("has no models yet");

    const add = await run(["add", "--provider", "my-ollama", "--model-id", "qwen3.8-27b-local"]);
    expect(add.code).toBe(0);
    const row = (await readConfig()).models.find((m) => m.provider === "my-ollama");
    // Nothing is copied onto the row: not even the openai-chat default a custom-like model
    // gets when its group has no protocol to give it.
    expect(row).toEqual({ provider: "my-ollama", model_id: "qwen3.8-27b-local" });

    const line = await listLine("my-ollama", "qwen3.8-27b-local");
    expect(line).toContain("client_type=openai-chat (provider)");
    expect(line).toContain("api_key=****dddd (provider)");
    expect(line).toContain("base_url=http://127.0.0.1:11434/v1 (provider)");

    // The group exists through its models: its connection goes with the last of them.
    await run(["remove", "--provider", "my-ollama", "--model-id", "qwen3.8-27b-local"]);
    expect((await readConfig()).providers?.["my-ollama"]).toBeUndefined();
  });

  it("refuses the flags that describe one model, and writes nothing", async () => {
    const rowOnly = [
      ["--context-window", "32768"],
      ["--max-tokens", "8000"],
      ["--vision"],
      ["--no-vision"],
      ["--fast-mode"],
      ["--no-fast-mode"],
      ["--price-output", "1"],
      ["--set-default"],
    ];
    for (const flags of rowOnly) {
      const refused = await run([
        "add",
        "--provider",
        "tokendance",
        "--api-key",
        "td-group-key-aaaa",
        ...flags,
      ]);
      expect(refused.code, flags.join(" ")).toBe(1);
      expect(refused.err, flags.join(" ")).toContain(
        "describe one model: add --model-id <upstream id>, or drop them to set the tokendance group's connection.",
      );
    }
    await expect(fs.access(configFile())).rejects.toThrow();
  });

  it("refuses an ambiguous or empty request before anything is written", async () => {
    const refusals = [
      ["--api-key", "td-group-key-aaaa", "--clear-api-key"],
      ["--api-key", " "],
      [],
    ];
    for (const flags of refusals) {
      const refused = await run(["add", "--provider", "tokendance", ...flags]);
      expect(refused.code, flags.join(" ")).toBe(1);
    }
    const nothing = await run(["add", "--provider", "tokendance"]);
    expect(nothing.err).toContain("Nothing to change for group tokendance");
    const badName = await run(["add", "--provider", "My Lab", "--base-url", "http://x/v1"]);
    expect(badName.code).toBe(1);
    expect(badName.err).toContain("My Lab");
    await expect(fs.access(configFile())).rejects.toThrow();
  });

  it("refuses a group base URL that is not an absolute http(s) URL, and writes nothing", async () => {
    for (const baseUrl of ["not-a-url", "127.0.0.1:11434/v1", "ftp://lab.example/v1"]) {
      const refused = await run(["add", "--provider", "my-lab", "--base-url", baseUrl]);
      expect(refused.code, baseUrl).toBe(1);
      expect(refused.err, baseUrl).toContain(`Invalid --base-url "${baseUrl}"`);
    }
    await expect(fs.access(configFile())).rejects.toThrow();
  });
});

describe("penguin config model add --clear-* on one model", () => {
  it("clears the model's own key, base URL and protocol, after which it follows its group", async () => {
    await run([
      "add",
      "--provider",
      "my-lab",
      "--base-url",
      "https://lab.example/v1",
      "--api-key",
      "lab-group-key-eeee",
    ]);
    await run([
      "add",
      "--provider",
      "my-lab",
      "--model-id",
      "lab-1",
      "--api-key",
      "lab-own-key-ffff",
      "--base-url",
      "https://lab.example/other/v1",
      "--client-type",
      "openai-responses",
    ]);
    const own = (await readConfig()).models.find((m) => m.model_id === "lab-1");
    expect(own).toMatchObject({
      api_key: "lab-own-key-ffff",
      base_url: "https://lab.example/other/v1",
      client_type: "openai-responses",
    });

    const cleared = await run([
      "add",
      "--provider",
      "my-lab",
      "--model-id",
      "lab-1",
      "--clear-api-key",
      "--clear-base-url",
      "--clear-client-type",
    ]);
    expect(cleared.code).toBe(0);
    expect(cleared.out).toContain("Updated model (provider=my-lab, model_id=lab-1).");
    const row = (await readConfig()).models.find((m) => m.model_id === "lab-1");
    expect(row).toEqual({ provider: "my-lab", model_id: "lab-1" });
    const line = await listLine("my-lab", "lab-1");
    expect(line).toContain("api_key=****eeee (provider)");
    expect(line).toContain("base_url=https://lab.example/v1 (provider)");
  });

  it("refuses a value and its --clear-* flag together, or a blank value, on a model as on a group", async () => {
    await run(["add", "--provider", "custom", "--model-id", "keep-key", "--api-key", "sk-keep"]);
    for (const flags of [
      ["--api-key", "sk-other", "--clear-api-key"],
      ["--api-key", ""],
    ]) {
      const refused = await run([
        "add",
        "--provider",
        "custom",
        "--model-id",
        "keep-key",
        ...flags,
      ]);
      expect(refused.code, flags.join(" ")).toBe(1);
    }
    const row = (await readConfig()).models.find((m) => m.model_id === "keep-key");
    expect(row?.api_key).toBe("sk-keep");
  });
});

describe("penguin config model remove without --model-id: the group's connection", () => {
  it("drops the group's table and keeps its models, which then use the client defaults", async () => {
    await run(["add", "--provider", "openrouter", "--api-key", "sk-or-group-gggg"]);
    const before = (await readConfig()).models.filter((m) => m.provider === "openrouter").length;

    const removed = await run(["remove", "--provider", "openrouter"]);
    expect(removed.code).toBe(0);
    expect(removed.out).toContain(
      `Removed the openrouter group's connection. Its ${before} models stay; the ones without a value of their own now use the client defaults.`,
    );
    const stored = await readConfig();
    expect(stored.providers?.openrouter).toBeUndefined();
    expect(stored.models.filter((m) => m.provider === "openrouter")).toHaveLength(before);
    const line = await listLine("openrouter", "openrouter/free");
    expect(line).toContain("api_key=-");
    expect(line).not.toContain("base_url=");
  });

  it("refuses a group that stores no connection, pointing at --model-id", async () => {
    await run(["add", "--provider", "custom", "--model-id", "seed"]);
    const refused = await run(["remove", "--provider", "deepseek"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain(
      "Group deepseek has no connection to remove. To remove a model, add --model-id <upstream id>.",
    );
    expect(
      (await readConfig()).models.some(
        (m) => m.provider === "deepseek" && m.model_id === "deepseek-flash",
      ),
    ).toBe(true);
  });
});

describe("penguin config model list", () => {
  it("prints the groups' stored connections above the models, keys masked", async () => {
    await run(["add", "--provider", "vllm", "--base-url", "http://10.0.0.5:8000/v1"]);
    const list = await run(["list"]);
    expect(list.code).toBe(0);
    expect(list.out.indexOf("Groups:")).toBeLessThan(list.out.indexOf("Models:"));
    expect(await groupLine("vllm")).toMatch(
      /^vllm\s+base_url=http:\/\/10\.0\.0\.5:8000\/v1\s+client_type=openai-chat-vllm-adapter\s+api_key=-$/,
    );
    // A vendor group that stores nothing has no line; its models go to the client defaults.
    expect(await groupLine("deepseek")).toBeUndefined();
  });
});
