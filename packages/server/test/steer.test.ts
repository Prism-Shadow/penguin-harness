/**
 * Integration tests for POST /api/sessions/:id/steer (mid-run steering):
 *   - 202 while a Task is running, forwarding text, images, and scratchpad-backed files;
 *   - 400 when no part carries a message, and for malformed image/file payloads;
 *   - 409 not_running when the Session is idle (the frontend then falls back to a
 *     normal task POST);
 *   - 404 for foreign/unknown sessions (via the shared resolveSession lookup).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  approvalDecision,
  assistantText,
  scratchpadDir,
  toolCall,
  userText,
} from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-06-10-00-00-ccdd0001";
const PROJECT_ID = "steerer-default_project";

/** One recorded steer call: the trimmed text plus the images that rode along with it. */
/** A recorded steering input, one `text:`/`img:` line per message, in delivered order. */
const shape = (input: OmniMessage[]): string[] =>
  input.map((m) => {
    const p = m.payload as { type: string; text?: string; image_url?: string };
    return p.type === "image_url" ? `img:${p.image_url}` : `text:${p.text}`;
  });

/** Fake Session that parks on one approval (keeps the Task running) and records steer calls. */
function steeringFakeSession(
  sessionId: string,
  steered: OmniMessage[][],
  accepts: () => boolean,
): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: (input: OmniMessage[]) => {
      if (!accepts()) return false;
      steered.push(input);
      return true;
    },
    skipReconnectWait: () => false,
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-steer" });
      yield tc;
      const decision = await opts.approve(tc);
      yield approvalDecision(decision, "tc-steer");
      yield assistantText("done");
    },
    async *compact() {},
  };
}

describe("steer route", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let steered: OmniMessage[][];
  let acceptsSteering: boolean;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "steerer");
    api = apiClient(t.app, cookie);
    const row: SessionRow = {
      sessionId: SID,
      projectId: PROJECT_ID,
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    steered = [];
    acceptsSteering = true;
    t.deps.manager.adopt(
      row,
      steeringFakeSession(SID, steered, () => acceptsSteering),
    );
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("idle → 409 not_running (the frontend falls back to a normal task POST)", async () => {
    const res = await api.post(`/api/sessions/${SID}/steer`, {
      text: "",
      files: [{ fileName: "idle.txt", dataUrl: dataUrl("not written") }],
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_running");
    expect(steered).toEqual([]);
    const dir = path.join(scratchpadDir(t.root, PROJECT_ID, "default_agent"), SID);
    await expect(fs.access(dir)).rejects.toThrow();
  });

  it("files land in the scratchpad and ride inside the steering text, with or without a caption", async () => {
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const bare = await api.post(`/api/sessions/${SID}/steer`, {
      text: "",
      files: [{ fileName: "notes.txt", dataUrl: dataUrl("file-only") }],
    });
    expect(bare.status).toBe(202);
    const dir = path.join(scratchpadDir(t.root, PROJECT_ID, "default_agent"), SID);
    const barePath = path.join(dir, "notes.txt");
    expect(steered.map(shape)).toEqual([[`text:[attached file: ${barePath}]`]]);
    expect(await fs.readFile(barePath, "utf8")).toBe("file-only");

    const captioned = await api.post(`/api/sessions/${SID}/steer`, {
      text: " review this ",
      files: [{ fileName: "report.md", dataUrl: dataUrl("# report") }],
    });
    expect(captioned.status).toBe(202);
    const reportPath = path.join(dir, "report.md");
    expect(steered.map(shape)[1]).toEqual([`text:review this\n\n[attached file: ${reportPath}]`]);
    expect(await fs.readFile(reportPath, "utf8")).toBe("# report");

    t.deps.manager.decideApproval(SID, "tc-steer", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("removes files when the running Task wins the write-versus-finish race", async () => {
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    acceptsSteering = false; // Simulates core finishing between the route preflight and steer().

    const res = await api.post(`/api/sessions/${SID}/steer`, {
      text: "",
      files: [{ fileName: "late.txt", dataUrl: dataUrl("orphan") }],
    });
    expect(res.status).toBe(409);
    const dir = path.join(scratchpadDir(t.root, PROJECT_ID, "default_agent"), SID);
    expect(await fs.readdir(dir).catch(() => [])).toEqual([]);

    t.deps.manager.decideApproval(SID, "tc-steer", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("running → 202, the trimmed text reaches the core session; a message with nothing in it → 400", async () => {
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    expect((await api.post(`/api/sessions/${SID}/steer`, { text: "  " })).status).toBe(400);
    expect((await api.post(`/api/sessions/${SID}/steer`, { text: 42 })).status).toBe(400);
    expect((await api.post(`/api/sessions/${SID}/steer`, { text: "", images: [] })).status).toBe(
      400,
    );
    expect((await api.post(`/api/sessions/${SID}/steer`, { text: "x", files: {} })).status).toBe(
      400,
    );
    expect(
      (
        await api.post(`/api/sessions/${SID}/steer`, {
          text: "x",
          files: [{ fileName: "../escape.txt", dataUrl: dataUrl("x") }],
        })
      ).status,
    ).toBe(400);
    expect(steered).toEqual([]);

    const ok = await api.post(`/api/sessions/${SID}/steer`, { text: "  focus on tests  " });
    expect(ok.status).toBe(202);
    expect(steered.map(shape)).toEqual([["text:focus on tests"]]);

    t.deps.manager.decideApproval(SID, "tc-steer", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("images ride along with the steering text — and carry it alone when there is none", async () => {
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const png = "data:image/png;base64,AAAA";
    const captioned = await api.post(`/api/sessions/${SID}/steer`, {
      text: " look at this ",
      images: [png, "https://example.com/shot.png"],
    });
    expect(captioned.status).toBe(202);
    // An image with no caption is a complete steering message: empty text is accepted here.
    const bare = await api.post(`/api/sessions/${SID}/steer`, { text: "", images: [png] });
    expect(bare.status).toBe(202);
    // The route hands core the same message list a task input would carry — and drops the
    // text message entirely when the images are the whole message, so a fold's path lines
    // aren't preceded by an empty line.
    expect(steered.map(shape)).toEqual([
      ["text:look at this", `img:${png}`, "img:https://example.com/shot.png"],
      [`img:${png}`],
    ]);

    // Same URL rule as a task input's imageUrl; a non-array images field is rejected outright.
    expect(
      (await api.post(`/api/sessions/${SID}/steer`, { text: "x", images: ["/etc/passwd"] })).status,
    ).toBe(400);
    expect((await api.post(`/api/sessions/${SID}/steer`, { text: "x", images: png })).status).toBe(
      400,
    );
    // The data: body is checked here, not left to core: a URL core cannot parse comes back as
    // an "could not be saved" line inside the delivered message, which for an HTTP caller is a
    // 202 and then a picture quietly missing. These are the shapes that get that far.
    for (const bad of [
      "data:image/png", // no ;base64, marker at all
      "data:image/png;base64,", // marker, empty body
      "data:image/png;base64,not base64!", // body outside the base64 alphabet
      "data:,aGk=", // no mime
      "data:image/png;charset=utf-8;base64,aGk=", // an extra parameter core's parse rejects
    ]) {
      expect(
        (await api.post(`/api/sessions/${SID}/steer`, { text: "x", images: [bad] })).status,
      ).toBe(400);
    }
    expect(steered).toHaveLength(2);

    t.deps.manager.decideApproval(SID, "tc-steer", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("unknown session → 404", async () => {
    const res = await api.post(`/api/sessions/session-ghost/steer`, { text: "x" });
    expect(res.status).toBe(404);
  });
});

function dataUrl(content: string): string {
  return `data:text/plain;base64,${Buffer.from(content).toString("base64")}`;
}
