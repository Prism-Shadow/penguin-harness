import { describe, expect, it } from "vitest";
import ts from "typescript";
import { bookReaderTemplate } from "../src/activities/book-reader-template.js";
import { bookReaderControllerTemplate } from "../src/activities/book-reader-controller-template.js";
import { bookReaderAdapterTemplate } from "../src/activities/book-reader-adapter-template.js";

type Narration = {
  key: string;
  script?: string;
  timings?: unknown[];
  words?: unknown[];
};

type AdapterModule = {
  narrationEventsFromScene(scene: {
    id: string;
    media?: { narration?: Narration | null; audioCues?: { key: string }[] };
  }): { id: string; time: number }[];
  cueKeysForScene(scene: {
    id: string;
    media?: { narration?: Narration | null; audioCues?: { key: string }[] };
  }): string[];
  connectBookReaderLifecycle(options: Record<string, unknown>): {
    complete(): void;
    teardown(): void;
  };
};

let adapterModule: AdapterModule | undefined;

async function adapter(): Promise<AdapterModule> {
  if (adapterModule) return adapterModule;
  const source = [
    bookReaderTemplate,
    bookReaderControllerTemplate.replace("import { BookReaderModel } from './model.js';", ""),
    bookReaderAdapterTemplate.replace(
      "import type { BookReaderController } from './controller.js';",
      "",
    ),
  ].join("\n");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
  adapterModule = {
    narrationEventsFromScene: loaded.narrationEventsFromScene,
    cueKeysForScene: loaded.cueKeysForScene,
    connectBookReaderLifecycle: loaded.connectBookReaderLifecycle,
  };
  return adapterModule;
}

const storyWith = (narration: Narration) => ({
  id: "page-1",
  role: "story",
  media: { narration },
});

describe("generated book reader adapter", () => {
  it("compiles word highlight events only from timings that exist", async () => {
    const { narrationEventsFromScene } = await adapter();
    const scene = storyWith({
      key: "narration",
      script: "One two three",
      timings: [
        { start: 0.1234, end: 0.5 },
        { start: 0.5, end: 1 },
        { start: 1, end: 1.5 },
      ],
    });
    expect(narrationEventsFromScene(scene)).toEqual([
      { id: "word-start:0", time: 123 },
      { id: "word-start:1", time: 500 },
      { id: "word-end:0", time: 500 },
      { id: "word-start:2", time: 1000 },
      { id: "word-end:1", time: 1000 },
      { id: "word-end:2", time: 1500 },
    ]);
  });

  it("keeps empty, absent and partial timings empty instead of inventing events", async () => {
    const { narrationEventsFromScene } = await adapter();
    expect(
      narrationEventsFromScene(storyWith({ key: "n", script: "Some words", timings: [] })),
    ).toEqual([]);
    expect(narrationEventsFromScene(storyWith({ key: "n", script: "Some words" }))).toEqual([]);
    expect(narrationEventsFromScene(storyWith({ key: "n" }))).toEqual([]);
    expect(narrationEventsFromScene({ id: "cover", media: {} })).toEqual([]);
    const partial = storyWith({
      key: "n",
      script: "One two three",
      timings: [
        { start: 0, end: 0.4 },
        { start: "nope", end: 2 },
        { start: 1, end: 1.4 },
      ],
    });
    expect(narrationEventsFromScene(partial)).toEqual([
      { id: "word-start:0", time: 0 },
      { id: "word-end:0", time: 400 },
      { id: "word-start:2", time: 1000 },
      { id: "word-end:2", time: 1400 },
    ]);
  });

  it("caps events at the visible word count and falls back to word timings", async () => {
    const { narrationEventsFromScene } = await adapter();
    const capped = storyWith({
      key: "n",
      script: "Hello world",
      timings: [
        { start: 0, end: 0.5 },
        { start: 0.5, end: 1 },
        { start: 1, end: 1.5 },
      ],
    });
    expect(narrationEventsFromScene(capped)).toEqual([
      { id: "word-start:0", time: 0 },
      { id: "word-start:1", time: 500 },
      { id: "word-end:0", time: 500 },
      { id: "word-end:1", time: 1000 },
    ]);
    const fromWords = storyWith({
      key: "n",
      script: "Hello world",
      words: [
        { wholeWordTiming: { start: 0.1, end: 0.4 } },
        { wholeWordTiming: { start: 0.4, end: 0.9 } },
      ],
    });
    expect(narrationEventsFromScene(fromWords)).toEqual([
      { id: "word-start:0", time: 100 },
      { id: "word-start:1", time: 400 },
      { id: "word-end:0", time: 400 },
      { id: "word-end:1", time: 900 },
    ]);
  });

  it("orders cue keys with the narration as single fallback", async () => {
    const { cueKeysForScene } = await adapter();
    expect(
      cueKeysForScene({
        id: "page",
        media: {
          audioCues: [{ key: "first" }, { key: "followup" }],
          narration: { key: "narration" },
        },
      }),
    ).toEqual(["first", "followup"]);
    expect(cueKeysForScene({ id: "page", media: { narration: { key: "narration" } } })).toEqual([
      "narration",
    ]);
    expect(cueKeysForScene({ id: "cover", media: {} })).toEqual([]);
  });

  it("wires framework pause and resume to the controller and tears down once", async () => {
    const { connectBookReaderLifecycle } = await adapter();
    const calls: string[] = [];
    const listeners = new Map<string, () => void>();
    const controller = {
      frameworkPause: () => calls.push("pause"),
      frameworkResume: () => calls.push("resume"),
      dispose: () => calls.push("dispose"),
    };
    const lifecycle = connectBookReaderLifecycle({
      controller,
      pauseEvent: "activity.pause",
      resumeEvent: "activity.resume",
      subscribe: (event: string, listener: () => void) => {
        listeners.set(event, listener);
        calls.push(`subscribe:${event}`);
      },
      unsubscribe: (event: string) => calls.push(`unsubscribe:${event}`),
      registerPagehide: (handler: () => void) => {
        listeners.set("pagehide", handler);
      },
      onComplete: () => calls.push("complete"),
    });

    listeners.get("activity.pause")!();
    listeners.get("activity.resume")!();
    expect(calls).toEqual([
      "subscribe:activity.pause",
      "subscribe:activity.resume",
      "pause",
      "resume",
    ]);

    lifecycle.complete();
    lifecycle.complete();
    expect(calls.filter((call) => call === "complete")).toHaveLength(1);

    listeners.get("pagehide")!();
    expect(calls).toContain("dispose");
    expect(calls).toContain("unsubscribe:activity.pause");
    expect(calls).toContain("unsubscribe:activity.resume");

    const afterTeardown = calls.length;
    lifecycle.teardown();
    lifecycle.complete();
    expect(calls.length).toBe(afterTeardown);
  });
});
