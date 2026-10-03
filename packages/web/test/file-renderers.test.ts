/**
 * File renderers on the web side: the shell reads the server's rules (fileRendererRulesOf in
 * web-app/contributions.tsx), the conversation picks the files a reply block draws
 * (features/chat/reply-files.ts), and the `audio` renderer is the browser's player on the
 * Workspace file URL (features/audio/audio-file.tsx).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";
import { fileRendererRulesOf } from "../src/web-app/contributions";
import { extensionOf, replyFilesOf, type ReplyFilesInput } from "../src/features/chat/reply-files";

import { AudioFile } from "../src/features/audio/audio-file";
import type { FileRenderer, FileRendererRule } from "../src/lib/file-renderers";
import { workspaceFileUrl } from "../src/api/endpoints";

const answer = (fileRenderers: readonly unknown[]): ContributionsResponse =>
  ({
    pages: [],
    fileRenderers,
    agentTabs: [],
    sessionTabs: [],
  }) as unknown as ContributionsResponse;

describe("fileRendererRulesOf", () => {
  it("is empty without an answer, and for a server that sends no list", () => {
    expect(fileRendererRulesOf(null)).toEqual([]);
    expect(fileRendererRulesOf({ pages: [] } as unknown as ContributionsResponse)).toEqual([]);
  });

  it("drops a leading dot, lowercases, and keeps the server's order", () => {
    const rules = fileRendererRulesOf(
      answer([
        { id: "a", from: "M", extensions: ["MP3", ".Wav", "", 7], renderer: { builtin: "audio" } },
        { id: "b", from: "M", extensions: ["ogg"], renderer: { builtin: "other" } },
      ]),
    );
    expect(rules).toEqual([
      { id: "a", extensions: ["mp3", "wav"], builtin: "audio" },
      { id: "b", extensions: ["ogg"], builtin: "other" },
    ]);
  });

  it("skips an iframe renderer and a malformed entry", () => {
    const frame = { iframe: { src: "/x.html", namespace: "x" } };
    expect(
      fileRendererRulesOf(
        answer([
          null,
          { id: "frame", extensions: ["mp3"], renderer: frame },
          { id: "no-ext", renderer: { builtin: "audio" } },
          { id: "empty", extensions: [""], renderer: { builtin: "audio" } },
          { id: "no-renderer", extensions: ["mp3"] },
          { extensions: ["mp3"], renderer: { builtin: "audio" } },
        ]),
      ),
    ).toEqual([]);
  });
});

const Audio: FileRenderer = () => null;
const Other: FileRenderer = () => null;
const WS = "/home/u/ws";

function input(rules: readonly FileRendererRule[]): ReplyFilesInput {
  return {
    workspace: WS,
    rules,
    registry: new Map([
      ["audio", Audio],
      ["other", Other],
    ]),
    urlOf: (path) => `url:${path}`,
  };
}

const AUDIO_RULE: FileRendererRule = { id: "m", extensions: ["mp3", "wav"], builtin: "audio" };

describe("replyFilesOf", () => {
  it("matches the extension case-insensitively, one entry per file, in link order", () => {
    const files = replyFilesOf(
      ["music/B.WAV", "a.mp3", "./music/B.WAV", `${WS}/a.mp3`, "notes.txt"],
      input([AUDIO_RULE]),
    );
    expect(files.map(({ path, name, url, Renderer }) => [path, name, url, Renderer])).toEqual([
      ["music/B.WAV", "B.WAV", "url:music/B.WAV", Audio],
      ["a.mp3", "a.mp3", "url:a.mp3", Audio],
    ]);
  });

  it("decodes a percent-encoded name and drops a query", () => {
    const files = replyFilesOf(["%E5%A4%9C%E6%9B%B2.mp3?v=2"], input([AUDIO_RULE]));
    expect(files.map((f) => f.path)).toEqual(["夜曲.mp3"]);
  });

  it("passes over a rule whose renderer this build lacks, so a later rule can match", () => {
    const rules: FileRendererRule[] = [
      { id: "x", extensions: ["mp3"], builtin: "missing" },
      { id: "y", extensions: ["mp3"], builtin: "other" },
    ];
    expect(replyFilesOf(["a.mp3"], input(rules)).map((f) => f.Renderer)).toEqual([Other]);
    expect(replyFilesOf(["a.mp3"], input([rules[0] as FileRendererRule]))).toEqual([]);
  });

  it("draws nothing for an external link, an anchor, or a path outside the Workspace", () => {
    expect(
      replyFilesOf(
        ["https://example.com/a.mp3", "#a.mp3", "../out.mp3", "/etc/a.mp3", "~/a.mp3", "mp3"],
        input([AUDIO_RULE]),
      ),
    ).toEqual([]);
  });

  it("reads an extension only after a name's first character", () => {
    expect(extensionOf("a.MP3")).toBe("mp3");
    expect(extensionOf(".mp3")).toBe("");
    expect(extensionOf("mp3")).toBe("");
  });
});

describe("AudioFile", () => {
  it("is the browser's player on the Workspace file URL, fetched only on play, and named", () => {
    const url = workspaceFileUrl("s1", "music/夜曲.wav");
    expect(url).toBe("/api/sessions/s1/files/content?path=music%2F%E5%A4%9C%E6%9B%B2.wav");
    const html = renderToStaticMarkup(
      createElement(AudioFile, { url, path: "music/夜曲.wav", name: "夜曲.wav" }),
    );
    expect(html).toMatch(/^<audio controls="" preload="none" src="[^"]+"/);
    expect(html).toContain(`src="${url.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('aria-label="播放 夜曲.wav"');
  });
});
