/**
 * A Session's source (`session_meta.source`): what kind of conversation it is, recorded in
 * every context's meta and carried across a resume. Old Traces are never rewritten; a resume
 * reads their head through `normalizeSessionSource`.
 *
 * Scenarios:
 * - Given no source, when a Session is created, its meta records `user`.
 * - Given a source, when a Session is created, its meta records it unchanged.
 * - Given a Trace head with a source, when the Session resumes, the meta its next context
 *   records carries the same source.
 * - Given a Trace head written before the source was required (none), the retired
 *   `benchmark`, or junk a third party wrote, when the Session resumes, the source reads as
 *   `user`, `cli` and `user` respectively; the file on disk is left as it was.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/index.js";
import { sessionMeta, userText } from "../src/omnimessage/index.js";
import type { OmniMessage, SessionSource } from "../src/omnimessage/index.js";
import { tracesDir } from "../src/state/paths.js";
import { stubProviderKeys } from "./provider-keys.js";

let tmpRoot: string;
let workspace: string;
let prevHome: string | undefined;
let restoreKeys: () => void;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-source-"));
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-source-ws-"));
  process.env.PENGUIN_HOME = tmpRoot;
  restoreKeys = stubProviderKeys();
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  restoreKeys();
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
});

const SID = "session-2026-10-07-10-00-00-5011ce01";

/**
 * A Trace left behind by an earlier process, whose head carries `source` exactly as given:
 * a valid value, the retired `benchmark`, junk, or (undefined) no key at all.
 */
async function writeTrace(source: unknown): Promise<string> {
  const dir = path.join(tracesDir(tmpRoot, "default_project", "default_agent"), "2026-10-07");
  await fs.mkdir(dir, { recursive: true });
  const meta = {
    session_id: SID,
    provider: "anthropic",
    model_id: "claude-sonnet-4-6",
    model_context_window: 1000000,
    system_prompt: "ORIGINAL SYSTEM PROMPT",
    agent_state: "/agent/state",
    workspace,
    ...(source !== undefined ? { source } : {}),
  };
  const records: OmniMessage[] = [
    sessionMeta(meta as Parameters<typeof sessionMeta>[0]),
    userText("hello"),
  ];
  const file = path.join(dir, `${SID}_001.jsonl`);
  await fs.writeFile(file, records.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
  return file;
}

const sourceOf = (session: { metaMessage: OmniMessage }) =>
  (session.metaMessage.payload as { source?: unknown }).source;

describe("creating a Session", () => {
  it("records user when no source is given", async () => {
    const agent = await createAgent();
    const session = await agent.createSession({ workspaceDir: workspace });
    try {
      expect(sourceOf(session)).toBe("user");
    } finally {
      session.dispose();
    }
  });

  it("records the given source unchanged", async () => {
    const agent = await createAgent();
    const session = await agent.createSession({ workspaceDir: workspace, source: "cli" });
    try {
      expect(sourceOf(session)).toBe("cli");
    } finally {
      session.dispose();
    }
  });
});

describe("resuming a Session", () => {
  it("carries the recorded source into the meta its next context records", async () => {
    await writeTrace("schedule" satisfies SessionSource);
    const agent = await createAgent();
    const session = await agent.resumeSession({ sessionId: SID });
    try {
      expect(sourceOf(session)).toBe("schedule");
    } finally {
      session.dispose();
    }
  });

  it.each([
    { head: "no source", value: undefined, reads: "user" },
    { head: "the retired benchmark", value: "benchmark", reads: "cli" },
    { head: "junk", value: "weird-origin", reads: "user" },
  ])("reads a head with $head as $reads, leaving the file as it was", async ({ value, reads }) => {
    const file = await writeTrace(value);
    const before = await fs.readFile(file, "utf8");
    const agent = await createAgent();
    const session = await agent.resumeSession({ sessionId: SID });
    try {
      expect(sourceOf(session)).toBe(reads);
      expect(await fs.readFile(file, "utf8")).toBe(before);
    } finally {
      session.dispose();
    }
  });
});
