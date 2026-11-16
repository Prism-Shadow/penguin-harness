/**
 * An open Session stream re-asks its route's access on every beat, through real routes, SQLite
 * and channels:
 * - a member taken off the Project stops receiving at the next beat, over HTTP and over the
 *   socket, while the owner's stream goes on;
 * - an Agent API stream whose key was deleted stops at the next beat.
 * Only the SSE interval runs on a fake clock; no provider request is made.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assistantText } from "@prismshadow/penguin-core";
import type { AgentApiKeyCreateResponse } from "../src/api/types.js";
import { HEARTBEAT_MS } from "../src/http/sse.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { carryStreamAnswer, StreamAnswer } from "../src/socket/stream-answer.js";
import type { ServerFrame } from "../src/socket/frames.js";

/** Reads until `text` arrives or the stream ends; returns what was read. */
async function untilTextOrEnd(reader: ReadableStreamDefaultReader<Uint8Array>, text: string) {
  const decoder = new TextDecoder();
  let received = "";
  while (!received.includes(text)) {
    const next = await reader.read();
    if (next.done) break;
    received += decoder.decode(next.value, { stream: true });
  }
  return received;
}

describe("an open Session stream after its reader loses access", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let admin: ReturnType<typeof apiClient>;
  let memberCookie: string;
  const projectId = "stream_owner-default_project";

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "stream_owner")).cookie);
    memberCookie = (await provisionUser(t.app, "stream_member")).cookie;
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await t.cleanup();
  });

  /** A Session of the owner's Project the member can read until removed. */
  async function sharedSession(): Promise<string> {
    const added = await owner.post(`/api/projects/${projectId}/members`, {
      userId: "stream_member",
    });
    expect(added.status).toBe(201);
    const sid = uniqueSessionId();
    t.deps.sessionsRepo.insert(sessionRow(sid, { projectId }));
    return sid;
  }

  const removeMember = async () =>
    expect((await owner.delete(`/api/projects/${projectId}/members/stream_member`)).status).toBe(
      204,
    );

  it("a member taken off the Project stops receiving /stream at the next beat; the owner goes on", async () => {
    const sid = await sharedSession();
    const url = `/api/sessions/${sid}/stream`;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const member = (await apiClient(t.app, memberCookie).get(url)).body!.getReader();
    const control = (await owner.get(url)).body!.getReader();
    try {
      await untilTextOrEnd(member, "event: ping");
      await untilTextOrEnd(control, "event: ping");
      await removeMember();
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      const marker = "a record produced after the member was removed";
      t.deps.channels.get(sid).publish(assistantText(marker));
      expect(await untilTextOrEnd(member, marker)).not.toContain(marker);
      expect(await untilTextOrEnd(control, marker)).toContain(marker);
    } finally {
      await member.cancel();
      await control.cancel();
      vi.useRealTimers();
    }
  });

  it("a member taken off the Project stops receiving /amsp over the socket at the next beat", async () => {
    const sid = await sharedSession();
    const frames: ServerFrame[] = [];
    const controller = new AbortController();
    const answer = new StreamAnswer(
      1,
      (frame) => frames.push(frame),
      controller,
      () => false,
    );
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const request = new Request(`http://localhost/api/sessions/${sid}/amsp`, {
        headers: { cookie: memberCookie },
      });
      await t.app.fetch(carryStreamAnswer(request, answer));
      expect(frames).toContainEqual(expect.objectContaining({ event: "ping" }));
      await removeMember();
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      t.deps.channels.get(sid).publish(assistantText("after removal"));
      await Promise.resolve();
      expect(JSON.stringify(frames)).not.toContain("after removal");
      expect(frames.at(-1)).toEqual({ id: 1, end: true, reason: "closed" });
      expect(t.deps.channels.get(sid).subscriberCount).toBe(0);
    } finally {
      controller.abort();
      vi.useRealTimers();
    }
  });

  it("an Agent API stream whose key was deleted stops at the next beat", async () => {
    const base = "/api/projects/default_project/agents/default_agent/api";
    expect((await admin.put("/api/admin/settings", { agentApiEnabled: true })).status).toBe(200);
    expect((await admin.put(base, { enabled: true, open: false })).status).toBe(200);
    const minted = await admin.post(`${base}/keys`, { name: "revocation test" });
    expect(minted.status).toBe(201);
    const key = (await minted.json()) as AgentApiKeyCreateResponse;
    const sid = uniqueSessionId();
    t.deps.sessionsRepo.insert(sessionRow(sid, { client: "api" }));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const response = await t.app.request(`/api/amsp/v1/sessions/${sid}/stream`, {
      headers: { authorization: `Bearer ${key.secret}` },
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
      await untilTextOrEnd(reader, "event: ping");
      expect((await admin.delete(`${base}/keys/${key.key.keyId}`)).status).toBe(204);
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      const marker = "a record produced after the key was deleted";
      t.deps.channels.get(sid).publish(assistantText(marker));
      expect(await untilTextOrEnd(reader, marker)).not.toContain(marker);
    } finally {
      await reader.cancel();
      vi.useRealTimers();
    }
  });
});
