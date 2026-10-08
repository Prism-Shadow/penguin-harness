import { describe, expect, it } from "vitest";
import type {
  ActivityRunSummary,
  AssetManifest,
  MediaAsset,
} from "@prismshadow/penguin-server/api";
import {
  bindCandidateFile,
  boundAudioUrl,
  cardCandidate,
  cardGenerating,
  cardLanguages,
  newestTake,
  pendingText,
  primaryAction,
  speechModelOf,
} from "../src/features/activities/audio-cards";

const asset = (key: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  key,
  type: "audio",
  description: "d",
  usages: [],
  ...extra,
});

const run = (extra: Partial<ActivityRunSummary>): ActivityRunSummary =>
  ({
    runId: "r",
    kind: "audio",
    status: "succeeded",
    hasCandidate: true,
    inputRevision: "rev",
    createdAt: "2026-10-08T10:00:00.000Z",
    error: null,
    audio: { language: "en-US", assetKey: "hello", script: "Hi", voice: "v", model: "m" },
    ...extra,
  }) as ActivityRunSummary;

describe("the audio editor's language cards", () => {
  it("lists every language with the key, the default first", () => {
    const manifest = {
      productCode: "p",
      refNum: 1,
      assets: {
        "fr-FR": [asset("hello")],
        "es-MX": [asset("hello")],
        "en-US": [asset("hello")],
        "de-DE": [asset("other")],
      },
    } as AssetManifest;
    expect(cardLanguages(manifest, "hello", "en-US")).toEqual(["en-US", "es-MX", "fr-FR"]);
  });

  it("compares the newest current take of that language that is not bound", () => {
    const runs = [
      run({ runId: "old", createdAt: "2026-10-08T09:00:00.000Z" }),
      run({ runId: "new", createdAt: "2026-10-08T11:00:00.000Z" }),
      run({ runId: "stale", createdAt: "2026-10-08T12:00:00.000Z", inputRevision: "before" }),
      run({ runId: "failed", createdAt: "2026-10-08T13:00:00.000Z", status: "failed" }),
      run({
        runId: "spanish",
        createdAt: "2026-10-08T14:00:00.000Z",
        audio: { language: "es-MX", assetKey: "hello", script: "Hola", voice: "v", model: "m" },
      }),
    ];
    expect(newestTake(runs, "en-US", "hello", "rev", {})?.runId).toBe("new");
    expect(newestTake(runs, "en-US", "hello", "rev", { runId: "new" })?.runId).toBe("old");
    expect(newestTake(runs, "es-MX", "hello", "rev", {})?.runId).toBe("spanish");
    // An upload bound after both takes retires them.
    expect(
      newestTake(runs, "en-US", "hello", "rev", { uploadedAt: "2026-10-08T11:30:00.000Z" }),
    ).toBeUndefined();
  });

  it("holds an uploaded or trimmed file over a take until it is saved or replaced", () => {
    const take = run({ runId: "take" });
    expect(cardCandidate(take, null)).toEqual({ source: "generated", runId: "take" });
    expect(cardCandidate(take, { source: "trim", path: "media/x.wav" })).toEqual({
      source: "trim",
      path: "media/x.wav",
    });
    expect(cardCandidate(undefined, null)).toBeNull();
  });

  it("knows which card is generating and which suggestion is still open", () => {
    const runs = [
      run({ runId: "a", status: "running" }),
      run({
        runId: "t",
        kind: "media-text",
        audio: undefined,
        mediaText: { language: "es-MX", assetKey: "hello", type: "audio", text: "" },
      }),
    ];
    expect(cardGenerating(runs, "en-US", "hello")).toBe(true);
    expect(cardGenerating(runs, "es-MX", "hello")).toBe(false);
    expect(pendingText(runs, "es-MX", "hello", "rev")?.runId).toBe("t");
    // Accepting changes the draft, which retires the suggestion.
    expect(pendingText(runs, "es-MX", "hello", "after")).toBeUndefined();
  });

  it("translates an empty script in another language before generating it", () => {
    const base = { narration: true, defaultLanguage: "en-US", bound: false };
    expect(primaryAction({ ...base, language: "es-MX", script: "", sourceScript: "Hi" })).toEqual({
      action: "translate",
    });
    expect(primaryAction({ ...base, language: "es-MX", script: " ", sourceScript: "" })).toEqual({
      action: "blocked",
    });
    expect(
      primaryAction({
        ...base,
        language: "es-MX",
        script: "Hola",
        sourceScript: "Hi",
        bound: true,
      }),
    ).toEqual({ action: "generate", again: true });
    expect(
      primaryAction({ ...base, narration: false, language: "es-MX", script: "", sourceScript: "" }),
    ).toEqual({ action: "generate", again: false });
  });

  it("plays the bound audio from its run, its upload or the sandbox", () => {
    const endpoint = "/api/a";
    expect(boundAudioUrl(asset("x"), endpoint)).toBeNull();
    expect(
      boundAudioUrl(
        asset("x", { path: "media/audio/x.mp3", generatedAudio: { runId: "r 1", sha256: "s" } }),
        endpoint,
      ),
    ).toBe("/api/a/runs/r%201/audio");
    expect(boundAudioUrl(asset("x", { path: "media/audio/x y.mp3" }), endpoint)).toBe(
      "/api/a/sandbox/media/audio/x%20y.mp3",
    );
  });

  it("binds a saved file in place of a take and its timings, and reads the model", () => {
    const entry = asset("x", {
      path: "media/a.mp3",
      generatedAudio: { runId: "r", sha256: "s" },
      wordTimings: [{ word: "hi", startMs: 0, endMs: 10 }],
      durationMs: 10,
    });
    bindCandidateFile(entry, "media/b.wav");
    expect(entry).toEqual(asset("x", { path: "media/b.wav" }));
    expect(speechModelOf(entry)).toBe("eleven_v3");
    expect(speechModelOf({ speechModel: "eleven_v4" })).toBe("eleven_v4");
  });
});
