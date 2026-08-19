/**
 * Integration tests for `penguin config model add|default|vision|list|remove` (run through
 * commander's parseAsync for the full command path): --model-id always takes the
 * upstream id, paired with --provider to form a (provider, model_id) reference
 * (--provider is required on every subcommand that names an entry — the group is never
 * inferred — and default / vision / remove report an error when the reference isn't found in
 * models; no string concatenation is ever performed); remove also clears the default /
 * vision pointers that named the removed entry; --root
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

describe("penguin config model add/list (--root plus provider / model_id stored as separate fields)", () => {
  it("--root beats PENGUIN_HOME: written to the hidden .project_config.toml under the given root (0600)", async () => {
    const add = await runModel([
      "add",
      "--model-id",
      "my-own-model",
      "--provider",
      "custom",
      "--api-key",
      "sk-root-secret-1",
      "--root",
      tmpRoot,
    ]);
    expect(add.code).toBe(0);
    // The named group is stored as a separate field, never concatenated into the id.
    expect(add.out).toContain("Added model (provider=custom, model_id=my-own-model).");

    const file = projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID);
    expect(path.basename(file)).toBe(".project_config.toml");
    // POSIX-only: Windows has no owner-only mode bits (chmod maps to the read-only attribute).
    if (process.platform !== "win32") {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    }
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

  it("naming an existing pair updates that preset entry in place; --set-default writes a pair reference", async () => {
    const add = await runModel([
      "add",
      "--model-id",
      "claude-sonnet-4-6",
      "--provider",
      "anthropic",
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

  it("--provider picks the grouping explicitly: a same-name upstream id does not clash with the preset entry (independent entries)", async () => {
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

  it("client_type defaults by grouping semantics (PRN-021): custom / self-hosted / gateway get openai, first-party providers get none", async () => {
    // The custom group and self-hosted groups (--provider not a catalog value): default to client_type=openai.
    await runModel([
      "add",
      "--model-id",
      "my-openai-proxy",
      "--provider",
      "custom",
      "--root",
      tmpRoot,
    ]);
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

  it("--max-tokens round-trips to the entry's max_tokens; 0/negative/non-number are rejected before anything is written", async () => {
    const add = await runModel([
      "add",
      "--model-id",
      "local-32k",
      "--provider",
      "custom",
      "--base-url",
      "http://127.0.0.1:8000/v1",
      "--max-tokens",
      "8000",
      "--root",
      tmpRoot,
    ]);
    expect(add.code).toBe(0);
    const entryOf = async () => {
      const parsed = parseToml(
        await fs.readFile(projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID), "utf8"),
      ) as { models: Array<Record<string, unknown>> };
      return parsed.models.find((m) => m.provider === "custom" && m.model_id === "local-32k");
    };
    expect((await entryOf())?.max_tokens).toBe(8000);

    // Upsert without --max-tokens keeps the existing annotation (same merge policy as context_window).
    const update = await runModel([
      "add",
      "--model-id",
      "local-32k",
      "--provider",
      "custom",
      "--context-window",
      "32768",
      "--root",
      tmpRoot,
    ]);
    expect(update.code).toBe(0);
    expect((await entryOf())?.max_tokens).toBe(8000);

    // 0 / negative: rejected with a clear error, and the config is untouched.
    for (const bad of ["0", "-5"]) {
      const res = await runModel([
        "add",
        "--model-id",
        "local-32k",
        "--provider",
        "custom",
        "--max-tokens",
        bad,
        "--root",
        tmpRoot,
      ]);
      expect(res.code).toBe(1);
      expect(res.err).toContain("--max-tokens must be a positive integer");
    }
    // Non-number: parseIntArg throws a commander usage error (nonzero exit).
    const nan = await runModel([
      "add",
      "--model-id",
      "local-32k",
      "--provider",
      "custom",
      "--max-tokens",
      "many",
      "--root",
      tmpRoot,
    ]);
    expect(nan.code).not.toBe(0);
    expect((await entryOf())?.max_tokens).toBe(8000);
  });

  it("--fast-mode round-trips as fast_mode=true; --no-fast-mode clears it; neither keeps current", async () => {
    const entryOf = async () => {
      const parsed = parseToml(
        await fs.readFile(projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID), "utf8"),
      ) as { models: Array<Record<string, unknown>> };
      return parsed.models.find((m) => m.provider === "custom" && m.model_id === "fast-1");
    };
    const add = await runModel([
      "add",
      "--model-id",
      "fast-1",
      "--provider",
      "custom",
      "--base-url",
      "http://127.0.0.1:8000/v1",
      "--fast-mode",
      "--root",
      tmpRoot,
    ]);
    expect(add.code).toBe(0);
    expect((await entryOf())?.fast_mode).toBe(true);

    // Upsert without either flag keeps the annotation (same merge policy as --vision).
    const keep = await runModel([
      "add",
      "--model-id",
      "fast-1",
      "--provider",
      "custom",
      "--context-window",
      "32768",
      "--root",
      tmpRoot,
    ]);
    expect(keep.code).toBe(0);
    expect((await entryOf())?.fast_mode).toBe(true);

    // --no-fast-mode clears the stored annotation entirely: only `true` is ever persisted
    // (absent = off), so no `fast_mode = false` is written either.
    const off = await runModel([
      "add",
      "--model-id",
      "fast-1",
      "--provider",
      "custom",
      "--no-fast-mode",
      "--root",
      tmpRoot,
    ]);
    expect(off.code).toBe(0);
    expect("fast_mode" in ((await entryOf()) ?? {})).toBe(false);
  });

  it("model default sets the default model under the --root data root (--model-id upstream id + --provider as a pair)", async () => {
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

describe("model add/default/vision: --provider is required, (provider, model_id) pair reference", () => {
  it("missing --provider: commander usage error, nonzero exit code", async () => {
    const bad = await runModel(["default", "--model-id", "deepseek-v4-flash", "--root", tmpRoot]);
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain("--provider");
  });

  it("add without --provider is a usage error too: the group is never inferred, so no config is written", async () => {
    const bad = await runModel([
      "add",
      "--model-id",
      "claude-sonnet-4-6",
      "--api-key",
      "sk-never-stored",
      "--root",
      tmpRoot,
    ]);
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain("--provider");
    // The credential must not have landed on a guessed vendor: nothing was persisted at all.
    await expect(fs.access(projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID))).rejects.toThrow();
  });

  it("dangling reference: the pair is not in models; the error carries the pair reference and a model list hint", async () => {
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

  it("model vision pair reference hit: sets the vision model (written as an inline table)", async () => {
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

describe("penguin config model remove", () => {
  /** Reads back the persisted config, whose pointers are the point of most assertions below. */
  async function readConfig(): Promise<{
    models: Array<Record<string, unknown>>;
    default_model?: TomlModelRef;
    vision_model?: TomlModelRef;
  }> {
    return parseToml(
      await fs.readFile(projectConfigPath(tmpRoot, DEFAULT_PROJECT_ID), "utf8"),
    ) as unknown as {
      models: Array<Record<string, unknown>>;
      default_model?: TomlModelRef;
      vision_model?: TomlModelRef;
    };
  }

  it("removes the named pair and leaves every other entry in place", async () => {
    await runModel(["add", "--model-id", "keep-me", "--provider", "custom", "--root", tmpRoot]);
    await runModel(["add", "--model-id", "drop-me", "--provider", "custom", "--root", tmpRoot]);

    const removed = await runModel([
      "remove",
      "--model-id",
      "drop-me",
      "--provider",
      "custom",
      "--root",
      tmpRoot,
    ]);
    expect(removed.code).toBe(0);
    expect(removed.out).toContain("Removed model (provider=custom, model_id=drop-me).");

    const parsed = await readConfig();
    expect(
      parsed.models.find((m) => m.provider === "custom" && m.model_id === "drop-me"),
    ).toBeUndefined();
    expect(
      parsed.models.find((m) => m.provider === "custom" && m.model_id === "keep-me"),
    ).toBeDefined();
  });

  it("removing the default model clears the pointer, so nothing is left naming a model that is gone", async () => {
    await runModel([
      "add",
      "--model-id",
      "my-default",
      "--provider",
      "custom",
      "--set-default",
      "--root",
      tmpRoot,
    ]);
    expect((await readConfig()).default_model).toEqual({
      provider: "custom",
      model_id: "my-default",
    });

    const removed = await runModel([
      "remove",
      "--model-id",
      "my-default",
      "--provider",
      "custom",
      "--root",
      tmpRoot,
    ]);
    expect(removed.code).toBe(0);
    // The confirmation carries the consequence: the Project no longer has a default model.
    expect(removed.out).toContain("Default model: (unset)");
    expect((await readConfig()).default_model).toBeUndefined();
  });

  it("removing the vision model clears that pointer and says so", async () => {
    await runModel(["add", "--model-id", "my-eyes", "--provider", "custom", "--root", tmpRoot]);
    await runModel(["vision", "--model-id", "my-eyes", "--provider", "custom", "--root", tmpRoot]);

    const removed = await runModel([
      "remove",
      "--model-id",
      "my-eyes",
      "--provider",
      "custom",
      "--root",
      tmpRoot,
    ]);
    expect(removed.code).toBe(0);
    expect(removed.out).toContain("vision model");
    expect((await readConfig()).vision_model).toBeUndefined();
  });

  it("removing an unrelated entry leaves both pointers untouched", async () => {
    await runModel([
      "add",
      "--model-id",
      "the-default",
      "--provider",
      "custom",
      "--set-default",
      "--root",
      tmpRoot,
    ]);
    await runModel(["add", "--model-id", "the-eyes", "--provider", "custom", "--root", tmpRoot]);
    await runModel(["vision", "--model-id", "the-eyes", "--provider", "custom", "--root", tmpRoot]);
    await runModel(["add", "--model-id", "unrelated", "--provider", "custom", "--root", tmpRoot]);

    const removed = await runModel([
      "remove",
      "--model-id",
      "unrelated",
      "--provider",
      "custom",
      "--root",
      tmpRoot,
    ]);
    expect(removed.code).toBe(0);
    expect(removed.out).not.toContain("vision model");

    const parsed = await readConfig();
    expect(parsed.default_model).toEqual({ provider: "custom", model_id: "the-default" });
    expect(parsed.vision_model).toEqual({ provider: "custom", model_id: "the-eyes" });
  });

  it("a pair the config doesn't have: reported on stderr with a nonzero exit code", async () => {
    const missing = await runModel([
      "remove",
      "--model-id",
      "no-such-model",
      "--provider",
      "custom",
      "--root",
      tmpRoot,
    ]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("(provider=custom, model_id=no-such-model)");
    expect(missing.out).toBe("");
  });

  it("the pair is exact: the same upstream id under another group is a different entry and survives", async () => {
    await runModel([
      "add",
      "--model-id",
      "claude-sonnet-4-6",
      "--provider",
      "myproxy",
      "--root",
      tmpRoot,
    ]);

    // Naming the wrong group must not delete the preset entry that happens to share the id.
    const wrongGroup = await runModel([
      "remove",
      "--model-id",
      "claude-sonnet-4-6",
      "--provider",
      "openai",
      "--root",
      tmpRoot,
    ]);
    expect(wrongGroup.code).toBe(1);

    const removed = await runModel([
      "remove",
      "--model-id",
      "claude-sonnet-4-6",
      "--provider",
      "myproxy",
      "--root",
      tmpRoot,
    ]);
    expect(removed.code).toBe(0);

    const parsed = await readConfig();
    expect(
      parsed.models.find((m) => m.provider === "myproxy" && m.model_id === "claude-sonnet-4-6"),
    ).toBeUndefined();
    expect(
      parsed.models.find((m) => m.provider === "anthropic" && m.model_id === "claude-sonnet-4-6"),
    ).toBeDefined();
  });

  it("missing --provider: a bare model_id is a usage error, so no entry is removed by guesswork", async () => {
    await runModel(["add", "--model-id", "guard-me", "--provider", "custom", "--root", tmpRoot]);

    const bad = await runModel(["remove", "--model-id", "guard-me", "--root", tmpRoot]);
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain("--provider");

    const parsed = await readConfig();
    expect(
      parsed.models.find((m) => m.provider === "custom" && m.model_id === "guard-me"),
    ).toBeDefined();
  });
});
