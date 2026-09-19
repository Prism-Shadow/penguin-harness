import { describe, expect, it } from "vitest";
import {
  formatModelLabel,
  parseSwitchModelCommand,
  switchModelRefusal,
} from "../src/switch-model-command.js";
import { getMessages } from "../src/i18n.js";

describe("parseSwitchModelCommand", () => {
  it("bare /switch-model asks to show the current model", () => {
    expect(parseSwitchModelCommand("/switch-model")).toEqual({ ok: true, target: null });
    expect(parseSwitchModelCommand("  /switch-model   ")).toEqual({ ok: true, target: null });
  });

  it("/switch-model <provider> <model_id> names the target pair, verbatim", () => {
    expect(parseSwitchModelCommand("/switch-model deepseek deepseek-v4-pro")).toEqual({
      ok: true,
      target: { provider: "deepseek", modelId: "deepseek-v4-pro" },
    });
    // Case is kept: a model id is an upstream identifier, not a keyword.
    expect(parseSwitchModelCommand("/switch-model  custom   Qwen3-Coder ")).toEqual({
      ok: true,
      target: { provider: "custom", modelId: "Qwen3-Coder" },
    });
  });

  it("a model id may carry slashes and colons (gateway and local ids)", () => {
    expect(parseSwitchModelCommand("/switch-model openrouter anthropic/claude-opus-5")).toEqual({
      ok: true,
      target: { provider: "openrouter", modelId: "anthropic/claude-opus-5" },
    });
    expect(
      parseSwitchModelCommand("/switch-model fireworks accounts/fireworks/models/deepseek-v4-pro"),
    ).toEqual({
      ok: true,
      target: { provider: "fireworks", modelId: "accounts/fireworks/models/deepseek-v4-pro" },
    });
    expect(parseSwitchModelCommand("/switch-model vllm qwen3:8b")).toEqual({
      ok: true,
      target: { provider: "vllm", modelId: "qwen3:8b" },
    });
  });

  it("anything but exactly two tokens is a usage error (a model id never contains whitespace)", () => {
    expect(parseSwitchModelCommand("/switch-model deepseek-v4-pro")).toEqual({ ok: false });
    expect(parseSwitchModelCommand("/switch-model openrouter claude opus 5")).toEqual({
      ok: false,
    });
  });
});

describe("formatModelLabel", () => {
  it("names the upstream id, then its provider group", () => {
    expect(formatModelLabel("openrouter", "anthropic/claude-opus-5")).toBe(
      "anthropic/claude-opus-5 (openrouter)",
    );
  });
});

describe("switchModelRefusal (409 codes -> one localized line)", () => {
  const t = getMessages("en");
  const target = { provider: "openrouter", modelId: "anthropic/claude-opus-5" };
  const label = "anthropic/claude-opus-5 (openrouter)";
  const refuse = (code: string, detail = "", projectId = "default_project"): string | null =>
    switchModelRefusal({ code, detail }, target, projectId, t);

  it("both busy codes read as busy", () => {
    expect(refuse("task_in_progress")).toBe(t.switchModelBusy());
    expect(refuse("compacting")).toBe(t.switchModelBusy());
  });

  it("same_model and compaction_not_configured", () => {
    expect(refuse("same_model")).toBe(t.switchModelSame(label));
    expect(refuse("compaction_not_configured")).toBe(t.switchModelNoCompaction());
  });

  it("model_not_configured names the config commands, with --project-id only off the default Project", () => {
    expect(refuse("model_not_configured")).toBe(
      t.switchModelNotConfigured(
        label,
        "penguin config model list",
        "penguin config model add --provider openrouter --model-id anthropic/claude-opus-5",
      ),
    );
    expect(refuse("model_not_configured", "", "proj_x")).toBe(
      t.switchModelNotConfigured(
        label,
        "penguin config model list --project-id proj_x",
        "penguin config model add --provider openrouter --model-id anthropic/claude-opus-5 --project-id proj_x",
      ),
    );
  });

  it("model_unavailable carries the server's detail", () => {
    const line = refuse("model_unavailable", "OPENROUTER_API_KEY is not set");
    expect(line).toBe(t.switchModelUnavailable(label, "OPENROUTER_API_KEY is not set"));
    expect(line).toContain("OPENROUTER_API_KEY is not set");
  });

  it("summary_too_large names the target, says to pick a larger window, and carries the server's sizes", () => {
    const detail = "about 15000 tokens vs 8000";
    const line = refuse("summary_too_large", detail);
    expect(line).toBe(t.switchModelSummaryTooLarge(label, detail));
    expect(line).toContain(label);
    expect(line).toContain(detail);
    expect(line).toMatch(/larger context window|上下文窗口更大/);
    expect(refuse("summary_too_large", "")).not.toMatch(/\(\)|（）/);
  });

  it("an unknown code is left to the caller", () => {
    expect(refuse("not_found")).toBeNull();
  });
});
