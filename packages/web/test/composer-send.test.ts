/**
 * midRunAction: what the composer's single action button does while a Task is running.
 *
 * The case this file exists for is the last describe below — a draft the mid-run channels
 * refuse must still leave Stop. That failed twice in a row when the rule lived inline in
 * ChatInput and was written as "Stop when the composer is empty": an unsendable draft is not
 * empty, so Stop vanished behind a Send that could never enable, and the only way to abort was
 * to delete what you had typed.
 */
import { describe, expect, it } from "vitest";
import { midRunAction } from "../src/features/chat/composer-send";
import type { MidRunComposerState } from "../src/features/chat/composer-send";

/** An active session with both channels wired, steer mode, and a one-line text draft. */
const BASE: MidRunComposerState = {
  sending: false,
  goalOn: false,
  modelAuthDead: false,
  canSteerChannel: true,
  canQueueChannel: true,
  followUpMode: false,
  stagedRoute: "post",
  hasHandoffTarget: false,
  hasPendingModel: false,
  hasText: true,
  hasImages: false,
  hasContent: true,
};

const act = (over: Partial<MidRunComposerState> = {}) => midRunAction({ ...BASE, ...over });

/** The draft shapes that carry nothing at all. */
const EMPTY = { hasText: false, hasImages: false, hasContent: false } as const;

describe("midRunAction — steering, the preferred channel", () => {
  it("takes text, images, or an image with no caption at all", () => {
    expect(act()).toBe("steer");
    expect(act({ hasText: false, hasImages: true })).toBe("steer");
    expect(act({ hasText: true, hasImages: true })).toBe("steer");
  });

  it("is skipped for a draft it cannot carry, which the queue then takes", () => {
    // Skills or file attachments only: hasContent without text or images of its own.
    expect(act({ ...EMPTY, hasContent: true })).toBe("queue");
    // A staged switch chip: the text belongs to the conversation that switch is about to open.
    expect(act({ hasHandoffTarget: true, stagedRoute: "handoff" })).toBe("queue");
    expect(act({ hasPendingModel: true, stagedRoute: "model" })).toBe("queue");
  });

  it("is skipped in follow-up mode even when it could carry the draft", () => {
    // The two channels put the message in different places; the remembered mode decides.
    expect(act({ followUpMode: true })).toBe("queue");
  });
});

describe("midRunAction — the queue", () => {
  it("takes the whole draft, whatever it is made of", () => {
    expect(act({ followUpMode: true, ...EMPTY, hasContent: true })).toBe("queue");
  });

  it("refuses a staged /model fork while the Session is still writing its Trace", () => {
    // stagedRoute "blocked" is the fork waiting for idle (see stagedSendRoute); steering is
    // out too, since a staged chip rules it out — so the button is Stop, not a dead Send.
    expect(act({ hasPendingModel: true, stagedRoute: "blocked" })).toBe("stop");
    expect(act({ followUpMode: true, hasPendingModel: true, stagedRoute: "blocked" })).toBe("stop");
  });

  it("is unavailable on a host that wired no queue (the draft page)", () => {
    expect(act({ canQueueChannel: false, ...EMPTY, hasContent: true })).toBe("stop");
    // Steering still works there if the draft suits it.
    expect(act({ canQueueChannel: false })).toBe("steer");
  });
});

describe("midRunAction — Stop is the fallthrough, not a case", () => {
  it("an empty composer is Stop", () => {
    expect(act(EMPTY)).toBe("stop");
  });

  // The regression this file is really for: each of these is a NON-EMPTY draft that no mid-run
  // channel will take. Keyed off "is the composer empty" they produced a permanently disabled
  // Send standing where Stop should be, so the run could not be stopped from the composer.
  it("a goal objective leaves Stop — it is an objective, not a message for this turn", () => {
    expect(act({ goalOn: true })).toBe("stop");
    expect(act({ goalOn: true, followUpMode: true })).toBe("stop");
    expect(act({ goalOn: true, hasImages: true })).toBe("stop");
  });

  it("a rejected model key leaves Stop, for every draft there is", () => {
    expect(act({ modelAuthDead: true })).toBe("stop");
    expect(act({ modelAuthDead: true, followUpMode: true })).toBe("stop");
    expect(act({ modelAuthDead: true, ...EMPTY, hasContent: true })).toBe("stop");
  });

  it("a host with no channels at all leaves Stop rather than a dead Send", () => {
    expect(act({ canSteerChannel: false, canQueueChannel: false })).toBe("stop");
  });
});

describe("midRunAction — a send already in flight", () => {
  it("is inert, and never Stop: the click that started the send must not abort the run", () => {
    expect(act({ sending: true })).toBe("disabled");
    // Including once the send has cleared the draft but has not settled yet.
    expect(act({ sending: true, ...EMPTY })).toBe("disabled");
    expect(act({ sending: true, goalOn: true })).toBe("disabled");
  });
});
