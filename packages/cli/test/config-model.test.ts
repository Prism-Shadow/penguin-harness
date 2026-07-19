/**
 * Integration tests for `penguin config model add|default|vision|list` (run through
 * commander's parseAsync for the full command path): --model-id always takes the
 * upstream id, paired with --provider to form a (provider, model_id) reference (add's
 * --provider defaults to catalog-based inference, falling back to custom when
 * inference fails; default / vision require --provider and raise an error when the
 * reference isn't found in models — no string concatenation is ever performed); --root
 * specifies the data root directory (takes priority over PENGUIN_HOME); persisted to a
 * single hidden .project_config.toml (mode 0600, credentials inline, provider and
 * model_id as separate columns); list displays provider and model_id as separate
 * columns.
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

interface TomlModelRef {
  provider: string;
  model_id: string;
}

/**
 * Runs a `penguin config model …` command, capturing stdout / stderr and the exit code
 * (without actually exiting the process; under exitOverride, commander usage errors —
 * such as a missing required option — are thrown as a CommanderError, which is
 * converted to a non-zero exit code).
 */
async function runModel(args: string[]): Promise<{ out: string; err: string; code: number }> {
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
    await program.parseAsync(["node", "penguin", "config", "model", ...args]);
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

describe("penguin config model add/list（--root 与 provider / model_id 分列存储）", () => {
  it("--root 优先于 PENGUIN_HOME：落盘到指定根目录的隐藏 .project_config.toml（0600）", async () => {
    const add = await runModel([
      "add",
      "--model-id",
      "my-own-model",
      "--api-key",
      "sk-root-secret-1",
      "--root",
      tmpRoot,
    ]);
    expect(add.code).toBe(0);
    // Catalog inference fails -> falls back to the custom group (provider is a separate field, never concatenated into the id).
    expect(add.out).toContain("Added model (provider=custom, model_id=my-own-model).");

    const file = projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID);
    expect(path.basename(file)).toBe(".project_config.toml");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    const parsed = parseToml(await fs.readFile(file, "utf8")) as {
      models: Array<Record<string, unknown>>;
    };
    const entry = parsed.models.find(
      (m) => m.provider === "custom" && m.model_id === "my-own-model",
    );
    expect(entry).toBeDefined();
    expect(entry?.api_key).toBe("sk-root-secret-1");
    // Concatenated storage id and request_model_id have been removed.
    expect(entry?.request_model_id).toBeUndefined();
    // The root directory pointed to by PENGUIN_HOME is unaffected.
    await expect(fs.access(projectConfigPath(tmpHome, DEFAULT_PROJECT_ID))).rejects.toThrow();

    // list also reads --root: provider and model_id as separate columns + masked api_key (the request column has been removed).
    const list = await runModel(["list", "--root", tmpRoot]);
    expect(list.code).toBe(0);
    const line = list.out.split("\n").find((l) => l.includes("my-own-model"));
    expect(line).toMatch(/custom\s+my-own-model/);
    expect(line).toContain("api_key=****et-1");
    expect(list.out).not.toContain("request=");
    expect(list.out).not.toContain("sk-root-secret-1");
  });

  it("内置目录推断分组：上游 id 命中目录时条目落该 provider；--set-default 写成对引用", async () => {
    const add = await runModel([
      "add",
      "--model-id",
      "claude-sonnet-4-6",
      "--set-default",
      "--root",
      tmpRoot,
    ]);
    expect(add.code).toBe(0);
    expect(add.out).toContain("Updated model (provider=anthropic, model_id=claude-sonnet-4-6).");
    expect(add.out).toContain("Default model: (provider=anthropic, model_id=claude-sonnet-4-6)");

    const parsed = parseToml(
      await fs.readFile(projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID), "utf8"),
    ) as unknown as { default_model: TomlModelRef; models: Array<Record<string, unknown>> };
    expect(parsed.default_model).toEqual({
      provider: "anthropic",
      model_id: "claude-sonnet-4-6",
    });
    expect(
      parsed.models.find((m) => m.provider === "anthropic" && m.model_id === "claude-sonnet-4-6"),
    ).toBeDefined();
  });

  it("--provider 显式指定分组：同名上游 id 与预置条目互不冲突（各自独立条目）", async () => {
    const add = await runModel([
      "add",
      "--model-id",
      "claude-sonnet-4-6",
      "--provider",
      "myproxy",
      "--base-url",
      "https://proxy.example/v1",
      "--root",
      tmpRoot,
    ]);
    expect(add.code).toBe(0);
    expect(add.out).toContain("Added model (provider=myproxy, model_id=claude-sonnet-4-6).");

    const list = await runModel(["list", "--root", tmpRoot]);
    const line = list.out.split("\n").find((l) => l.includes("myproxy"));
    expect(line).toMatch(/myproxy\s+claude-sonnet-4-6/);
    expect(line).toContain("base_url=https://proxy.example/v1");
    // The pre-existing anthropic entry remains (the (provider, model_id) pair naturally disambiguates).
    expect(list.out.split("\n").some((l) => /anthropic\s+claude-sonnet-4-6/.test(l))).toBe(true);
  });

  it("client_type 缺省按分组语义（PRN-021）：custom / 自建 / 网关落 openai，一方厂商不落", async () => {
    // custom (catalog inference fails) and self-hosted groups (--provider not a catalog value): default to client_type=openai.
    await runModel(["add", "--model-id", "my-openai-proxy", "--root", tmpRoot]);
    await runModel(["add", "--model-id", "in-house-1", "--provider", "mylab", "--root", tmpRoot]);
    // A non-catalog id under a first-party vendor group: client_type is not set (AgentHub auto-routes by upstream id).
    await runModel([
      "add",
      "--model-id",
      "my-fine-tune",
      "--provider",
      "deepseek",
      "--root",
      tmpRoot,
    ]);
    // Gateway group: openai + the gateway's endpoint base URL pre-filled.
    await runModel([
      "add",
      "--model-id",
      "acme/some-model",
      "--provider",
      "openrouter",
      "--root",
      tmpRoot,
    ]);
    // An explicit --client-type is persisted as-is, not overridden by the default rule.
    await runModel([
      "add",
      "--model-id",
      "special-1",
      "--provider",
      "mylab",
      "--client-type",
      "verbatim-type",
      "--root",
      tmpRoot,
    ]);

    const parsed = parseToml(
      await fs.readFile(projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID), "utf8"),
    ) as { models: Array<Record<string, unknown>> };
    const by = (p: string, id: string) =>
      parsed.models.find((m) => m.provider === p && m.model_id === id)!;
    expect(by("custom", "my-openai-proxy").client_type).toBe("openai");
    expect(by("mylab", "in-house-1").client_type).toBe("openai");
    expect(by("deepseek", "my-fine-tune").client_type).toBeUndefined();
    expect(by("openrouter", "acme/some-model").client_type).toBe("openai");
    expect(by("openrouter", "acme/some-model").base_url).toBe("https://openrouter.ai/api/v1");
    expect(by("mylab", "special-1").client_type).toBe("verbatim-type");
  });

  it("model default 经 --root 指定根目录设置默认模型（--model-id 上游 id + --provider 成对）", async () => {
    const set = await runModel([
      "default",
      "--model-id",
      "deepseek-v4-flash",
      "--provider",
      "deepseek",
      "--root",
      tmpRoot,
    ]);
    expect(set.code).toBe(0);
    expect(set.out).toContain(
      "Default model set to (provider=deepseek, model_id=deepseek-v4-flash).",
    );
    const parsed = parseToml(
      await fs.readFile(projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID), "utf8"),
    ) as unknown as { default_model: TomlModelRef };
    expect(parsed.default_model).toEqual({
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
    });
  });
});

describe("model default/vision：--provider 必填，(provider, model_id) 成对引用", () => {
  it("缺 --provider：commander 用法报错，非零退出码", async () => {
    const bad = await runModel(["default", "--model-id", "deepseek-v4-flash", "--root", tmpRoot]);
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain("--provider");
  });

  it("引用落空：成对引用不在 models 中，报错带成对引用与 model list 提示", async () => {
    const bad = await runModel([
      "default",
      "--model-id",
      "no-such-model",
      "--provider",
      "custom",
      "--root",
      tmpRoot,
    ]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("(provider=custom, model_id=no-such-model)");
    expect(bad.err).toContain("penguin config model list");
    // The upstream id matches a pre-existing entry but --provider names the wrong group: also not found (exact pair, no fuzzy matching).
    const wrongGroup = await runModel([
      "vision",
      "--model-id",
      "claude-sonnet-4-6",
      "--provider",
      "openai",
      "--root",
      tmpRoot,
    ]);
    expect(wrongGroup.code).toBe(1);
    expect(wrongGroup.err).toContain("(provider=openai, model_id=claude-sonnet-4-6)");
    expect(wrongGroup.err).toContain("penguin config model list");
  });

  it("model vision 成对引用命中：设置视觉模型（落盘内联表）", async () => {
    const ok = await runModel([
      "vision",
      "--model-id",
      "claude-sonnet-4-6",
      "--provider",
      "anthropic",
      "--root",
      tmpRoot,
    ]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain(
      "Vision model set to (provider=anthropic, model_id=claude-sonnet-4-6).",
    );
    const parsed = parseToml(
      await fs.readFile(projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID), "utf8"),
    ) as unknown as { vision_model: TomlModelRef };
    expect(parsed.vision_model).toEqual({
      provider: "anthropic",
      model_id: "claude-sonnet-4-6",
    });
  });
});
