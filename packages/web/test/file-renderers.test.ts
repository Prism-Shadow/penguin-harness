/**
 * File renderers on the web side: the shell reads the server's rules (fileRendererRulesOf in
 * web-app/contributions.tsx), the conversation picks the files a reply block draws
 * (features/chat/reply-files.ts), and the `audio` renderer is a themed player card driving an
 * `<audio>` on the Workspace file URL (features/audio).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContributionsResponse } from "@prismshadow/penguin-server/api";
import { fileRendererRulesOf } from "../src/web-app/contributions";
import { extensionOf, replyFilesOf, type ReplyFilesInput } from "../src/features/chat/reply-files";

import { AudioFile } from "../src/features/audio/audio-file";
import { AudioCard, AudioFailed, type AudioPlayback } from "../src/features/audio/audio-card";

import { formatClock, loadedEnd } from "../src/features/audio/audio-clock";
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
  it("drives an <audio> on the Workspace file URL, fetched only on play, without the browser's chrome", () => {
    const url = workspaceFileUrl("s1", "music/夜曲.wav");
    expect(url).toBe("/api/sessions/s1/files/content?path=music%2F%E5%A4%9C%E6%9B%B2.wav");
    const html = renderToStaticMarkup(
      createElement(AudioFile, { url, path: "music/夜曲.wav", name: "夜曲.wav" }),
    );
    expect(html).toMatch(/<audio preload="none" src="[^"]+"><\/audio>/);
    expect(html).toContain(`src="${url.replace(/&/g, "&amp;")}"`);
    expect(html).not.toContain("controls");
    expect(html).toContain('data-audio-file="paused"');
  });
});

const IDLE: AudioPlayback = { playing: false, waiting: false, time: 0, duration: null, loaded: 0 };
const card = (playback: AudioPlayback) =>
  renderToStaticMarkup(
    createElement(AudioCard, {
      name: "夜曲.wav",
      playback,
      onToggle: () => {},
      onSeek: () => {},
      children: null,
    }),
  );

describe("AudioCard", () => {
  it("before play: a named play button, the file name, an unknown length, and the seek bar off", () => {
    const html = card(IDLE);
    expect(html).toContain('<button type="button" aria-label="播放 夜曲.wav"');
    expect(html).toContain(">夜曲.wav</span>");
    expect(html).toContain("0:00 / -:--");
    expect(html).toMatch(
      /<input type="range"[^>]* disabled=""[^>]*aria-label="夜曲.wav 的播放位置"/,
    );
    expect(html).not.toContain("aria-busy");
  });

  it("while loading: the button is busy and its spinner says what loads", () => {
    const html = card({ ...IDLE, waiting: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在加载 夜曲.wav");
  });

  it("while playing: a pause button, the clock, and a seek bar that reads its position", () => {
    const html = card({ playing: true, waiting: false, time: 3.4, duration: 72, loaded: 72 });
    expect(html).toContain('data-audio-file="playing"');
    expect(html).toContain('aria-label="暂停 夜曲.wav"');
    expect(html).toContain("0:03 / 1:12");
    expect(html).toContain('aria-valuetext="0:03，共 1:12"');
    expect(html).not.toMatch(/<input type="range"[^>]* disabled=""/);
  });

  it("ended: back to a play button with the bar full", () => {
    const html = card({ playing: false, waiting: false, time: 72, duration: 72, loaded: 72 });
    expect(html).toContain('aria-label="播放 夜曲.wav"');
    expect(html).toContain("1:12 / 1:12");
    expect(html).toContain("left:100%");
  });
});

describe("AudioFailed", () => {
  it("is a status line naming the file, in the card's shape, with no control left", () => {
    const html = renderToStaticMarkup(createElement(AudioFailed, { name: "chime.ogg" }));
    expect(html).toContain('data-audio-file="failed"');
    expect(html).toMatch(/role="status"[^>]*>无法播放 chime.ogg：/);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });
});

describe("audio clock", () => {
  it("reads m:ss, h:mm:ss from an hour, and -:-- for an unknown length", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(59.9)).toBe("0:59");
    expect(formatClock(72)).toBe("1:12");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(formatClock(null)).toBe("-:--");
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe("-:--");
  });

  it("can seek as far as the furthest seekable or buffered end", () => {
    const ranges = (...ends: number[]) => ({ length: ends.length, end: (i: number) => ends[i]! });
    expect(loadedEnd(ranges(), ranges())).toBe(0);
    expect(loadedEnd(ranges(), ranges(2, 7.5))).toBe(7.5);
    expect(loadedEnd(ranges(9), ranges(4))).toBe(9);
  });
});
