import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  compactionBegin,
  compactionEnd,
  imageUrlMessage,
  modelVisiblePath,
  requestBegin,
  requestEnd,
  scratchpadDir,
  sessionMeta,
  tokenUsage,
  tracesDir,
  userText,
} from "@prismshadow/penguin-core";
import type { OmniMessage, SessionMetaPayload, TokenCounts } from "@prismshadow/penguin-core";
import type {
  MessagesResponse,
  ProjectCreateResponse,
  SessionForkResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { waitFor } from "./helpers.js";

const SID = "session-2026-08-14-10-00-00-aabbcc01";

function counts(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: total, total };
}

function at(timestamp: string, message: OmniMessage): OmniMessage {
  return { ...message, timestamp };
}

function parkingFakeSession(sessionId: string, until: Promise<void>): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {
      await until;
      yield assistantText("done");
    },
    async *compact() {},
  };
}

describe("session fork", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  let workspace: string;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "fork_owner");
    api = apiClient(t.app, cookie);
    const project = (await (
      await api.post("/api/projects", { projectId: "fork_owner-fork", name: "Fork project" })
    ).json()) as ProjectCreateResponse;
    projectId = project.project.projectId;
    workspace = path.join(t.root, "fork-workspace");
    await fs.mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await t.cleanup();
  });

  async function seedSource(): Promise<{ scratch: string; image: Buffer; row: SessionRow }> {
    const scratch = path.join(scratchpadDir(t.root, projectId, "default_agent"), SID);
    await fs.mkdir(scratch, { recursive: true });
    const image = Buffer.from("89504e470d0a1a0a", "hex");
    await fs.writeFile(path.join(scratch, "photo.png"), image);
    await fs.writeFile(path.join(scratch, "report.txt"), "source attachment", "utf8");
    await fs.mkdir(path.join(scratch, "truncated-tool-output"), { recursive: true });
    await fs.writeFile(
      path.join(scratch, "truncated-tool-output", "recovery.txt"),
      "recovery",
      "utf8",
    );

    const row: SessionRow = {
      sessionId: SID,
      projectId,
      agentId: "default_agent",
      provider: "custom",
      modelId: "fork-model",
      workspace,
      approvalMode: "always-ask",
      title: "Attachment discussion",
      client: "web",
      hasTrace: true,
      lastActiveAt: "2026-08-14T10:01:00.000Z",
      createdAt: "2026-08-14T10:00:00.000Z",
    };
    t.deps.sessionsRepo.insert(row);
    const meta: SessionMetaPayload = {
      session_id: SID,
      provider: "custom",
      model_id: "fork-model",
      model_context_window: 10_000,
      system_prompt: `Session ${SID}; scratchpad ${modelVisiblePath(scratch)}`,
      agent_state: path.join(t.root, projectId, "agents", "default_agent", "agent_state"),
      workspace,
      source: "schedule",
    };
    await writeTraceFile(t.root, projectId, "default_agent", "2026-08-14", SID, 1, [
      at("2026-08-14T10:00:00.000Z", sessionMeta(meta)),
      at(
        "2026-08-14T10:00:01.000Z",
        userText(
          [
            "inspect these",
            `[attached image: ${modelVisiblePath(path.join(scratch, "photo.png"))}]`,
            `[attached file: ${modelVisiblePath(path.join(scratch, "report.txt"))}]`,
            "[attached image: https://example.com/remote.png]",
            "[attached file: /tmp/user-shaped-marker.txt]",
          ].join("\n"),
        ),
      ),
      at("2026-08-14T10:00:01.100Z", imageUrlMessage("data:image/png;base64,aW5saW5l")),
      at("2026-08-14T10:00:02.000Z", requestBegin()),
      at("2026-08-14T10:00:03.000Z", assistantText("first answer")),
      at("2026-08-14T10:00:04.000Z", requestEnd("completed")),
      at("2026-08-14T10:00:04.100Z", tokenUsage(counts(100), counts(100))),
      at("2026-08-14T10:01:01.000Z", userText("later question")),
      at("2026-08-14T10:01:02.000Z", requestBegin()),
      at("2026-08-14T10:01:03.000Z", assistantText("later answer")),
      at("2026-08-14T10:01:04.000Z", requestEnd("completed")),
      at("2026-08-14T10:01:04.100Z", tokenUsage(counts(200), counts(100))),
    ]);
    return { scratch, image, row };
  }

  it("forks through the selected reply, snapshots scratchpad, rewrites local markers, and survives source deletion", async () => {
    const { image } = await seedSource();
    expect((await api.patch(`/api/sessions/${SID}`, { archived: true })).status).toBe(200);
    const history = (await (
      await api.get(`/api/sessions/${SID}/messages`)
    ).json()) as MessagesResponse;
    const selected = history.messages.find(
      (message) => (message.payload as { text?: string }).text === "first answer",
    );
    expect(selected?.tracePosition).toEqual({ fileIndex: 1, ordinal: 4 });

    const response = await api.post(`/api/sessions/${SID}/fork`, {
      position: selected!.tracePosition,
    });
    expect(response.status).toBe(201);
    const { session } = (await response.json()) as SessionForkResponse;
    expect(session.sessionId).not.toBe(SID);
    expect(session).toMatchObject({
      provider: "custom",
      modelId: "fork-model",
      workspace,
      approvalMode: "always-ask",
      title: "Attachment discussion (1)",
      archived: false,
      hasTrace: true,
    });
    expect(session.source).toBeUndefined();

    const forked = (await (
      await api.get(`/api/sessions/${session.sessionId}/messages`)
    ).json()) as MessagesResponse;
    const texts = forked.messages
      .map((message) => (message.payload as { text?: string }).text)
      .filter((text): text is string => text !== undefined);
    expect(texts).toContain("first answer");
    expect(texts).not.toContain("later question");
    expect(texts).not.toContain("later answer");
    const forkUser = texts.find((text) => text.startsWith("inspect these"))!;
    expect(forkUser).toContain(`/scratchpad/${session.sessionId}/photo.png`);
    expect(forkUser).toContain(`/scratchpad/${session.sessionId}/report.txt`);
    expect(forkUser).toContain("https://example.com/remote.png");
    expect(forkUser).toContain("[attached file: /tmp/user-shaped-marker.txt]");
    expect(
      forked.messages.some(
        (message) =>
          (message.payload as { image_url?: string }).image_url ===
          "data:image/png;base64,aW5saW5l",
      ),
    ).toBe(true);
    const forkMeta = forked.messages.find((message) => message.type === "session_meta");
    expect((forkMeta?.payload as SessionMetaPayload).session_id).toBe(session.sessionId);
    expect((forkMeta?.payload as SessionMetaPayload).system_prompt).toContain(session.sessionId);
    expect((forkMeta?.payload as SessionMetaPayload).system_prompt).not.toContain(SID);

    const forkScratch = path.join(
      scratchpadDir(t.root, projectId, "default_agent"),
      session.sessionId,
    );
    expect(await fs.readFile(path.join(forkScratch, "report.txt"), "utf8")).toBe(
      "source attachment",
    );
    expect(
      await fs.readFile(path.join(forkScratch, "truncated-tool-output", "recovery.txt"), "utf8"),
    ).toBe("recovery");
    expect(
      Buffer.from(
        await (
          await api.get(`/api/sessions/${session.sessionId}/scratchpad/photo.png`)
        ).arrayBuffer(),
      ),
    ).toEqual(image);

    const disposableResponse = await api.post(`/api/sessions/${SID}/fork`, {
      position: selected!.tracePosition,
    });
    expect(disposableResponse.status).toBe(201);
    const disposable = (await disposableResponse.json()) as SessionForkResponse;
    expect(disposable.session.title).toBe("Attachment discussion (2)");
    expect((await api.delete(`/api/sessions/${disposable.session.sessionId}`)).status).toBe(204);
    expect(
      await fs.readFile(
        path.join(scratchpadDir(t.root, projectId, "default_agent"), SID, "report.txt"),
        "utf8",
      ),
    ).toBe("source attachment");

    expect((await api.delete(`/api/sessions/${SID}`)).status).toBe(204);
    expect(
      Buffer.from(
        await (
          await api.get(`/api/sessions/${session.sessionId}/scratchpad/photo.png`)
        ).arrayBuffer(),
      ),
    ).toEqual(image);
    expect((await api.get(`/api/sessions/${session.sessionId}`)).status).toBe(200);
  });

  it("shares one persistent number sequence across different reply positions", async () => {
    await seedSource();

    const first = (await (
      await api.post(`/api/sessions/${SID}/fork`, {
        position: { fileIndex: 1, ordinal: 4 },
      })
    ).json()) as SessionForkResponse;
    const second = (await (
      await api.post(`/api/sessions/${SID}/fork`, {
        position: { fileIndex: 1, ordinal: 9 },
      })
    ).json()) as SessionForkResponse;
    expect(first.session.title).toBe("Attachment discussion (1)");
    expect(second.session.title).toBe("Attachment discussion (2)");

    expect((await api.delete(`/api/sessions/${first.session.sessionId}`)).status).toBe(204);
    const third = (await (
      await api.post(`/api/sessions/${SID}/fork`, {
        position: { fileIndex: 1, ordinal: 4 },
      })
    ).json()) as SessionForkResponse;
    expect(third.session.title).toBe("Attachment discussion (3)");
  });

  it("uses a readable numbered fallback when the source has no title", async () => {
    await seedSource();
    t.deps.db.prepare("UPDATE sessions SET title = NULL WHERE session_id = ?").run(SID);

    const response = await api.post(`/api/sessions/${SID}/fork`, {
      position: { fileIndex: 1, ordinal: 4 },
    });
    expect(response.status).toBe(201);
    const { session } = (await response.json()) as SessionForkResponse;
    expect(session.title).toBe("(1)");
  });

  it("rejects a user-message coordinate rather than cutting an unsafe prefix", async () => {
    await seedSource();
    const response = await api.post(`/api/sessions/${SID}/fork`, {
      position: { fileIndex: 1, ordinal: 1 },
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_fork_position",
    );
  });

  it("returns 409 while the source Session is running", async () => {
    const { row } = await seedSource();
    let release = () => {};
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, parkingFakeSession(SID, parked));
    await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "busy" }] });
    await waitFor(() => t.deps.manager.statusOf(SID) === "running");

    const response = await api.post(`/api/sessions/${SID}/fork`, {
      position: { fileIndex: 1, ordinal: 4 },
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "task_in_progress",
    );

    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("treats a missing scratchpad as empty and deleting the fork leaves the source intact", async () => {
    const { scratch } = await seedSource();
    await fs.rm(scratch, { recursive: true, force: true });

    const response = await api.post(`/api/sessions/${SID}/fork`, {
      position: { fileIndex: 1, ordinal: 4 },
    });
    expect(response.status).toBe(201);
    const { session } = (await response.json()) as SessionForkResponse;
    expect((await api.delete(`/api/sessions/${session.sessionId}`)).status).toBe(204);

    const source = (await (
      await api.get(`/api/sessions/${SID}/messages`)
    ).json()) as MessagesResponse;
    expect(
      source.messages.some(
        (message) => (message.payload as { text?: string }).text === "later answer",
      ),
    ).toBe(true);
    expect((await api.get(`/api/sessions/${SID}`)).status).toBe(200);
  });

  it("clones completed earlier shards, cuts the selected shard, and exposes stable positions on a tail page", async () => {
    const { scratch } = await seedSource();
    const meta: SessionMetaPayload = {
      session_id: SID,
      provider: "custom",
      model_id: "fork-model",
      model_context_window: 10_000,
      system_prompt: `Session ${SID}; scratchpad ${modelVisiblePath(scratch)}`,
      agent_state: path.join(t.root, projectId, "agents", "default_agent", "agent_state"),
      workspace,
    };
    const compaction = [
      at(
        "2026-08-14T10:01:05.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 500, turns: 2 }),
      ),
      at("2026-08-14T10:01:05.100Z", requestBegin()),
      at("2026-08-14T10:01:05.200Z", assistantText("[summary]summary[/summary]")),
      at("2026-08-14T10:01:05.300Z", requestEnd("completed")),
      at(
        "2026-08-14T10:01:05.400Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
      ),
    ];
    await fs.appendFile(
      path.join(tracesDir(t.root, projectId, "default_agent"), "2026-08-14", `${SID}_001.jsonl`),
      compaction.map((message) => JSON.stringify(message)).join("\n") + "\n",
      "utf8",
    );
    await writeTraceFile(t.root, projectId, "default_agent", "2026-08-14", SID, 2, [
      at("2026-08-14T10:01:05.000Z", sessionMeta(meta)),
      at("2026-08-14T10:01:06.000Z", userText("[context_summary]\nsummary\n[/context_summary]")),
      at("2026-08-14T10:01:07.000Z", userText("after compaction")),
      at("2026-08-14T10:01:08.000Z", requestBegin()),
      at("2026-08-14T10:01:09.000Z", assistantText("fork shard two")),
      at("2026-08-14T10:01:10.000Z", requestEnd("completed")),
      at("2026-08-14T10:01:10.100Z", tokenUsage(counts(300), counts(100))),
      at("2026-08-14T10:02:00.000Z", userText("excluded shard tail")),
    ]);

    const tail = (await (
      await api.get(`/api/sessions/${SID}/messages?tailLimit=2`)
    ).json()) as MessagesResponse;
    const selected = tail.messages.find(
      (message) => (message.payload as { text?: string }).text === "fork shard two",
    );
    expect(selected?.tracePosition).toEqual({ fileIndex: 2, ordinal: 4 });

    const response = await api.post(`/api/sessions/${SID}/fork`, {
      position: selected!.tracePosition,
    });
    expect(response.status).toBe(201);
    const { session } = (await response.json()) as SessionForkResponse;
    const forked = (await (
      await api.get(`/api/sessions/${session.sessionId}/messages`)
    ).json()) as MessagesResponse;
    const metas = forked.messages.filter((message) => message.type === "session_meta");
    expect(metas).toHaveLength(2);
    expect(
      metas.every(
        (message) => (message.payload as SessionMetaPayload).session_id === session.sessionId,
      ),
    ).toBe(true);
    expect(
      forked.messages.some(
        (message) => (message.payload as { text?: string }).text === "first answer",
      ),
    ).toBe(true);
    expect(
      forked.messages.some(
        (message) => (message.payload as { text?: string }).text === "fork shard two",
      ),
    ).toBe(true);
    expect(
      forked.messages.some(
        (message) => (message.payload as { text?: string }).text === "excluded shard tail",
      ),
    ).toBe(false);
  });

  it("rejects an intermediate assistant segment and a hidden compaction summary", async () => {
    await seedSource();
    const meta: SessionMetaPayload = {
      session_id: SID,
      provider: "custom",
      model_id: "fork-model",
      model_context_window: 10_000,
      system_prompt: `Session ${SID}`,
      agent_state: path.join(t.root, projectId, "agents", "default_agent", "agent_state"),
      workspace,
    };
    await writeTraceFile(t.root, projectId, "default_agent", "2026-08-15", SID, 2, [
      at("2026-08-15T10:00:00.000Z", sessionMeta(meta)),
      at("2026-08-15T10:00:01.000Z", userText("tool task")),
      at("2026-08-15T10:00:02.000Z", requestBegin()),
      at("2026-08-15T10:00:03.000Z", assistantText("intermediate")),
      at("2026-08-15T10:00:04.000Z", requestEnd("completed")),
      at("2026-08-15T10:00:05.000Z", requestBegin()),
      at("2026-08-15T10:00:06.000Z", assistantText("final")),
      at("2026-08-15T10:00:07.000Z", requestEnd("completed")),
      at(
        "2026-08-15T10:00:08.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 500, turns: 1 }),
      ),
      at("2026-08-15T10:00:09.000Z", requestBegin()),
      at("2026-08-15T10:00:10.000Z", assistantText("[summary]hidden[/summary]")),
      at("2026-08-15T10:00:11.000Z", requestEnd("completed")),
      at(
        "2026-08-15T10:00:12.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
      ),
    ]);

    for (const ordinal of [3, 10]) {
      const response = await api.post(`/api/sessions/${SID}/fork`, {
        position: { fileIndex: 2, ordinal },
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "invalid_fork_position",
      );
    }

    const beforeCompaction = await api.post(`/api/sessions/${SID}/fork`, {
      position: { fileIndex: 2, ordinal: 6 },
    });
    expect(beforeCompaction.status).toBe(201);
    const { session } = (await beforeCompaction.json()) as SessionForkResponse;
    const forked = (await (
      await api.get(`/api/sessions/${session.sessionId}/messages`)
    ).json()) as MessagesResponse;
    expect(
      forked.messages.some(
        (message) =>
          message.type === "event_msg" &&
          (message.payload as { type?: string }).type === "compaction_begin",
      ),
    ).toBe(false);
  });

  it("gives concurrent forks unique Sessions without overwriting the source", async () => {
    await seedSource();
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        api.post(`/api/sessions/${SID}/fork`, {
          position: { fileIndex: 1, ordinal: 4 },
        }),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const sessions = await Promise.all(
      responses.map(async (response) => ((await response.json()) as SessionForkResponse).session),
    );
    const ids = sessions.map((session) => session.sessionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sessions.map((session) => session.title).sort()).toEqual([
      "Attachment discussion (1)",
      "Attachment discussion (2)",
      "Attachment discussion (3)",
      "Attachment discussion (4)",
    ]);
    expect((await api.get(`/api/sessions/${SID}`)).status).toBe(200);
  });

  it("does not reveal the fork endpoint to a user without Project access", async () => {
    await seedSource();
    const { cookie } = await provisionUser(t.app, "fork_outsider");
    const outsider = apiClient(t.app, cookie);
    const response = await outsider.post(`/api/sessions/${SID}/fork`, {
      position: { fileIndex: 1, ordinal: 4 },
    });
    expect(response.status).toBe(404);
  });
});
