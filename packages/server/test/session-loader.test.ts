/**
 * Integration tests for createCoreSessionLoader (#3/#13): failures recovering a
 * historical Session (Workspace deleted / Model removed from config / Trace
 * missing session_meta) all collapse into HttpError(409, session_unrecoverable),
 * preserving the original core message instead of bubbling up as a 500.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgent, saveProjectConfig, sessionMeta, userText } from "@prismshadow/penguin-core";
import type { SessionMetaPayload } from "@prismshadow/penguin-core";
import { createCoreSessionLoader } from "../src/runtime/session-manager.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { HttpError } from "../src/http/errors.js";
import { makeTempRoot, writeTraceFile } from "./helpers.js";

const PROJECT = "project-loader";
const AGENT = "default_agent";
const SID = "session-2026-07-06-11-00-00-abcd0001";

function meta(overrides: Partial<SessionMetaPayload> = {}): SessionMetaPayload {
  return {
    session_id: SID,
    model_id: "custom/m1",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "sp",
    tools: [],
    agent_state: "/tmp/a",
    workspace: path.join("/tmp", "does-not-exist-xyz"),
    ...overrides,
  };
}

function row(workspace: string): SessionRow {
  return {
    sessionId: SID,
    projectId: PROJECT,
    agentId: AGENT,
    modelId: "custom/m1",
    provider: "custom",
    workspace,
    approvalMode: "always-ask",
    title: null,
    createdAt: new Date().toISOString(),
  };
}

describe("session-loader", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempRoot();
    // Initialize Agent State (createAgent creates the directory and system_config.yaml).
    await createAgent({ root, projectId: PROJECT, agentId: AGENT });
    // Configure Model m1 so recovery doesn't fail on a missing Model (unless the test deletes it on purpose).
    await saveProjectConfig(root, PROJECT, {
      default_model: { provider: "custom", model_id: "m1" },
      models: [{ provider: "custom", model_id: "m1", context_window: 1000 }],
    });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("Trace exists but the Workspace was deleted → 409 session_unrecoverable, original message preserved", async () => {
    await writeTraceFile(root, PROJECT, AGENT, "2026-07-06", SID, 1, [
      sessionMeta(meta()), // workspace points to a nonexistent directory
      userText("hi"),
    ]);
    const loader = createCoreSessionLoader(root);
    const err = await loader.load(row("/tmp/does-not-exist-xyz")).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as HttpError).code).toBe("session_unrecoverable");
    expect((err as HttpError).message).toContain("Workspace no longer exists");
  });

  it("Trace exists but the Model was removed from config → 409 session_unrecoverable", async () => {
    const ws = path.join(root, "ws");
    await fs.mkdir(ws, { recursive: true });
    await writeTraceFile(root, PROJECT, AGENT, "2026-07-06", SID, 1, [
      sessionMeta(meta({ model_id: "removed-model", workspace: ws })),
      userText("hi"),
    ]);
    const loader = createCoreSessionLoader(root);
    const err = await loader.load(row(ws)).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as HttpError).code).toBe("session_unrecoverable");
    expect((err as HttpError).message).toContain("Model is not in the Project config");
  });

  it("no Trace and the Workspace deleted (self-heal branch) → 409 workspace_missing", async () => {
    const loader = createCoreSessionLoader(root);
    const err = await loader.load(row("/tmp/gone-workspace-abc")).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as HttpError).code).toBe("workspace_missing");
  });

  it("self-heal rebuild re-records a registry-known origin in the fresh session_meta; unknown stays absent", async () => {
    // The anthropic pair constructs without a credential (the same pair session-index
    // creates over HTTP); custom/m1 would demand a key at client construction.
    await saveProjectConfig(root, PROJECT, {
      default_model: { provider: "anthropic", model_id: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", model_id: "claude-sonnet-4-6", context_window: 1000 }],
    });
    const ws = path.join(root, "ws-heal");
    await fs.mkdir(ws, { recursive: true });
    const healRow: SessionRow = {
      ...row(ws),
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
    };

    // Origin known to this process (e.g. a schedule-created Session rebuilt after adoption):
    // the fresh session_meta must re-record it — meta is the single source of truth, and the
    // rebuilt Session's Trace is the only place the origin can survive.
    const sources = new SessionSources();
    sources.set(SID, "schedule");
    const known = await createCoreSessionLoader(root, sources).load(healRow);
    const knownMeta = (known as unknown as { metaMessage: { payload: { source?: string } } })
      .metaMessage;
    expect(knownMeta.payload.source).toBe("schedule");
    (known as unknown as { dispose(): void }).dispose();

    // No registry entry (e.g. the process restarted and no Trace was ever written): the
    // rebuilt Session is unsourced — no source key is invented.
    const unknown = await createCoreSessionLoader(root, new SessionSources()).load(healRow);
    const unknownMeta = (unknown as unknown as { metaMessage: { payload: object } }).metaMessage;
    expect("source" in unknownMeta.payload).toBe(false);
    (unknown as unknown as { dispose(): void }).dispose();
  });
});
