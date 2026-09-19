import { describe, expect, it } from "vitest";
import ts from "typescript";
import { bookReaderTemplate } from "../src/activities/book-reader-template.js";

type Reader = {
  new (scenes: readonly Scene[], mode: "readAlong" | "decodable", delay?: Delay): Model;
};

type Scene = {
  id: string;
  role?: "cover" | "title" | "story";
  pageNumber?: number;
  media?: {
    narration?: { key: string; script?: string } | null;
    audioCues?: { key: string; script?: string }[];
  };
};

type Delay = { secondsPerWord: number; minimumSeconds: number; maximumSeconds: number };

type Model = {
  readonly snapshot: {
    currentIndex: number;
    currentPageId: string | null;
    state: string;
    introPlaying: boolean;
    activeCueIndex: number | null;
    narrationPaused: boolean;
    wordPlaying: boolean;
    delayedPageIds: readonly string[];
    completedNarrationPageIds: readonly string[];
    activityComplete: boolean;
    navigationLocked: boolean;
    disposed: boolean;
    readingDelaySeconds: number;
  };
  initialize(): Result;
  directStart(index?: number): Result;
  next(): Result;
  previous(): Result;
  startNarration(): Result & { token?: number; cueIndex?: number };
  pauseNarration(): Result;
  resumeNarration(): Result & { token?: number; cueIndex?: number };
  finishReadingDelay(token: number): Result;
  finishCue(token: number, success: boolean, cueIndex: number): Result;
  startFollowup(token: number): Result;
  startWord(): Result & { token?: number };
  finishWord(token: number): Result;
  setIntroPlaying(playing: boolean): Result;
  dispose(): Result;
};

type Result = {
  event: string;
  token?: number;
  cueIndex?: number;
  delayMs?: number;
  snapshot: Model["snapshot"];
};

let ReaderModel: Reader | undefined;

async function readerClass(): Promise<Reader> {
  if (ReaderModel) return ReaderModel;
  const output = ts.transpileModule(bookReaderTemplate, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
  ReaderModel = module.BookReaderModel as Reader;
  return ReaderModel;
}

const cover = (): Scene => ({ id: "cover", role: "cover" });
const story = (id: string, script = "The penguin walks home."): Scene => ({
  id,
  role: "story",
  media: { narration: { key: `${id}-narration`, script } },
});
const cues = (id: string): Scene => ({
  id,
  role: "story",
  media: {
    audioCues: [
      { key: `${id}-first`, script: "First cue" },
      { key: `${id}-followup`, script: "Follow up" },
    ],
  },
});
const silentStory = (id: string): Scene => ({ id, role: "story" });

describe("generated book reader template", () => {
  it("loads the generated module and autoplay is requested only on a read-along first visit", async () => {
    const Reader = await readerClass();
    const reader = new Reader([cover(), story("page-1")], "readAlong");

    expect(reader.initialize().event).toBe("page-ready");
    expect(reader.next().event).toBe("autoplay-requested");
    const started = reader.startNarration();
    expect(started.event).toBe("narration-started");
    expect(started.snapshot.navigationLocked).toBe(true);
    expect(reader.previous().event).toBe("navigation-locked");
    expect(reader.finishCue(started.token!, true, 0).event).toBe("activity-completed");
  });

  it("makes a revisit quiet while allowing manual navigation back and forward", async () => {
    const Reader = await readerClass();
    const reader = new Reader([cover(), story("page-1"), story("page-2")], "readAlong");
    reader.initialize();
    expect(reader.next().event).toBe("autoplay-requested");
    const first = reader.startNarration();
    reader.finishCue(first.token!, true, 0);
    expect(reader.next().event).toBe("autoplay-requested");
    expect(reader.previous().event).toBe("page-ready");
    expect(reader.next().event).toBe("page-ready");
    expect(reader.startNarration().event).toBe("narration-started");
  });

  it("clamps decodable reading delay, blocks navigation until it is finished, and gates completion", async () => {
    const Reader = await readerClass();
    const delay: Delay = { secondsPerWord: 0.01, minimumSeconds: 3, maximumSeconds: 4 };
    const reader = new Reader(
      [story("page-1", "one two three"), story("page-2", "one two three four five six")],
      "decodable",
      delay,
    );

    const firstDelay = reader.initialize();
    expect(firstDelay.event).toBe("page-reading-delay");
    expect(reader.snapshot.readingDelaySeconds).toBe(3);
    expect(reader.next().event).toBe("navigation-locked");
    expect(reader.finishReadingDelay(firstDelay.token!).event).toBe("reading-delay-finished");
    const first = reader.startNarration();
    reader.finishCue(first.token!, true, 0);
    expect(reader.snapshot.activityComplete).toBe(false);
    const secondDelay = reader.next();
    expect(secondDelay.event).toBe("page-reading-delay");
    expect(reader.snapshot.readingDelaySeconds).toBe(3);
    reader.finishReadingDelay(secondDelay.token!);
    const second = reader.startNarration();
    expect(reader.finishCue(second.token!, true, 0).event).toBe("activity-completed");
    expect(reader.snapshot.activityComplete).toBe(true);
  });

  it("runs follow-up cues in order and completes only after the final cue", async () => {
    const Reader = await readerClass();
    const reader = new Reader([cues("page-1"), cover()], "readAlong");
    reader.initialize();
    const started = reader.startNarration();
    expect(started.snapshot.activeCueIndex).toBe(0);
    const waiting = reader.finishCue(started.token!, true, 0);
    expect(waiting.event).toBe("followup-waiting");
    expect(reader.snapshot.activeCueIndex).toBe(1);
    expect(reader.startFollowup(started.token!).event).toBe("followup-started");
    expect(reader.finishCue(started.token!, true, 1).event).toBe("narration-finished");
    expect(reader.snapshot.completedNarrationPageIds).toEqual(["page-1"]);
  });

  it("keeps pause/resume stable and makes word playback mutually exclusive with narration", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("page-1"), cover()], "readAlong");
    reader.initialize();
    const started = reader.startNarration();
    expect(reader.startWord().event).toBe("word-locked");
    expect(reader.pauseNarration().event).toBe("narration-paused");
    expect(reader.snapshot.narrationPaused).toBe(true);
    const word = reader.startWord();
    expect(word.event).toBe("word-started");
    expect(reader.finishWord(word.token!).event).toBe("word-finished");
    expect(reader.snapshot.narrationPaused).toBe(true);
    const resumed = reader.resumeNarration();
    expect(resumed.event).toBe("narration-resumed");
    expect(resumed.token).toBe(started.token);
    expect(reader.finishCue(resumed.token!, true, 0).event).toBe("narration-finished");
  });

  it("rejects stale callbacks after cancellation and disposal", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("page-1"), story("page-2")], "readAlong");
    reader.initialize();
    const started = reader.startNarration();
    expect(reader.directStart(1).event).toBe("autoplay-requested");
    expect(reader.finishCue(started.token!, true, 0).event).toBe("stale-cue");
    const second = reader.startNarration();
    expect(reader.dispose().event).toBe("disposed");
    expect(reader.finishCue(second.token!, true, 0).event).toBe("stale-cue");
    expect(reader.next().event).toBe("disposed");
    expect(reader.snapshot.disposed).toBe(true);
  });

  it("allows direct starts and backward navigation after final completion, with completion remaining true", async () => {
    const Reader = await readerClass();
    const reader = new Reader([cover(), story("page-1"), cover()], "readAlong");
    expect(reader.directStart(2).event).toBe("activity-completed");
    expect(reader.snapshot.activityComplete).toBe(true);
    expect(reader.previous().event).toBe("page-ready");
    expect(reader.snapshot.currentPageId).toBe("page-1");
    expect(reader.next().event).toBe("page-ready");
    expect(reader.snapshot.activityComplete).toBe(true);
  });

  it("rejects duplicate primary callbacks after follow-up playback has started", async () => {
    const Reader = await readerClass();
    const reader = new Reader([cues("page-1"), cover()], "readAlong");
    reader.initialize();
    const started = reader.startNarration();
    reader.finishCue(started.token!, true, 0);
    reader.startFollowup(started.token!);
    expect(reader.finishCue(started.token!, true, 0).event).toBe("stale-cue");
    expect(reader.snapshot.state).toBe("followupPlaying");
    expect(reader.finishCue(started.token!, true, 1).event).toBe("narration-finished");
  });

  it("does not accept a cue completion while narration is paused", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("page-1"), cover()], "readAlong");
    reader.initialize();
    const started = reader.startNarration();
    reader.pauseNarration();
    expect(reader.finishCue(started.token!, true, 0).event).toBe("stale-cue");
    expect(reader.snapshot.state).toBe("paused");
    reader.resumeNarration();
    expect(reader.finishCue(started.token!, true, 0).event).toBe("narration-finished");
  });

  it("replays only the primary cue after a completed follow-up sequence", async () => {
    const Reader = await readerClass();
    const reader = new Reader([cues("page-1"), cover()], "readAlong");
    reader.initialize();
    const first = reader.startNarration();
    reader.finishCue(first.token!, true, 0);
    reader.startFollowup(first.token!);
    reader.finishCue(first.token!, true, 1);
    const replay = reader.startNarration();
    expect(replay.event).toBe("narration-started");
    expect(replay.snapshot.activeCueIndex).toBe(0);
    expect(reader.finishCue(replay.token!, true, 0).event).toBe("narration-finished");
  });

  it("invalidates an old reading-delay token when a new delay page is opened", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("page-1"), story("page-2")], "decodable");
    const oldDelay = reader.initialize();
    const newDelay = reader.directStart(1);
    expect(newDelay.event).toBe("direct-start-reading-delay");
    expect(reader.finishReadingDelay(oldDelay.token!).event).toBe("stale-reading-delay");
    expect(reader.snapshot.state).toBe("readingDelay");
    expect(reader.finishReadingDelay(newDelay.token!).event).toBe("reading-delay-finished");
  });

  it("does not let a late word completion finish the next word", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("page-1"), cover()], "readAlong");
    reader.initialize();
    const narration = reader.startNarration();
    reader.pauseNarration();
    const word1 = reader.startWord();
    reader.finishWord(word1.token!);
    const word2 = reader.startWord();
    expect(reader.finishWord(word1.token!).event).toBe("stale-word");
    expect(reader.snapshot.wordPlaying).toBe(true);
    expect(reader.finishWord(word2.token!).event).toBe("word-finished");
    reader.resumeNarration();
    reader.finishCue(narration.token!, true, 0);
  });

  it("allows a silent middle decodable page to advance after its delay", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("page-1"), silentStory("silent"), cover()], "decodable");
    const first = reader.initialize();
    reader.finishReadingDelay(first.token!);
    const narration = reader.startNarration();
    reader.finishCue(narration.token!, true, 0);
    const second = reader.next();
    expect(second.event).toBe("page-reading-delay");
    reader.finishReadingDelay(second.token!);
    expect(reader.next().event).toBe("page-ready");
  });

  it("re-runs an unfinished delay after leaving a page and returning", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("page-1"), cover()], "decodable");
    const first = reader.initialize();
    expect(reader.directStart(1).event).toBe("direct-started");
    const again = reader.directStart(0);
    expect(again.event).toBe("direct-start-reading-delay");
    expect(reader.finishReadingDelay(first.token!).event).toBe("stale-reading-delay");
    expect(reader.finishReadingDelay(again.token!).event).toBe("reading-delay-finished");
  });

  it("autoplays narrated cover/title pages in decodable mode and keeps direct read-along preview explicit", async () => {
    const Reader = await readerClass();
    const title: Scene = {
      id: "title",
      role: "title",
      media: { narration: { key: "title-audio", script: "Title" } },
    };
    const decodable = new Reader([title, story("story")], "decodable");
    expect(decodable.initialize().event).toBe("autoplay-requested");
    const readAlong = new Reader([story("preview")], "readAlong");
    expect(readAlong.directStart().event).toBe("autoplay-requested");
    expect(readAlong.startNarration().event).toBe("narration-started");
  });

  it("locks narration, word playback, and navigation while intro audio is active", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("page-1"), cover()], "readAlong");
    reader.initialize();
    expect(reader.setIntroPlaying(true).event).toBe("intro-started");
    expect(reader.snapshot.introPlaying).toBe(true);
    expect(reader.startNarration().event).toBe("intro-playing");
    expect(reader.startWord().event).toBe("word-locked");
    expect(reader.next().event).toBe("navigation-locked");
    reader.setIntroPlaying(false);
    expect(reader.startNarration().event).toBe("narration-started");
  });

  it("defers first-page autoplay when intro starts before initialization", async () => {
    const Reader = await readerClass();
    const title: Scene = {
      id: "title-before-init",
      role: "title",
      media: { narration: { key: "title-audio", script: "Title" } },
    };
    const reader = new Reader([title], "readAlong");
    reader.setIntroPlaying(true);
    expect(reader.initialize().event).toBe("autoplay-deferred");
    expect(reader.snapshot.introPlaying).toBe(true);
    expect(reader.setIntroPlaying(false).event).toBe("autoplay-requested");
  });

  it("does not complete a decodable activity on a silent final page", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("page-1"), silentStory("silent-final")], "decodable");
    const firstDelay = reader.initialize();
    reader.finishReadingDelay(firstDelay.token!);
    const firstNarration = reader.startNarration();
    reader.finishCue(firstNarration.token!, true, 0);
    const finalDelay = reader.next();
    expect(finalDelay.event).toBe("page-reading-delay");
    reader.finishReadingDelay(finalDelay.token!);
    expect(reader.snapshot.activityComplete).toBe(false);
    expect(reader.next().event).toBe("boundary");
  });

  it("starts a fresh reading delay after intro interrupts the previous timer", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("page")], "decodable");
    const oldDelay = reader.initialize();
    reader.setIntroPlaying(true);
    expect(reader.finishReadingDelay(oldDelay.token!).event).toBe("stale-reading-delay");
    const delay = reader.setIntroPlaying(false);
    expect(delay.event).toBe("page-reading-delay");
    expect(reader.finishReadingDelay(oldDelay.token!).event).toBe("stale-reading-delay");
    expect(reader.finishReadingDelay(delay.token!).event).toBe("reading-delay-finished");
  });

  it("counts Unicode words and emits bounded timer durations without retaining caller mutations", async () => {
    const Reader = await readerClass();
    const scenes = [
      story("eight", "Éléphant déjà forêt garçon niño acción über schön"),
      story("long", "word ".repeat(30)),
    ];
    const reader = new Reader(scenes, "decodable");
    scenes[0].media!.narration!.script = "changed";
    const delay = reader.initialize();
    expect(delay.snapshot.readingDelaySeconds).toBe(4);
    expect(delay.delayMs).toBe(4000);
    reader.finishReadingDelay(delay.token!);
    const narration = reader.startNarration();
    reader.finishCue(narration.token!, true, 0);
    expect(reader.next().delayMs).toBe(10000);
  });

  it.each(["readAlong", "decodable"] as const)(
    "requires narrated cover completion before Next in %s",
    async (mode) => {
      const Reader = await readerClass();
      const narratedCover = { ...story("cover"), role: "cover" as const };
      const reader = new Reader([narratedCover, story("story")], mode);
      reader.initialize();
      expect(reader.next().event).toBe("narration-required");
      const narration = reader.startNarration();
      reader.pauseNarration();
      expect(reader.next().event).toBe("narration-required");
      reader.resumeNarration();
      reader.finishCue(narration.token!, true, 0);
      expect(reader.next().snapshot.currentPageId).toBe("story");
    },
  );

  it("keeps read-along Next gated after failed narration until a successful replay", async () => {
    const Reader = await readerClass();
    const reader = new Reader([story("one"), story("two")], "readAlong");
    reader.initialize();
    const failed = reader.startNarration();
    reader.finishCue(failed.token!, false, 0);
    expect(reader.next().event).toBe("narration-required");
    const replay = reader.startNarration();
    reader.finishCue(replay.token!, true, 0);
    expect(reader.next().event).toBe("autoplay-requested");
  });
});
