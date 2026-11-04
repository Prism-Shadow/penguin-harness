/**
 * Live authorization using real routes, SQLite, channels and response bodies.
 * - Given a member's open Session stream, removing membership must stop future records,
 *   while the owner continues reading; reopening as the former member is refused.
 * - Given an open Agent API Session stream, deleting its key or disabling the Agent/server
 *   API, or turning keyless access off, must stop future records; new requests are refused.
 * - Revocation is noticed before the next record, or by the heartbeat on an idle stream.
 * - Socket-transported Session subscriptions follow the same rule and release their listener.
 * - Deleting one API key leaves another key's subscription to the same Session live.
 * Only SSE intervals use a fake clock; no provider request is made.
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

describe("existing streams after access revocation", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let admin: ReturnType<typeof apiClient>;
  let memberCookie: string;
  const projectId = "stream_owner-default_project";

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "stream_owner")).cookie);
    memberCookie = (await provisionUser(t.app, "stream_member")).cookie;
    member = apiClient(t.app, memberCookie);
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await t.cleanup();
  });

  describe.each(["record", "heartbeat"])("checked on %s", (check) => {
    it.each(["stream", "amsp"])("stops the former member's /%s subscription", async (endpoint) => {
      expect(
        (await owner.post(`/api/projects/${projectId}/members`, { userId: "stream_member" }))
          .status,
      ).toBe(201);
      const sid = uniqueSessionId();
      t.deps.sessionsRepo.insert(sessionRow(sid, { projectId }));
      const url = `/api/sessions/${sid}/${endpoint}`;
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const response = await member.get(url);
      const control = await owner.get(url);
      expect(response.status).toBe(200);
      expect(control.status).toBe(200);
      const reader = response.body!.getReader();
      const ownerReader = control.body!.getReader();
      try {
        expect(await untilTextOrEnd(reader, "event: ping")).toContain("event: ping");
        await untilTextOrEnd(ownerReader, "event: ping");
        expect(
          (await owner.delete(`/api/projects/${projectId}/members/stream_member`)).status,
        ).toBe(204);
        expect((await member.get(url)).status).toBe(404);
        if (check === "heartbeat") await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
        const marker = "private record produced after membership removal";
        t.deps.channels.get(sid).publish(assistantText(marker));
        const leaked = await untilTextOrEnd(reader, marker);
        expect(await untilTextOrEnd(ownerReader, marker)).toContain(marker);
        expect(leaked).not.toContain(marker);
        expect(t.deps.channels.get(sid).subscriberCount).toBe(1);
      } finally {
        await reader.cancel();
        await ownerReader.cancel();
        vi.useRealTimers();
      }
    });

    it.each(["stream", "amsp"])(
      "ends the former member's socket /%s subscription",
      async (endpoint) => {
        expect(
          (await owner.post(`/api/projects/${projectId}/members`, { userId: "stream_member" }))
            .status,
        ).toBe(201);
        const sid = uniqueSessionId();
        t.deps.sessionsRepo.insert(sessionRow(sid, { projectId }));
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
          const request = new Request(`http://localhost/api/sessions/${sid}/${endpoint}`, {
            headers: { cookie: memberCookie },
          });
          await t.app.fetch(carryStreamAnswer(request, answer));
          expect(frames).toContainEqual(expect.objectContaining({ event: "ping" }));
          t.deps.channels.get(sid).publish(assistantText("before removal"));
          expect(JSON.stringify(frames)).toContain("before removal");
          expect(
            (await owner.delete(`/api/projects/${projectId}/members/stream_member`)).status,
          ).toBe(204);
          if (check === "heartbeat") await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
          t.deps.channels.get(sid).publish(assistantText("after removal"));
          await Promise.resolve();
          expect(JSON.stringify(frames)).not.toContain("after removal");
          expect(frames.at(-1)).toEqual({ id: 1, end: true, reason: "closed" });
          expect(t.deps.channels.get(sid).subscriberCount).toBe(0);
        } finally {
          controller.abort();
          vi.useRealTimers();
        }
      },
    );

    it.each(["key", "agent", "server", "keyless"])(
      "stops an API subscription after revoking %s access",
      async (kind) => {
        const base = "/api/projects/default_project/agents/default_agent/api";
        expect((await admin.put("/api/admin/settings", { agentApiEnabled: true })).status).toBe(
          200,
        );
        expect((await admin.put(base, { enabled: true, open: kind === "keyless" })).status).toBe(
          200,
        );
        const minted = await admin.post(`${base}/keys`, { name: "revocation test" });
        expect(minted.status).toBe(201);
        const key = (await minted.json()) as AgentApiKeyCreateResponse;
        const sid = uniqueSessionId();
        t.deps.sessionsRepo.insert(sessionRow(sid, { client: "api" }));
        const url = `/api/amsp/v1/sessions/${sid}/stream`;
        const request = () =>
          t.app.request(url, {
            headers: kind === "keyless" ? {} : { authorization: `Bearer ${key.secret}` },
          });
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
        const response = await request();
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        try {
          expect(await untilTextOrEnd(reader, "event: ping")).toContain("event: ping");
          if (kind === "key") {
            expect((await admin.delete(`${base}/keys/${key.key.keyId}`)).status).toBe(204);
          } else if (kind === "agent") {
            expect((await admin.put(base, { enabled: false })).status).toBe(200);
          } else if (kind === "keyless") {
            expect((await admin.put(base, { open: false })).status).toBe(200);
          } else {
            expect(
              (await admin.put("/api/admin/settings", { agentApiEnabled: false })).status,
            ).toBe(200);
          }
          expect((await request()).status).toBe(
            kind === "server" ? 403 : kind === "agent" ? 404 : 401,
          );
          if (check === "heartbeat") await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
          const marker = "private record produced after API access revocation";
          t.deps.channels.get(sid).publish(assistantText(marker));
          expect(await untilTextOrEnd(reader, marker)).not.toContain(marker);
        } finally {
          await reader.cancel();
          vi.useRealTimers();
          await admin.put("/api/admin/settings", { agentApiEnabled: true });
          await admin.put(base, { enabled: true });
        }
      },
    );
  });

  it("leaves a second API key's subscription live when the first key is deleted", async () => {
    const base = "/api/projects/default_project/agents/default_agent/api";
    await admin.put(base, { enabled: true, open: false });
    const first = (await (
      await admin.post(`${base}/keys`, { name: "revoked" })
    ).json()) as AgentApiKeyCreateResponse;
    const second = (await (
      await admin.post(`${base}/keys`, { name: "retained" })
    ).json()) as AgentApiKeyCreateResponse;
    const sid = uniqueSessionId();
    t.deps.sessionsRepo.insert(sessionRow(sid, { client: "api" }));
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    try {
      for (const key of [first, second]) {
        const response = await t.app.request(`/api/amsp/v1/sessions/${sid}/stream`, {
          headers: { authorization: `Bearer ${key.secret}` },
        });
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        readers.push(reader);
        await untilTextOrEnd(reader, "event: ping");
      }
      expect((await admin.delete(`${base}/keys/${first.key.keyId}`)).status).toBe(204);
      t.deps.channels.get(sid).publish(assistantText("still authorized"));
      expect(await untilTextOrEnd(readers[0]!, "still authorized")).not.toContain(
        "still authorized",
      );
      expect(await untilTextOrEnd(readers[1]!, "still authorized")).toContain("still authorized");
      expect(t.deps.channels.get(sid).subscriberCount).toBe(1);
    } finally {
      for (const reader of readers) await reader.cancel();
    }
  });
});
