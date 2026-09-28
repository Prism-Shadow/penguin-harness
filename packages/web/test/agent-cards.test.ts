import { describe, expect, it } from "vitest";
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryResponse,
} from "@prismshadow/penguin-server/api";
import {
  buildAgentCards,
  cardReadiness,
  currentModel,
  effortOptionOf,
} from "../src/features/coding-agents/agent-cards";

const model: CodingAgentConfigOption = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "fast",
  options: [
    { value: "fast", name: "Fast" },
    { value: "deep", name: "Deep" },
  ],
};
const effort: CodingAgentConfigOption = {
  id: "effort",
  name: "Effort",
  category: "thought_level",
  type: "select",
  currentValue: "medium",
  options: [{ value: "medium", name: "Medium" }],
};

function discovery(
  candidates: Partial<CodingAgentDiscoveryResponse["candidates"][number]>[],
  agentModels: CodingAgentDiscoveryResponse["agentModels"] = {},
): CodingAgentDiscoveryResponse {
  return {
    agentModels,
    candidates: candidates.map((c) => ({
      recipeId: "x",
      title: "X",
      homepageUrl: "https://example.com",
      detected: true,
      launch: { command: "x", args: [] },
      authHint: "",
      setupHint: null,
      alreadyAdded: false,
      rememberedModel: null,
      ...c,
    })),
  };
}

describe("buildAgentCards", () => {
  it("splits installed from available and names who makes each agent", () => {
    const { installed, available } = buildAgentCards(
      [],
      discovery([
        { recipeId: "codex", title: "Codex CLI", version: "codex-cli 0.146.0", authStatus: "ok" },
        { recipeId: "cline", title: "Cline", detected: false, launch: null, setupHint: null },
      ]),
      "Setup required",
    );
    expect(installed).toEqual([
      expect.objectContaining({
        agentId: "codex",
        vendor: "OpenAI official CLI",
        version: "codex-cli 0.146.0",
        authStatus: "ok",
        startable: true,
      }),
    ]);
    expect(available).toEqual([
      expect.objectContaining({ agentId: "cline", startable: false, setupHint: "Setup required" }),
    ]);
  });

  it("lets a saved command override the recipe's, and lists custom agents too", () => {
    const { installed } = buildAgentCards(
      [
        { id: "codex", command: "my-codex", args: ["--acp"] },
        { id: "custom", title: "Custom", command: "agent", args: [] },
      ],
      discovery([{ recipeId: "codex", title: "Codex CLI", detected: false, launch: null }]),
      "",
    );
    expect(installed.map((c) => [c.agentId, c.commandLine, c.startable])).toEqual([
      ["codex", "my-codex --acp", true],
      ["custom", "agent", true],
    ]);
  });

  it("prefers a saved definition's own probe over the recipe's", () => {
    const { installed } = buildAgentCards(
      [{ id: "codex", command: "codex-acp", args: [] }],
      discovery([{ recipeId: "codex", models: [effort] }], { codex: [model] }),
      "",
    );
    expect(installed[0]!.options).toEqual([model]);
  });
});

describe("currentModel and effortOptionOf", () => {
  const base = {
    key: "k",
    agentId: "codex",
    title: "Codex",
    commandLine: "codex-acp",
    saved: true,
    startable: true,
  };

  it("shows the remembered model when it belongs to the advertised option", () => {
    expect(
      currentModel({
        ...base,
        options: [model],
        rememberedModel: { configId: "model", value: "deep" },
      }),
    ).toEqual({ value: "deep", name: "Deep" });
    expect(currentModel({ ...base, options: [model], rememberedModel: null })).toEqual({
      value: "fast",
      name: "Fast",
    });
  });

  it("still names a remembered model before any probe has run", () => {
    expect(
      currentModel({
        ...base,
        rememberedModel: { configId: "model", value: "gpt-5", name: "GPT-5" },
      }),
    ).toEqual({ value: "gpt-5", name: "GPT-5" });
    expect(currentModel(base)).toBeNull();
  });

  it("finds the reasoning effort only when the agent advertises one", () => {
    expect(effortOptionOf([model, effort])).toBe(effort);
    expect(effortOptionOf([model])).toBeUndefined();
  });
});

describe("cardReadiness", () => {
  const card = (c: Partial<CodingAgentDiscoveryResponse["candidates"][number]>) =>
    buildAgentCards([], discovery([{ recipeId: "codex", ...c }]), "setup").installed[0]!;

  it("is ready only when the agent can start and is signed in", () => {
    expect(cardReadiness(card({ authStatus: "ok" }))).toBe("ready");
  });

  it("asks for sign-in before anything else it can say", () => {
    expect(cardReadiness(card({ authStatus: "missing" }))).toBe("signIn");
    expect(card({ authStatus: "missing", authHint: "Run codex login" }).authHint).toBe(
      "Run codex login",
    );
  });

  it("needs setup when the CLI is found but nothing can launch it", () => {
    expect(cardReadiness(card({ launch: null, authStatus: "ok" }))).toBe("setup");
  });

  it("says it cannot tell when no sign-in check answered", () => {
    expect(cardReadiness(card({ authStatus: "unknown" }))).toBe("unknown");
    expect(cardReadiness(card({}))).toBe("unknown");
  });

  it("trusts a saved custom agent to start, with sign-in unknown", () => {
    const { installed } = buildAgentCards(
      [{ id: "mine", command: "mine", args: [] }],
      discovery([]),
      "setup",
    );
    expect(cardReadiness(installed[0]!)).toBe("unknown");
  });
});

describe("probe failures and installs", () => {
  it("marks an agent whose last probe failed as unable to start", () => {
    const { installed } = buildAgentCards(
      [],
      discovery([{ recipeId: "gemini", authStatus: "ok", probeError: "no longer supported" }]),
      "setup",
    );
    expect(installed[0]?.probeError).toBe("no longer supported");
    expect(cardReadiness(installed[0]!)).toBe("failed");
  });

  it("reads a saved definition's failure from its own probe", () => {
    const { installed } = buildAgentCards(
      [{ id: "gemini", command: "gemini", args: [] }],
      {
        ...discovery([{ recipeId: "gemini", probeError: "recipe" }]),
        agentErrors: { gemini: "own" },
      },
      "setup",
    );
    expect(installed[0]?.probeError).toBe("own");
  });

  it("carries the install command to an agent that is not installed", () => {
    const { available } = buildAgentCards(
      [],
      discovery([
        { recipeId: "kilo", detected: false, launch: null, installCommand: "npm i -g k" },
      ]),
      "setup",
    );
    expect(available[0]).toMatchObject({ installCommand: "npm i -g k", vendor: "Kilo Code CLI" });
  });
});
