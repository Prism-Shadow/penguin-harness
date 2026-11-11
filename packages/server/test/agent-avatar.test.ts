/**
 * An Agent's own avatar, `agent_state/avatar.<png|jpg|webp>`.
 *
 * - Any member sets, reads and clears it; the list carries its revision, which changes with the
 *   content, and the image is served under its own type, cached for good.
 * - One picture per Agent: a new one in another format replaces the old file.
 * - A picture that is not one of the three formats, whose bytes are not the format it claims, or
 *   that is over the cap is refused, and nothing is written.
 * - The file is the Agent's like any other in its State: one the Agent writes itself is listed,
 *   the Agent's zip carries it, back over the Agent when the owner imports it there, and into the
 *   new Agent a zip is imported as.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentStateDir } from "@prismshadow/penguin-core";
import type {
  AgentAvatarResponse,
  AgentsResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A 1×1 png. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
/** The start of a jpeg: the server checks the signature, not the whole image. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

describe("an Agent's own avatar", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  let base: string;
  let state: string;

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // Every case works in a Project of its own.
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await owner.post("/api/projects", { projectId: `owner_a-avatar_${projects}`, name: "P" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    base = `/api/projects/${projectId}/agents/default_agent`;
    state = agentStateDir(t.root, projectId, "default_agent");
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });

  /** The revision the Agent list carries for `agentId`. */
  async function listedRev(agentId = "default_agent"): Promise<string | undefined> {
    const res = await member.get(`/api/projects/${projectId}/agents`);
    const { agents } = (await res.json()) as AgentsResponse;
    return agents.find((a) => a.agentId === agentId)?.avatarRev;
  }

  async function put(avatar: string | null, as = member) {
    return as.put(`${base}/avatar`, { avatar });
  }

  it("is set, served and cleared by any member, its revision following the content", async () => {
    expect(await listedRev()).toBeUndefined();
    expect((await member.get(`${base}/avatar`)).status).toBe(404);

    const set = await put(dataUrl("image/png", PNG));
    expect(set.status).toBe(200);
    const { avatarRev } = (await set.json()) as AgentAvatarResponse;
    expect(avatarRev).toEqual(expect.any(String));
    expect(await listedRev()).toBe(avatarRev);
    expect(await fs.readdir(state)).toContain("avatar.png");

    const served = await owner.get(`${base}/avatar?rev=${avatarRev}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);

    // Another picture in another format: a new revision, and the png is gone.
    const next = (await (await put(dataUrl("image/jpeg", JPEG))).json()) as AgentAvatarResponse;
    expect(next.avatarRev).not.toBe(avatarRev);
    expect(await listedRev()).toBe(next.avatarRev);
    const files = (await fs.readdir(state)).filter((f) => f.startsWith("avatar."));
    expect(files).toEqual(["avatar.jpg"]);
    expect((await owner.get(`${base}/avatar`)).headers.get("content-type")).toBe("image/jpeg");

    const cleared = await put(null);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({});
    expect(await listedRev()).toBeUndefined();
    expect((await member.get(`${base}/avatar`)).status).toBe(404);
    expect((await fs.readdir(state)).filter((f) => f.startsWith("avatar"))).toEqual([]);
  });

  it("refuses what cannot be an avatar and leaves the stored one as it was", async () => {
    const { avatarRev } = (await (
      await put(dataUrl("image/png", PNG))
    ).json()) as AgentAvatarResponse;
    for (const refused of [
      // Not one of the three formats.
      "data:image/svg+xml;base64,PHN2Zy8+",
      // Labelled as one of them, but the bytes are another format, or no image at all.
      dataUrl("image/jpeg", PNG),
      dataUrl("image/webp", Buffer.from("RIFF0000WEBX")),
      "data:image/png;base64,====",
      // Over the cap.
      `data:image/png;base64,${PNG.toString("base64")}${"A".repeat(131072)}`,
      // Not a data URL at all.
      42,
    ]) {
      const res = await member.put(`${base}/avatar`, { avatar: refused });
      expect(res.status, String(refused).slice(0, 40)).toBe(400);
    }
    expect(await listedRev()).toBe(avatarRev);
    expect((await fs.readdir(state)).filter((f) => f.startsWith("avatar"))).toEqual(["avatar.png"]);
  });

  it("answers 404 for an Agent that does not exist", async () => {
    const missing = `/api/projects/${projectId}/agents/nobody/avatar`;
    expect((await member.get(missing)).status).toBe(404);
    expect((await member.put(missing, { avatar: dataUrl("image/png", PNG) })).status).toBe(404);
    await expect(fs.stat(agentStateDir(t.root, projectId, "nobody"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("lists a picture the Agent wrote into its own State, and ignores one too large to serve", async () => {
    await fs.writeFile(path.join(state, "avatar.webp"), Buffer.from("RIFF\0\0\0\0WEBPVP8 "));
    const rev = await listedRev();
    expect(rev).toEqual(expect.any(String));
    expect((await member.get(`${base}/avatar`)).headers.get("content-type")).toBe("image/webp");

    await fs.writeFile(path.join(state, "avatar.webp"), Buffer.alloc(256 * 1024 + 1));
    expect(await listedRev()).toBeUndefined();
    expect((await member.get(`${base}/avatar`)).status).toBe(404);
  });

  it("comes back when the owner imports the Agent's zip over it", async () => {
    const { avatarRev } = (await (
      await put(dataUrl("image/png", PNG))
    ).json()) as AgentAvatarResponse;
    const zip = new Uint8Array(await (await owner.get(`${base}/archive`)).arrayBuffer());

    await put(dataUrl("image/jpeg", JPEG));
    expect(await listedRev()).not.toBe(avatarRev);

    const restored = await owner.upload(
      `/api/projects/${projectId}/agents/import?agentId=default_agent&overwrite=1`,
      zip,
    );
    expect(restored.status).toBe(201);
    expect(await listedRev()).toBe(avatarRev);
    expect((await fs.readdir(state)).filter((f) => f.startsWith("avatar"))).toEqual(["avatar.png"]);
  });

  it("travels in the Agent's zip into the Agent it is imported as", async () => {
    const { avatarRev } = (await (
      await put(dataUrl("image/png", PNG))
    ).json()) as AgentAvatarResponse;
    const zip = new Uint8Array(await (await owner.get(`${base}/archive`)).arrayBuffer());

    const created = await member.upload(
      `/api/projects/${projectId}/agents/import?agentId=avatar_copy`,
      zip,
    );
    expect(created.status).toBe(201);
    expect(await listedRev("avatar_copy")).toBe(avatarRev);
    const served = await member.get(`/api/projects/${projectId}/agents/avatar_copy/avatar`);
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);
  });
});
