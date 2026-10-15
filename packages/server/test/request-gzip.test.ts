/**
 * `Content-Encoding: gzip` on `/api/*` request bodies (issue #521).
 *
 * A draft chat has no Session, so file attachments ride the task request itself as base64
 * `data:` URLs — and base64 inflates 4/3 on a wire nothing compresses. The composer gzips the
 * whole serialized request when gzip makes it smaller; the server inflates it back, bounded:
 *
 * - A gzip'd task request with a file attachment lands the file **byte-identical** in the
 *   scratchpad and starts the Task; a plain (uncoded) request takes the old path untouched.
 * - A body that does not decompress is a 400 `bad_request`, never a JSON parse error or 500.
 * - A gzip bomb whose inflated form crosses the derived body cap is a 413
 *   `payload_too_large` — the bound is the inflate (`gunzipSync`'s maxOutputLength), because
 *   the wire cap upstream counted the *compressed* bytes and this tiny body sailed past it.
 * - The steer route's `files` field takes the identical `{fileName, dataUrl}` parts, so a
 *   gzip'd steer body lands its files the same way.
 *
 * The caps these tests compute come from the server's own helper (`bodyLimitBytes`) over the
 * smallest admin-settable budget, the same convention body-limit.test.ts uses — a hardcoded
 * byte count would stop testing the bound the moment the defaults moved.
 */
import zlib from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assistantText, modelVisiblePath, scratchpadDir } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { bodyLimitBytes, MIN_ATTACHMENT_MB } from "../src/services/attachment-limits.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MB = 1024 * 1024;

/** A gzip'd request body: gzip(JSON.stringify(body)), the shape the composer sends. */
function gzipBody(body: unknown): Uint8Array {
  return zlib.gzipSync(Buffer.from(JSON.stringify(body), "utf8"));
}

/** POST with a raw binary body and explicit headers (the apiClient helper JSON-encodes, which is the case under test's *absence*). */
async function postRaw(
  t: TestApp,
  cookie: string,
  apiPath: string,
  body: Uint8Array | string,
  headers: Record<string, string>,
): Promise<Response> {
  return t.app.request(apiPath, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", ...headers },
    body: body as RequestInit["body"],
  });
}

describe("a gzip'd request body", () => {
  let t: TestApp;
  let cookie: string;
  let SID: string;
  let runs: OmniMessage[][];
  let row: ReturnType<typeof adoptSession>;
  let dir: string;

  beforeAll(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "gzposter"));
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    SID = uniqueSessionId();
    runs = [];
    const session = fakeSession(SID, {
      async *run(input: OmniMessage[]) {
        runs.push(input);
        yield assistantText("done");
      },
    });
    row = adoptSession(t.deps, session, { projectId: "gzposter-default_project" });
    dir = path.join(scratchpadDir(t.root, "gzposter-default_project", "default_agent"), SID);
  });

  it("lands a file attachment byte-identical in the scratchpad and starts the Task", async () => {
    // Log-shaped content, because that is what the feature is for: this compresses ~200:1, so
    // the wire body is a rounding error next to what the plain request would have cost.
    const log = Array.from(
      { length: 4096 },
      (_, i) => `2026-10-15 10:00:${i % 60} INFO ok ${i}`,
    ).join("\n");
    const res = await postRaw(
      t,
      cookie,
      `/api/sessions/${SID}/tasks`,
      gzipBody({
        input: [
          { type: "text", text: "read the log" },
          {
            type: "file",
            fileName: "run.log",
            dataUrl: `data:text/plain;base64,${Buffer.from(log).toString("base64")}`,
          },
        ],
      }),
      { "content-encoding": "gzip" },
    );
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
    const text = runs[0]!
      .map((m) => (m.payload as { text?: string }).text ?? "")
      .filter(Boolean)
      .join("\n");
    const filePath = /\[attached file: (.+)\]/.exec(text)![1]!;
    expect(filePath).toBe(modelVisiblePath(path.join(dir, "run.log")));
    // The bytes on disk are the original file, not the gzipped wire form and not the base64 text.
    expect(await fs.readFile(filePath, "utf8")).toBe(log);
  });

  it("a request with no content-encoding takes the plain path unchanged", async () => {
    const res = await postRaw(
      t,
      cookie,
      `/api/sessions/${SID}/tasks`,
      JSON.stringify({ input: [{ type: "text", text: "plain" }] }),
      {},
    );
    expect(res.status).toBe(202);
    await waitFor(() => runs.length === 1);
    expect((runs[0]![0]!.payload as { text: string }).text).toBe("plain");
  });

  it("a body that does not decompress is a 400 and starts no Task", async () => {
    const res = await postRaw(t, cookie, `/api/sessions/${SID}/tasks`, "certainly not gzip", {
      "content-encoding": "gzip",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_request");
    expect(runs).toHaveLength(0);
  });

  it("a bomb inflating past the derived cap is a 413 even though the wire body is tiny", async () => {
    // Smallest admin-settable budget, so the derived cap is as low as it goes and the bomb
    // stays cheap to produce — the same convention body-limit.test.ts uses.
    t.deps.serverSettingsRepo.setAttachmentMaxMb(MIN_ATTACHMENT_MB);
    t.deps.serverSettingsRepo.setAttachmentTotalMb(MIN_ATTACHMENT_MB);
    const cap = bodyLimitBytes({
      attachmentMaxMb: MIN_ATTACHMENT_MB,
      attachmentTotalMb: MIN_ATTACHMENT_MB,
    });
    try {
      // Zeros: ~1000:1. The inflated form is over the cap; the wire form is far under it, so
      // the wire cap upstream passes this request and the inflate bound is what answers 413 —
      // exactly the exposure issue #521 named for a compressed body.
      const bomb = zlib.gzipSync(Buffer.alloc(cap + MB));
      expect(bomb.byteLength).toBeLessThan(cap);
      const res = await postRaw(t, cookie, `/api/sessions/${SID}/tasks`, bomb, {
        "content-encoding": "gzip",
      });
      expect(res.status).toBe(413);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "payload_too_large",
      );
      expect(runs).toHaveLength(0);
    } finally {
      // Other cases in this file run against the shipped defaults.
      t.deps.serverSettingsRepo.setAttachmentMaxMb(100);
      t.deps.serverSettingsRepo.setAttachmentTotalMb(120);
    }
  });

  it("a gzip'd steer body lands its files field in the scratchpad", async () => {
    // The steer route only accepts a RUNNING session, so park one run and steer mid-run —
    // the same fixture convention the task-attachment tests use.
    let release = () => {};
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    // steer() must accept the queue for the route to 202 (the manager refuses on its behalf);
    // the parked run keeps the Session in the running state the steer route requires.
    const parkedSession = fakeSession(SID, {
      steer: () => true,
      async *run(input: OmniMessage[]) {
        runs.push(input);
        await parked;
        yield assistantText("done");
      },
    });
    t.deps.manager.adopt(row, parkedSession);
    await postRaw(
      t,
      cookie,
      `/api/sessions/${SID}/tasks`,
      JSON.stringify({ input: [{ type: "text", text: "busy" }] }),
      {},
    );
    await waitFor(() => t.deps.manager.statusOf(SID) === "running");

    const res = await postRaw(
      t,
      cookie,
      `/api/sessions/${SID}/steer`,
      gzipBody({
        text: "also read this",
        files: [
          {
            fileName: "steered.csv",
            dataUrl: `data:text/csv;base64,${Buffer.from("a,b\n1,2\n").toString("base64")}`,
          },
        ],
      }),
      { "content-encoding": "gzip" },
    );
    expect(res.status).toBe(202);
    // The steer route writes before queueing: the file exists even while the run is parked.
    const steered = path.join(dir, "steered.csv");
    expect(await fs.readFile(steered, "utf8")).toBe("a,b\n1,2\n");
    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });
});
