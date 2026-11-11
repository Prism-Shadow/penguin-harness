/**
 * File renderers on the server side: a module's `WebModule.fileRenderers` contribution reaches
 * GET /api/contributions as data (id, contributing module, extensions, renderer), and a Workspace
 * audio file — what the `audio` renderer plays through files/content — is read with its audio
 * content type.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { ContributionsResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import { WorkspaceFilesService } from "../src/services/workspace-files-service.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A plugin module that only contributes a file renderer rule. */
const music: ModuleDef = {
  manifest: parseManifest({
    name: "MusicFiles",
    requires: {},
    provides: {},
    contributes: {
      "WebModule.fileRenderers": [
        { id: "music.audio", extensions: ["mp3", "wav"], renderer: { builtin: "audio" } },
      ],
    },
    children: [],
  }),
  create: () => ({ api: {}, bind: {} }),
};

describe("web file renderers", () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    await t?.cleanup();
    t = undefined;
  });

  it("serves a plugin's file renderer contribution, and none without the plugin", async () => {
    t = await createTestApp();
    const bare = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const none = (await (await bare.get("/api/contributions")).json()) as ContributionsResponse;
    expect(none.fileRenderers).toEqual([]);
    await t.cleanup();

    const host = new PluginHost();
    host.use({ specifier: "test-music", modules: [music], replaces: [] });
    t = await createTestApp({ plugins: host });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const res = await admin.get("/api/contributions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContributionsResponse;
    expect(body.fileRenderers).toEqual([
      {
        id: "music.audio",
        from: "MusicFiles",
        extensions: ["mp3", "wav"],
        renderer: { builtin: "audio" },
      },
    ]);
  });

  it("reads a Workspace audio file with its audio content type", async () => {
    const ws = await makeTempRoot();
    try {
      const types: Record<string, string> = {
        "a.mp3": "audio/mpeg",
        "b.WAV": "audio/wav",
        "c.ogg": "audio/ogg",
        "d.m4a": "audio/mp4",
      };
      for (const [file, type] of Object.entries(types)) {
        await fs.writeFile(path.join(ws, file), "RIFF");
        expect((await new WorkspaceFilesService().read(ws, file)).contentType, file).toBe(type);
      }
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });
});
