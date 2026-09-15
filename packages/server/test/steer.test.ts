/**
 * Integration tests for POST /api/sessions/:id/steer (mid-run steering):
 *   - 202 while a Task is running, forwarding the trimmed text and its images to the core session;
 *   - 400 when neither text nor images nor files carry a message, and for malformed
 *     image URLs / file parts;
 *   - file attachments land in the Session scratchpad and ride the steering text as
 *     `[attached file: <path>]` lines (a 409 cleans them up again);
 *   - the SSE subscribe snapshot carries the pending-steering mirror (task_state), which is
 *     what keeps the composer's "steering queued" hint alive across reloads;
 *   - 409 not_running when the Session is idle (the frontend then falls back to a
 *     normal task POST);
 *   - 404 for foreign/unknown sessions (via the shared resolveSession lookup).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  approvalDecision,
  assistantText,
  scratchpadDir,
  toolCall,
  userSteeringText,
  userText,
} from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-06-10-00-00-ccdd0001";

/** One recorded steer call: the trimmed text plus the images that rode along with it. */
/** A recorded steering input, one `text:`/`img:` line per message, in delivered order. */
const shape = (input: OmniMessage[]): string[] =>
  input.map((m) => {
    const p = m.payload as { type: string; text?: string; image_url?: string };
    return p.type === "image_url" ? `img:${p.image_url}` : `text:${p.text}`;
  });

/** Fake Session that parks on one approval (keeps the Task running) and records steer calls. */
function steeringFakeSession(sessionId: string, steered: OmniMessage[][]): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: (input: OmniMessage[]) => {
      steered.push(input);
      return true;
    },
    // Same contract as core: withdraw by input-list identity, false once "delivered"
    // (tests simulate delivery by emptying `steered`).
    unsteer: (input: OmniMessage[]) => {
      const i = steered.indexOf(input);
      if (i < 0) return false;
      steered.splice(i, 1);
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

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "steerer");
    api = apiClient(t.app, cookie);
    const row: SessionRow = {
      sessionId: SID,
      projectId: "steerer-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    steered = [];
    t.deps.manager.adopt(row, steeringFakeSession(SID, steered));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("idle → 409 not_running (the frontend falls back to a normal task POST)", async () => {
    const res = await api.post(`/api/sessions/${SID}/steer`, { text: "hello" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_running");
    expect(steered).toEqual([]);
  });

  it("running → 202, the trimmed text reaches the core session; a message with nothing in it → 400", async () => {
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    expect((await api.post(`/api/sessions/${SID}/steer`, { text: "  " })).status).toBe(400);
    expect((await api.post(`/api/sessions/${SID}/steer`, { text: 42 })).status).toBe(400);
    expect((await api.post(`/api/sessions/${SID}/steer`, { text: "", images: [] })).status).toBe(
      400,
    );
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

  it("files ride the steering text as [attached file] lines — and carry the message alone", async () => {
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const data = `data:text/plain;base64,${Buffer.from("hello notes").toString("base64")}`;
    const captioned = await api.post(`/api/sessions/${SID}/steer`, {
      text: " read this ",
      files: [{ fileName: "notes.txt", dataUrl: data }],
    });
    expect(captioned.status).toBe(202);
    // A file with no caption is a complete steering message: the attachment line becomes a
    // line-only text message (same shared rule as a task's attachments-only input).
    const bare = await api.post(`/api/sessions/${SID}/steer`, {
      text: "",
      files: [{ fileName: "solo.txt", dataUrl: data }],
    });
    expect(bare.status).toBe(202);

    expect(steered).toHaveLength(2);
    const first = shape(steered[0]!);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(/^text:read this\n\n\[attached file: .*notes\.txt\]$/);
    const second = shape(steered[1]!);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatch(/^text:\[attached file: .*solo\.txt\]$/);
    // The bytes really landed in this Session's scratchpad. Directories are compared via
    // realpath, not string prefixes: on the Windows CI runner the temp root mixes 8.3
    // short and long name forms, so two spellings of the same directory are expected.
    const written = /\[attached file: (.*)\]/.exec(first[0]!)![1]!;
    const expectedDir = path.join(
      scratchpadDir(t.root, "steerer-default_project", "default_agent"),
      SID,
    );
    expect(await realpath(path.dirname(written))).toBe(await realpath(expectedDir));
    expect(path.basename(written)).toBe("notes.txt");
    expect(await readFile(written, "utf8")).toBe("hello notes");

    // Same validation as a task input's file parts, under the steer request's own field name.
    expect(
      (await api.post(`/api/sessions/${SID}/steer`, { text: "x", files: "nope" })).status,
    ).toBe(400);
    const evil = await api.post(`/api/sessions/${SID}/steer`, {
      text: "x",
      files: [{ fileName: "../evil.txt", dataUrl: data }],
    });
    expect(evil.status).toBe(400);
    expect(((await evil.json()) as { error: { message: string } }).error.message).toContain(
      "files[0]",
    );
    expect(
      (
        await api.post(`/api/sessions/${SID}/steer`, {
          text: "x",
          files: [{ fileName: "a.txt", dataUrl: "nope" }],
        })
      ).status,
    ).toBe(400);
    expect(steered).toHaveLength(2);

    t.deps.manager.decideApproval(SID, "tc-steer", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("a 409 steer leaves no attachment behind (the fallback normal send writes its own copy)", async () => {
    const data = `data:text/plain;base64,${Buffer.from("orphan?").toString("base64")}`;
    const res = await api.post(`/api/sessions/${SID}/steer`, {
      text: "",
      files: [{ fileName: "orphan.txt", dataUrl: data }],
    });
    expect(res.status).toBe(409);
    const dir = path.join(scratchpadDir(t.root, "steerer-default_project", "default_agent"), SID);
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });

  it("the SSE subscribe snapshot carries the pending-steering mirror (what makes the hint survive reloads)", async () => {
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    await api.post(`/api/sessions/${SID}/steer`, { text: "hold on" });
    expect(t.deps.manager.pendingSteeringOf(SID)).toEqual([
      { id: expect.any(String), text: "hold on", images: 0, files: 0 },
    ]);

    // The first SSE frames are the initial task_state snapshot: it must carry the mirror.
    const res = await api.get(`/api/sessions/${SID}/stream`);
    const reader = res.body!.getReader();
    let seen = "";
    for (let i = 0; i < 5 && !seen.includes("task_state"); i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(seen).toContain('"task_state"');
    expect(seen).toContain('"pendingSteering"');
    expect(seen).toContain("hold on");

    t.deps.manager.decideApproval(SID, "tc-steer", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("recall (#287): DELETE withdraws the queued entry, returns its original content, and cleans the scratchpad", async () => {
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const png = "data:image/png;base64,AAAA";
    const data = `data:text/plain;base64,${Buffer.from("hello notes").toString("base64")}`;
    const posted = await api.post(`/api/sessions/${SID}/steer`, {
      text: " keep me ",
      images: [png],
      files: [{ fileName: "notes.txt", dataUrl: data }],
    });
    expect(posted.status).toBe(202);
    expect(steered).toHaveLength(1);
    const [info] = t.deps.manager.pendingSteeringOf(SID);
    expect(info).toEqual({ id: expect.any(String), text: "keep me", images: 1, files: 1 });

    // The recall hands the whole message back in the composer's own shape — the file read
    // back from the scratchpad as the very data URL it was submitted as.
    const res = await api.delete(`/api/sessions/${SID}/steer/${info!.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "keep me",
      images: [png],
      files: [{ fileName: "notes.txt", dataUrl: data }],
    });

    // Withdrawn everywhere: core's queue (the fake's unsteer), the mirror, and the disk copy.
    expect(steered).toHaveLength(0);
    expect(t.deps.manager.pendingSteeringOf(SID)).toEqual([]);
    const dir = path.join(scratchpadDir(t.root, "steerer-default_project", "default_agent"), SID);
    expect(await readdir(dir).catch(() => [])).toEqual([]);

    // Nothing left under that id: a second recall (double click, another tab) is a 409.
    const again = await api.delete(`/api/sessions/${SID}/steer/${info!.id}`);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("not_pending");

    t.deps.manager.decideApproval(SID, "tc-steer", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("an interrupt hands undelivered steering back instead of dropping it, and the recall still returns it", async () => {
    // The user's case: the model is mid tool call (this run parks on its approval) when the
    // interrupt lands. Core drops its steering queue as the run exits, so before this the
    // queued message — and everything the user had typed into it — vanished with the run.
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const data = `data:text/plain;base64,${Buffer.from("keep my notes").toString("base64")}`;
    const posted = await api.post(`/api/sessions/${SID}/steer`, {
      text: " wait, do it differently ",
      files: [{ fileName: "notes.txt", dataUrl: data }],
    });
    expect(posted.status).toBe(202);
    const [queued] = t.deps.manager.pendingSteeringOf(SID);
    expect(queued).toEqual({
      id: expect.any(String),
      text: "wait, do it differently",
      images: 0,
      files: 1,
    });

    expect(t.deps.manager.abortTask(SID)).toBe(true);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");

    // Off the queue (nothing is going to deliver it now) but not gone: handed back, under the
    // same id, so the composer can take it from there.
    expect(t.deps.manager.pendingSteeringOf(SID)).toEqual([]);
    expect(t.deps.manager.returnedSteeringOf(SID)).toEqual([queued]);

    // And the recall returns the whole message, attachment included, exactly as a queued one
    // would have — this is what puts it back in the input box.
    const res = await api.delete(`/api/sessions/${SID}/steer/${queued!.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "wait, do it differently",
      images: [],
      files: [{ fileName: "notes.txt", dataUrl: data }],
    });
    expect(t.deps.manager.returnedSteeringOf(SID)).toEqual([]);

    // Taken once only: a second attempt (another tab racing the same handback) is a 409.
    const again = await api.delete(`/api/sessions/${SID}/steer/${queued!.id}`);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("not_pending");
  });

  it("steering the run DID deliver is not handed back", async () => {
    // The mirror is shifted as each [user_steering] message appears on the stream, and the
    // handback runs after that stream is drained. A delivered message must therefore not
    // return to the composer as though the user still owed it.
    const delivering: OmniMessage[][] = [];
    const sid2 = "session-2026-07-06-10-00-00-ccdd0002";
    const row: SessionRow = {
      sessionId: sid2,
      projectId: "steerer-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, {
      ...steeringFakeSession(sid2, delivering),
      async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
        const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-steer" });
        yield tc;
        const decision = await opts.approve(tc);
        yield approvalDecision(decision, "tc-steer");
        // The delivery itself: core emits one such message per queued entry.
        yield userText(userSteeringText("already gone"));
        yield assistantText("done");
      },
    });

    await t.deps.manager.startTask(sid2, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(sid2) === 1);
    await api.post(`/api/sessions/${sid2}/steer`, { text: "already gone" });
    expect(t.deps.manager.pendingSteeringOf(sid2)).toHaveLength(1);

    t.deps.manager.decideApproval(sid2, "tc-steer", "allow");
    await waitFor(() => t.deps.manager.statusOf(sid2) === "idle");

    // Shifted out by the delivery, so the run had nothing left to hand back.
    expect(t.deps.manager.pendingSteeringOf(sid2)).toEqual([]);
    expect(t.deps.manager.returnedSteeringOf(sid2)).toEqual([]);
  });

  it("recall after delivery → 409 not_pending; the mirror entry is left for the stream shift to retire", async () => {
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    await api.post(`/api/sessions/${SID}/steer`, { text: "too late" });
    const [info] = t.deps.manager.pendingSteeringOf(SID);

    // Simulate core having drained the queue (delivery is imminent/underway): the mirror
    // still shows the entry until the [user_steering] message is observed on the stream.
    steered.length = 0;
    const res = await api.delete(`/api/sessions/${SID}/steer/${info!.id}`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_pending");
    expect(t.deps.manager.pendingSteeringOf(SID)).toHaveLength(1);

    t.deps.manager.decideApproval(SID, "tc-steer", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });
});
