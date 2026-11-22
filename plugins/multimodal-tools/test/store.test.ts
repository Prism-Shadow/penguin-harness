/**
 * A Session's stored results go with the Session.
 *
 * - The sweep removes the folder of a Session the index no longer has, or has under another
 *   Project, and keeps a live Session's folder and that of a Session with a run in flight.
 * - The Project's transcript-editing settings, kept beside the Session folders, survive it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolStore } from "../src/store.js";
import { PNG, tempRoot } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});

describe("the sweep", () => {
  it("removes the folders of Sessions that are gone, and keeps live and busy ones", async () => {
    const root = await tempRoot();
    roots.push(root);
    const store = new ToolStore(root);
    for (const [project, session] of [
      ["alpha", "live"],
      ["alpha", "gone"],
      ["alpha", "moved"],
      ["alpha", "busy"],
      ["beta", "live-b"],
    ] as const) {
      await store.writeFile(project, session, "t2i-0123abcd.png", PNG);
    }
    await store.writePolish("alpha", { enabled: true, prompt: "Keep it short." });
    const index: Record<string, string> = { live: "alpha", moved: "beta", "live-b": "beta" };
    const removed = await store.sweep(
      (projectId, sessionId) => index[sessionId] === projectId,
      new Set(["busy"]),
    );
    expect(removed).toBe(2);
    const left = async (project: string) =>
      (await fs.readdir(path.join(root, project, ".multimodal-tools", "sessions"))).sort();
    expect(await left("alpha")).toEqual(["busy", "live"]);
    expect(await left("beta")).toEqual(["live-b"]);
    expect(await store.readPolish("alpha")).toEqual({ enabled: true, prompt: "Keep it short." });
  });
});
