import { describe, expect, it } from "vitest";
import ts from "typescript";
import { bookReaderControllerTemplate } from "../src/activities/book-reader-controller-template.js";
import { bookReaderTemplate } from "../src/activities/book-reader-template.js";

type Scene = {
  id: string;
  role?: "cover" | "title" | "story";
  media?: {
    narration?: { key: string; script?: string } | null;
    audioCues?: { key: string; script?: string }[];
  };
};

type Operation = {
  play(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  resolve(): void;
  reject(error: unknown): void;
  paused: number;
  resumed: number;
  stopped: number;
};

type Clock = {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  invoke(handle: unknown): void;
  handles: unknown[];
  advance(ms: number): void;
};

function fakeClock(): Clock {
  let current = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const callbacks = new Map<number, () => void>();
  const handles: unknown[] = [];
  return {
    now: () => current,
    setTimeout(callback, delayMs) {
      const id = ++nextId;
      timers.set(id, { at: current + delayMs, callback });
      callbacks.set(id, callback);
      handles.push(id);
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    invoke(handle) {
      callbacks.get(handle as number)?.();
    },
    handles,
    advance(ms) {
      current += ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= current)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].callback();
      }
    },
  };
}

function operation(): Operation {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const state = { paused: 0, resumed: 0, stopped: 0 };
  return {
    play: () => promise,
    pause: () => {
      state.paused += 1;
    },
    resume: () => {
      state.resumed += 1;
    },
    stop: () => {
      state.stopped += 1;
    },
    resolve: resolvePromise,
    reject: rejectPromise,
    get paused() {
      return state.paused;
    },
    get resumed() {
      return state.resumed;
    },
    get stopped() {
      return state.stopped;
    },
  };
}

async function generatedController(): Promise<{
  Model: new (scenes: Scene[], mode: "readAlong" | "decodable", delay?: object) => any;
  Controller: new (model: any, port: any) => any;
}> {
  const source = `${bookReaderTemplate}\n${bookReaderControllerTemplate.replace("import { BookReaderModel } from './model.js';", "")}`;
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
  return { Model: loaded.BookReaderModel, Controller: loaded.BookReaderController };
}

const story = (id = "story", script = "The penguin walks home."): Scene => ({
  id,
  role: "story",
  media: { narration: { key: `${id}-narration`, script } },
});
const cover = (): Scene => ({ id: "cover", role: "cover" });
const twoCues = (): Scene => ({
  id: "story",
  role: "story",
  media: { audioCues: [{ key: "primary" }, { key: "followup" }] },
});

function harness(
  Controller: any,
  Model: any,
  scenes: Scene[],
  mode: "readAlong" | "decodable" = "readAlong",
) {
  const clock = fakeClock();
  const operations: Operation[] = [];
  const changes: unknown[] = [];
  let completed = 0;
  const errors: unknown[] = [];
  const port = {
    clock,
    createCue: () => {
      const op = operation();
      operations.push(op);
      return op;
    },
    onChange: (snapshot: unknown) => changes.push(snapshot),
    onComplete: () => {
      completed += 1;
    },
    onError: (error: unknown) => errors.push(error),
  };
  const controller = new Controller(new Model(scenes, mode), port);
  return {
    controller,
    clock,
    operations,
    changes,
    errors,
    get completed() {
      return completed;
    },
  };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("generated book reader controller", () => {
  it("autoplays a first page through a native operation and pauses/resumes that same operation", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [story(), cover()]);
    h.controller.initialize();
    expect(h.operations).toHaveLength(1);
    const op = h.operations[0]!;
    h.controller.playPause();
    expect(op.paused).toBe(1);
    h.controller.playPause();
    expect(op.resumed).toBe(1);
    op.resolve();
    await flush();
    expect(h.operations).toHaveLength(1);
  });

  it("pauses a reading-delay timer with remaining time and resumes it", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [story("story", "one two three"), cover()], "decodable");
    h.controller.initialize();
    h.clock.advance(1000);
    h.controller.frameworkPause();
    h.clock.advance(5000);
    expect(h.controller.playPause().state).toBe("readingDelay");
    h.controller.frameworkResume();
    h.clock.advance(1999);
    expect(h.controller.playPause().state).toBe("readingDelay");
    h.clock.advance(1);
    expect(h.controller.playPause().state).not.toBe("readingDelay");
  });

  it("holds the 750ms follow-up timer while framework-paused", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [twoCues(), cover()]);
    h.controller.initialize();
    h.operations[0]!.resolve();
    await flush();
    h.controller.frameworkPause();
    h.clock.advance(1000);
    expect(h.operations).toHaveLength(1);
    h.controller.frameworkResume();
    h.clock.advance(749);
    expect(h.operations).toHaveLength(1);
    h.clock.advance(1);
    expect(h.operations).toHaveLength(2);
  });

  it("ignores stale promises after direct navigation and disposal", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [story("one"), story("two")]);
    h.controller.initialize();
    const old = h.operations[0]!;
    h.controller.initialize(1);
    expect(old.stopped).toBe(1);
    old.resolve();
    await flush();
    expect(h.operations).toHaveLength(2);
    const current = h.operations[1]!;
    h.controller.dispose();
    current.resolve();
    await flush();
    expect(h.completed).toBe(0);
  });

  it("reports a failed cue and permits a fresh retry", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [story(), cover()]);
    h.controller.initialize();
    h.operations[0]!.reject(new Error("decode failed"));
    await flush();
    expect(h.errors).toHaveLength(1);
    h.controller.playPause();
    expect(h.operations).toHaveLength(2);
  });

  it("fires completion once and preserves post-completion navigation", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [cover(), story()]);
    h.controller.initialize();
    h.controller.next();
    h.operations[0]!.resolve();
    await flush();
    expect(h.completed).toBe(1);
    h.controller.previous();
    h.controller.next();
    expect(h.completed).toBe(1);
  });

  it("does not advance a settled native promise until framework resume", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [twoCues(), cover()]);
    h.controller.initialize();
    h.controller.frameworkPause();
    h.operations[0]!.resolve();
    await flush();
    expect(h.operations).toHaveLength(1);
    h.controller.frameworkResume();
    await flush();
    expect(h.operations).toHaveLength(1);
  });

  it("defers initialization autoplay while framework-paused until framework resume", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [story(), cover()]);
    h.controller.frameworkPause();
    h.controller.initialize();
    expect(h.operations).toHaveLength(0);
    h.controller.frameworkResume();
    expect(h.operations).toHaveLength(1);
  });

  it("keeps a settled native promise pending across user and framework pause", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [story(), cover()]);
    h.controller.initialize();
    const op = h.operations[0]!;
    h.controller.playPause();
    h.controller.frameworkPause();
    op.resolve();
    await flush();
    expect(h.controller.frameworkResume().state).toBe("paused");
    // The native operation already finished: user resume accepts its deferred
    // completion rather than restarting an operation that has settled.
    expect(h.controller.playPause().state).toBe("ready");
    expect(op.resumed).toBe(0);
    await flush();
    expect(h.operations).toHaveLength(1);
  });

  it("retains a rejected undefined promise as a failure while framework-paused", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [story(), cover()]);
    h.controller.initialize();
    h.controller.frameworkPause();
    h.operations[0]!.reject(undefined);
    await flush();
    expect(h.errors).toHaveLength(0);
    h.controller.frameworkResume();
    await flush();
    expect(h.errors).toHaveLength(1);
    h.controller.playPause();
    expect(h.operations).toHaveLength(2);
  });

  it("does not let a canceled timer callback clear the replacement timer", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [story("one"), story("two")], "decodable");
    h.controller.initialize();
    const oldTimer = h.clock.handles[0]!;
    h.controller.initialize(1);
    h.clock.invoke(oldTimer);
    h.clock.advance(5000);
    expect(h.controller.playPause().state).not.toBe("readingDelay");
  });

  it("preserves an active operation when next is blocked by the model", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [story("one"), story("two")]);
    h.controller.initialize();
    const op = h.operations[0]!;
    expect(h.controller.next().state).toBe("playing");
    expect(op.stopped).toBe(0);
  });

  it("keeps user pause state across a framework pause and resume", async () => {
    const { Model, Controller } = await generatedController();
    const h = harness(Controller, Model, [story(), cover()]);
    h.controller.initialize();
    const op = h.operations[0]!;
    h.controller.playPause();
    h.controller.frameworkPause();
    h.controller.frameworkResume();
    expect(h.controller.playPause().state).toBe("playing");
    expect(op.paused).toBe(1);
    expect(op.resumed).toBe(1);
  });

  it.each(["pause", "resume"] as const)(
    "recovers from a throwing native %s operation",
    async (method) => {
      const { Model, Controller } = await generatedController();
      const h = harness(Controller, Model, [story(), cover()]);
      h.controller.initialize();
      const op = h.operations[0]!;
      if (method === "resume") h.controller.playPause();
      op[method] = () => {
        throw new Error(`${method} failed`);
      };
      expect(h.controller.playPause().state).toBe("ready");
      expect(op.stopped).toBe(1);
      expect(h.errors).toHaveLength(1);
      expect(h.controller.playPause().state).toBe("playing");
      expect(h.operations).toHaveLength(2);
      op.resolve();
      await flush();
      expect(h.operations[1]!.stopped).toBe(0);
    },
  );
});
