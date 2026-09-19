import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveProjectConfig, loadProjectConfig } from "../src/state/project-config.js";
import { projectChatGPTCredentials } from "../src/state/chatgpt-credentials.js";

let root: string;
const credentials = {
  accessToken: "old-access",
  refreshToken: "old-refresh",
  accountId: "account",
  expiresAt: 1,
};
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-chatgpt-"));
  await saveProjectConfig(root, "project", {
    models: ["a", "b"].map((model_id) => ({
      provider: "chatgpt-codex",
      client_type: "chatgpt-codex",
      model_id,
      chatgpt_oauth: credentials,
    })),
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(root, { recursive: true, force: true });
});

it("serializes concurrent refreshes, persists rotation for all models, and reloads disconnects", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
  );
  vi.stubGlobal("fetch", fetcher);
  const a = projectChatGPTCredentials(root, "project", "a");
  const b = projectChatGPTCredentials(root, "project", "b");
  const result = await Promise.all([a(), b(), a()]);
  expect(result.every((c) => c.accessToken === "new-access")).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const stored = await loadProjectConfig(root, "project");
  expect(stored.models.every((m) => m.chatgpt_oauth?.refreshToken === "new-refresh")).toBe(true);
  stored.models.forEach((m) => delete m.chatgpt_oauth);
  await saveProjectConfig(root, "project", stored);
  await expect(a()).rejects.toThrow("Connect a ChatGPT");
});

it("does not resurrect credentials disconnected while refresh was in flight", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => {
      const cfg = await loadProjectConfig(root, "project");
      cfg.models.forEach((m) => delete m.chatgpt_oauth);
      await saveProjectConfig(root, "project", cfg);
      return Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      });
    }),
  );
  await expect(projectChatGPTCredentials(root, "project", "a")()).rejects.toThrow("Connect");
  expect((await loadProjectConfig(root, "project")).models[0]?.chatgpt_oauth).toBeUndefined();
});
