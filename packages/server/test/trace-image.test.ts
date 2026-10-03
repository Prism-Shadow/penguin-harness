/**
 * Images by reference on windowed history pages, and the route that serves them,
 * `GET /api/sessions/:sessionId/trace-image?file=&ordinal=[&i=]`.
 *
 * - Given a Trace holding a user image and a tool output with two screenshots, a windowed
 *   page carries route URLs in their place, and each URL answers exactly that image's bytes
 *   with its type, an immutable private cache and nosniff.
 * - The parameterless full read still carries every data URL.
 * - An image type the route does not serve (SVG) stays inline on the windowed page.
 * - A caller without access to the Session gets 404 session_not_found and an anonymous one
 *   401; neither gets the bytes.
 * - A record without an image, a slot past the end, an ordinal past the end and an unknown
 *   file answer 404 trace_image_not_found; missing or malformed parameters answer 400.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assistantText,
  imageUrlMessage,
  requestBegin,
  requestEnd,
  sessionMeta,
  toolCall,
  toolCallOutput,
  userText,
} from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { HistoryMessage, MessagesResponse } from "../src/api/types.js";
import { sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "imager-default_project";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

type Payload = { type?: string; text?: string; image_url?: string; images?: string[] };
const payloadOf = (m: OmniMessage) => m.payload as Payload;

describe("images by reference", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let SID: string;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "imager")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "outsider")).cookie);
    SID = uniqueSessionId();
    t.deps.sessionsRepo.insert(sessionRow(SID, { projectId: PROJECT }));
    await writeTraceFile(t.root, PROJECT, "default_agent", "2026-09-01", SID, 1, [
      sessionMeta({
        session_id: SID,
        provider: "custom",
        model_id: "m1",
        model_context_window: 10_000,
        system_prompt: "sp",
        agent_state: "/tmp/a",
        workspace: "/tmp/w",
      }),
      userText("look at these"), // 1
      imageUrlMessage(dataUrl("image/png", PNG)), // 2
      imageUrlMessage(dataUrl("image/svg+xml", SVG)), // 3
      requestBegin(), // 4
      toolCall({ name: "browser_screenshot", arguments: "{}", toolCallId: "t1" }), // 5
      toolCallOutput({
        output: "two shots",
        toolCallId: "t1",
        images: [dataUrl("image/jpeg", JPEG), dataUrl("image/png", PNG)],
      }), // 6
      assistantText("done"), // 7
      requestEnd("completed"), // 8
    ]);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const tailPage = async (): Promise<HistoryMessage[]> => {
    const res = await api.get(`/api/sessions/${SID}/messages?tailLimit=20`);
    expect(res.status).toBe(200);
    return ((await res.json()) as MessagesResponse).messages;
  };
  const errorCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;

  it("a windowed page carries URLs that answer each image's bytes, immutable and typed", async () => {
    const messages = await tailPage();
    const userImage = payloadOf(messages[2]!);
    const output = payloadOf(messages.find((m) => payloadOf(m).type === "tool_call_output")!);
    expect(userImage.image_url).toBe(`/api/sessions/${SID}/trace-image?file=1&ordinal=2`);
    expect(output.images).toEqual([
      `/api/sessions/${SID}/trace-image?file=1&ordinal=6&i=0`,
      `/api/sessions/${SID}/trace-image?file=1&ordinal=6&i=1`,
    ]);

    const served = [
      [userImage.image_url!, "image/png", PNG],
      [output.images![0]!, "image/jpeg", JPEG],
      [output.images![1]!, "image/png", PNG],
    ] as const;
    for (const [url, mime, bytes] of served) {
      const res = await api.get(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(mime);
      expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    }
  });

  it("the full read keeps every image inline", async () => {
    const res = await api.get(`/api/sessions/${SID}/messages`);
    const { messages } = (await res.json()) as MessagesResponse;
    expect(payloadOf(messages[2]!).image_url).toBe(dataUrl("image/png", PNG));
    expect(payloadOf(messages[6]!).images).toEqual([
      dataUrl("image/jpeg", JPEG),
      dataUrl("image/png", PNG),
    ]);
  });

  it("an image type the route does not serve stays inline, and its slot is not served", async () => {
    const messages = await tailPage();
    expect(payloadOf(messages[3]!).image_url).toBe(dataUrl("image/svg+xml", SVG));
    const res = await api.get(`/api/sessions/${SID}/trace-image?file=1&ordinal=3`);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("trace_image_not_found");
  });

  it("a caller without access, or without a sign-in, gets no bytes", async () => {
    const url = `/api/sessions/${SID}/trace-image?file=1&ordinal=2`;
    const denied = await outsider.get(url);
    expect(denied.status).toBe(404);
    expect(await errorCode(denied)).toBe("session_not_found");
    const anonymous = await t.app.request(url);
    expect(anonymous.status).toBe(401);
  });

  it.each([
    ["a record without an image", "file=1&ordinal=1"],
    ["a user image asked for as a tool slot", "file=1&ordinal=2&i=0"],
    ["a tool output asked for without a slot", "file=1&ordinal=6"],
    ["a slot past the end", "file=1&ordinal=6&i=2"],
    ["an ordinal past the end", "file=1&ordinal=99"],
    ["an unknown file", "file=2&ordinal=2"],
  ])("%s answers 404 trace_image_not_found", async (_case, query) => {
    const res = await api.get(`/api/sessions/${SID}/trace-image?${query}`);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("trace_image_not_found");
  });

  it.each([
    ["no file", "ordinal=2"],
    ["no ordinal", "file=1"],
    ["file 0", "file=0&ordinal=2"],
    ["a negative ordinal", "file=1&ordinal=-1"],
    ["a non-numeric slot", "file=1&ordinal=6&i=x"],
    ["a path in file", "file=..%2F1&ordinal=2"],
  ])("%s answers 400", async (_case, query) => {
    const res = await api.get(`/api/sessions/${SID}/trace-image?${query}`);
    expect(res.status).toBe(400);
  });
});
