/**
 * The element picker's protocol (features/workbench/element-picker.ts): what the panel accepts as a
 * message from the user's page, what it tells the page to do, and how it names an element.
 *
 * The messages arrive on the page's own console, which is a shared channel — the page logs over it
 * too, and a page may log a line that looks like ours. The parse is therefore the thing under test
 * first: everything that is not exactly one of our messages has to come back `null`, because the
 * alternative is a page driving the panel by logging.
 */
import { describe, expect, it } from "vitest";
import {
  PICKER_CHANNEL,
  describeTarget,
  elementFromGuest,
  parsePickerMessage,
  pickerCommand,
  pickerFrameCount,
  pickerProbe,
  pickerResolve,
  pickerScript,
} from "../src/features/workbench/element-picker";
import type { ElementFacts, PageFacts } from "../src/features/workbench/element-picker";

const badge: ElementFacts = {
  tagName: "span",
  id: null,
  classList: ["badge"],
  cssSelector: "div.card > span.badge",
  role: null,
  name: "hello",
  testId: null,
  attributes: { class: "badge" },
  text: "hello",
  computed: { "font-size": "12px", color: "rgb(17, 24, 39)" },
  rect: { x: 10, y: 20, width: 40, height: 18 },
  parentChain: ["div.card"],
  // A hover carries no origin, and a target that has none is a target with `origin: null` — never a
  // half-read one.
  origin: null,
};

const page: PageFacts = {
  url: "http://127.0.0.1:5199/",
  title: "fixture",
  viewport: { width: 512, height: 526, dpr: 1 },
};

const message = (payload: unknown): string => `${PICKER_CHANNEL} ${JSON.stringify(payload)}`;

describe("parsePickerMessage", () => {
  it("reads our own messages, facts and all", () => {
    expect(parsePickerMessage(message({ kind: "selected", target: badge, page }))).toEqual({
      kind: "selected",
      target: badge,
      page,
    });
    expect(parsePickerMessage(message({ kind: "cleared" }))).toEqual({ kind: "cleared" });
  });

  it("ignores the page's own logging, however it is worded", () => {
    expect(parsePickerMessage("hello from the app")).toBeNull();
    expect(parsePickerMessage("")).toBeNull();
    // The prefix alone is not enough: only our JSON counts.
    expect(parsePickerMessage(`${PICKER_CHANNEL} `)).toBeNull();
    expect(parsePickerMessage(`${PICKER_CHANNEL} not json`)).toBeNull();
    expect(
      parsePickerMessage(`prefix ${PICKER_CHANNEL} ${JSON.stringify({ kind: "cleared" })}`),
    ).toBeNull();
    expect(parsePickerMessage(message({ kind: "nonsense" }))).toBeNull();
    expect(parsePickerMessage(message({ kind: "selected" }))).toBeNull();
    expect(
      parsePickerMessage(message({ kind: "selected", target: { tagName: "span" } })),
    ).toBeNull();
  });

  it("reads the origin evidence a selection carries, and drops one it cannot read", () => {
    const frames = [
      {
        url: "http://127.0.0.1:5199/@fs/tmp/vite-cache/deps/react_jsx-dev-runtime.js",
        line: 218,
        column: 88,
        fn: "exports.jsxDEV",
      },
      { url: "http://127.0.0.1:5199/src/Badge.jsx", line: 18, column: 26, fn: "Badge" },
    ];
    const selected = parsePickerMessage(
      message({
        kind: "selected",
        target: { ...badge, origin: { via: "frames", frames } },
        page,
      }),
    );
    expect(selected).toMatchObject({ target: { origin: { via: "frames", frames } } });
    // A page can write anything on this channel, so an evidence we cannot read is no evidence —
    // never a half-believed location the panel would then resolve and show as a fact.
    const broken = [
      { via: "frames", frames: [] },
      { via: "frames" },
      { via: "frames", frames: "not a list" },
      // Every frame unreadable: no frame, so no evidence — the stack is not silently emptied of its
      // meaning by keeping a frame we could not read.
      {
        via: "frames",
        frames: [{ url: "http://d/a.js" }, { url: "http://d/a.js", line: "1", column: 2 }],
      },
      { via: "component-text", fnText: "", offset: 3 },
      { via: "component-text", fnText: "x", offset: "3" },
      { via: "source-loc", line: 5 },
      { via: "file-only" },
      { via: "position", moduleUrl: "http://127.0.0.1:5199/src/Badge.jsx", line: 18, column: 26 },
      { via: "something-else", file: "a" },
      "not an object",
    ];
    for (const origin of broken) {
      const parsed = parsePickerMessage(
        message({ kind: "selected", target: { ...badge, origin }, page }),
      );
      expect(parsed, `origin ${JSON.stringify(origin)} must not be believed`).toMatchObject({
        target: { origin: null },
      });
    }
  });

  it("keeps the frames it can read when a stack holds one it cannot", () => {
    const origin = {
      via: "frames",
      frames: [
        { url: "http://127.0.0.1:5199/src/Badge.jsx", line: 18, column: 26, fn: "Badge" },
        { url: "http://127.0.0.1:5199/src/App.jsx", line: "7", column: 7 },
        { url: "http://127.0.0.1:5199/src/App.jsx", line: 7, column: 7, fn: null },
      ],
    };
    const parsed = parsePickerMessage(
      message({ kind: "selected", target: { ...badge, origin }, page }),
    );
    // The damaged frame is dropped rather than repaired, and order is preserved: what is left still
    // reads inside-out, which is what makes the host's walk meaningful.
    expect(parsed).toMatchObject({
      target: {
        origin: {
          via: "frames",
          frames: [
            { url: "http://127.0.0.1:5199/src/Badge.jsx", line: 18, column: 26, fn: "Badge" },
            { url: "http://127.0.0.1:5199/src/App.jsx", line: 7, column: 7, fn: null },
          ],
        },
      },
    });
  });

  it("drops a fact message with no page: an element with no page is not a payload", () => {
    expect(parsePickerMessage(message({ kind: "selected", target: badge }))).toBeNull();
    expect(
      parsePickerMessage(message({ kind: "hover", target: badge, page: { title: "x" } })),
    ).toBeNull();
  });

  it("keeps the facts it can read and never half-believes the ones it cannot", () => {
    const parsed = parsePickerMessage(
      message({
        kind: "hover",
        target: {
          tagName: "span",
          rect: { x: 1, y: 2, width: 3, height: 4 },
          // A page can log anything; only strings survive into facts, and a missing field is empty.
          computed: { "font-size": "12px", "z-index": 4 },
          attributes: { class: "badge", "data-x": 7 },
          parentChain: ["div.card", 9],
        },
        page: { url: "http://127.0.0.1:5199/x" },
      }),
    );
    expect(parsed).toEqual({
      kind: "hover",
      target: {
        tagName: "span",
        id: null,
        classList: [],
        cssSelector: "",
        role: null,
        name: null,
        testId: null,
        attributes: { class: "badge" },
        text: "",
        computed: { "font-size": "12px" },
        rect: { x: 1, y: 2, width: 3, height: 4 },
        parentChain: ["div.card"],
        origin: null,
      },
      page: {
        url: "http://127.0.0.1:5199/x",
        title: "",
        viewport: { width: 0, height: 0, dpr: 1 },
      },
    });
  });
});

describe("what the panel tells the page", () => {
  it("installs the picker by calling the installer with our channel and the sniffer", () => {
    const script = pickerScript();
    expect(script.startsWith("(function") || script.startsWith("((")).toBe(true);
    expect(script).toContain(`(${JSON.stringify(PICKER_CHANNEL)}, function`);
    expect(script.trimEnd().endsWith(")")).toBe(true);
    // Self-contained: nothing but the page's own globals — no import, no capture from this module.
    // (The picker reads the DOM, `location` and `getComputedStyle`; a reference to this module's
    // scope would not survive the serialization and fails silently, which is why the computed-style
    // list is asserted to be *inside* the serialized function rather than beside it.)
    expect(script).not.toContain("import ");
    expect(script).not.toContain("require(");
    expect(script).toContain("getComputedStyle");
    expect(script).toContain('"font-size"');
  });

  it("starts and stops picking through the installed API, and survives its absence", () => {
    expect(pickerCommand("picking")).toContain(".start()");
    expect(pickerCommand("paused")).toContain(".pause()");
    expect(pickerCommand("off")).toContain(".pause()");
    expect(pickerCommand("off")).toContain('"missing"');
    expect(pickerProbe()).toContain("typeof");
  });
});

/**
 * AC-11's static half: the script we hand the user's page must have no way to send anything out and
 * no way to reach the host. It is checked on the serialized text, which is exactly what the guest
 * evaluates — a primitive added inside the installer cannot hide from this test.
 */
describe("the script handed to the user's page", () => {
  const script = pickerScript();

  it("cannot reach the network", () => {
    for (const primitive of [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "sendBeacon",
      "import(",
      "importScripts",
      "Worker(",
      "http://",
      "https://",
      "ws://",
      "wss://",
    ]) {
      expect(script, `the injected script must not contain ${primitive}`).not.toContain(primitive);
    }
    // A protocol-relative URL (`//host/path`) carries no scheme, so it is matched by shape instead.
    // Comments are not a concern: the check is for a quoted string, not for `//`.
    expect(script).not.toMatch(/["'`]\/\/[a-z0-9-]+\.[a-z]/i);
  });

  it("cannot reach the host or the page's stored state", () => {
    for (const primitive of [
      "require(",
      "process.",
      "ipcRenderer",
      "postMessage",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "eval(",
      "new Function",
    ]) {
      expect(script, `the injected script must not contain ${primitive}`).not.toContain(primitive);
    }
  });

  it("and it is the real thing, not an empty string that would pass the checks above", () => {
    expect(script.length).toBeGreaterThan(1000);
    expect(script).toContain(PICKER_CHANNEL);
    expect(script).toContain("console.log");
    // The one thing it does use to talk back: the page's own console, which is the channel the panel
    // listens on and whose lines the parse above whitelists.
    expect(script).toContain("addEventListener");
  });
});

/**
 * The re-read half of the picker's API (M4.1 / AC-8): the host asks the guest about a **staged**
 * element by the two handles its payload recorded, and reads the answer through the same defensive
 * parsers as a console line — it crosses the same boundary between us and the user's page.
 */
describe("re-reading a staged element", () => {
  it("asks by the recorded path and testid, and asks nothing of a page without a picker", () => {
    const call = pickerResolve("div.card > h2.card-title", "card-title");
    expect(call).toContain(".resolve(");
    expect(call).toContain(JSON.stringify("div.card > h2.card-title"));
    expect(call).toContain(JSON.stringify("card-title"));
    // No picker in the page (never loaded, or the guest navigated away): the answer is null, not a
    // thrown error the panel would have to guess its way out of.
    expect(call).toContain("?");
    expect(call.endsWith(": null")).toBe(true);
  });

  it("sends a null testid as a null, so a payload with no testid is not matched against one", () => {
    const call = pickerResolve("div.card", null);
    expect(call).toContain(JSON.stringify("div.card"));
    expect(call).toContain("null)");
    // Quoted paths, both of them: a selector with a quote in it must not be able to end the string
    // early and become code in the guest.
    expect(pickerResolve('div[data-x="a b"]', null)).toContain(JSON.stringify('div[data-x="a b"]'));
  });

  it("reads a guest answer as facts, and drops one it cannot read", () => {
    expect(elementFromGuest({ target: badge, page })).toEqual({ target: badge, page });
    for (const broken of [
      null,
      "not an object",
      {},
      { target: badge },
      { page },
      // The page is required on a re-read for the same reason it is on a selection: an element with
      // no page is not a payload, and the panel compares origins to tell "moved" from "another page".
      { target: badge, page: { title: "x" } },
      { target: { tagName: "span" }, page },
      { target: badge, page: "http://127.0.0.1:5199/" },
    ]) {
      expect(elementFromGuest(broken), `${JSON.stringify(broken)} is not an answer`).toBeNull();
    }
  });

  it("drops the fields it cannot read instead of half-believing the answer", () => {
    const read = elementFromGuest({
      target: {
        tagName: "H2",
        rect: { x: 0, y: 0, width: 10, height: 4 },
        computed: { "z-index": 3 },
      },
      page: { url: "http://127.0.0.1:5199/" },
    });
    expect(read?.target).toMatchObject({ tagName: "H2", classList: [], computed: {} });
    expect(read?.page.viewport).toEqual({ width: 0, height: 0, dpr: 1 });
  });
});

/**
 * M4.4 / PRD §9.4: the two structures the page's own DOM cannot describe travel as one extra word on
 * the target, and the panel asks the page how many frames it embeds so it can say so *before* the user
 * goes hunting for an element that cannot be picked.
 */
describe("the structures the picker cannot enter (§9.4)", () => {
  /** What the panel ended up believing about a context the page sent, or `"no message"`. */
  const contextOf = (sent: unknown): unknown => {
    const parsed = parsePickerMessage(
      message({ kind: "selected", target: { ...badge, domContext: sent }, page }),
    );
    return parsed !== null && parsed.kind === "selected" ? parsed.target.domContext : "no message";
  };

  it("reads the two words it wrote, and drops any other word the page sends", () => {
    expect(contextOf("shadow")).toBe("shadow");
    expect(contextOf("frame")).toBe("frame");
    // The ordinary case is the field being *absent*: an element under the cursor needs no word.
    expect(contextOf(undefined)).toBeUndefined();
    // A page writing on our channel does not get to invent a third kind of context.
    expect(contextOf("closed-shadow")).toBeUndefined();
    expect(contextOf(7)).toBeUndefined();
    expect(contextOf({ kind: "shadow" })).toBeUndefined();
  });

  it("carries the context back on a re-read, so a refresh cannot lose it", () => {
    // The send-time re-read (AC-8) goes through the same parser, and the message it writes says which
    // element the Agent is being handed — losing the word there would make the payload lie later.
    const read = elementFromGuest({ target: { ...badge, domContext: "shadow" }, page });
    expect(read?.target.domContext).toBe("shadow");
  });

  it("hands the page a picker that descends an open shadow root to find what is under the cursor", () => {
    const script = pickerScript();
    expect(script).toContain("shadowRoot");
    expect(script).toContain("getRootNode");
  });

  it("asks the page how many frames it embeds — a question, not an action", () => {
    const script = pickerFrameCount();
    expect(script).toContain("querySelectorAll");
    expect(script).toContain("iframe");
    expect(script).toContain("frame");
    expect(script).not.toContain("fetch(");
  });
});

describe("describeTarget", () => {
  it("names an element the way the page's own console would: tag, id, first classes", () => {
    expect(describeTarget(badge)).toBe("span.badge");
    expect(describeTarget({ ...badge, tagName: "button", id: "save" })).toBe("button#save.badge");
    expect(describeTarget({ ...badge, classList: [] })).toBe("span");
    expect(describeTarget({ ...badge, classList: ["a", "b", "c"] })).toBe("span.a.b");
  });
});
