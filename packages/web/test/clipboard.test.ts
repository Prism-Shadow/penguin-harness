/**
 * writeClipboard unit tests: the copy path that has to work on the origins this app is
 * actually served from.
 *
 * `navigator.clipboard` is secure-context-only, so it is absent on every plain-HTTP origin
 * that is not localhost — a LAN bind, a remote install opened at `http://<host>:7364`. The
 * cases below pin both halves of that: the fallback copies rather than silently doing
 * nothing, and it reports honestly when even the fallback is refused, because the callers
 * gate their "copied" check on that answer.
 *
 * Two things beyond the return value matter. The fallback's `execCommand` is only honoured
 * while a user gesture is in progress, so the absent-API path must reach it **without
 * suspending** — a `writeClipboard(...)` that only got there on a later microtask would
 * pass a naive assertion and fail in a browser. And the textarea it borrows must leave no
 * trace in the document whichever way the attempt ends.
 *
 * The last test pins the seam against the source text: a copy affordance that reaches for
 * `navigator.clipboard.writeText` on its own would reintroduce exactly the silent no-op
 * this module exists to prevent, and nothing in a node-only suite would notice
 * (context-menu.test.ts convention).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboard } from "../src/lib/clipboard";

interface FakeTextarea {
  value: string;
  attributes: Record<string, string>;
  style: Record<string, string>;
  selectCount: number;
  removed: boolean;
  setAttribute(name: string, value: string): void;
  select(): void;
  remove(): void;
}

interface FakeDocument {
  areas: FakeTextarea[];
  appended: FakeTextarea[];
  execCalls: string[];
}

/** Installs a `document` whose copy command answers `copy()`, and reports what it saw. */
function stubDocument(copy: () => boolean): FakeDocument {
  const state: FakeDocument = { areas: [], appended: [], execCalls: [] };
  const doc = {
    createElement(tag: string): FakeTextarea {
      expect(tag).toBe("textarea");
      const area: FakeTextarea = {
        value: "",
        attributes: {},
        style: {},
        selectCount: 0,
        removed: false,
        setAttribute(name, value) {
          area.attributes[name] = value;
        },
        select() {
          area.selectCount += 1;
        },
        remove() {
          area.removed = true;
        },
      };
      state.areas.push(area);
      return area;
    },
    body: {
      appendChild(area: FakeTextarea) {
        state.appended.push(area);
        return area;
      },
    },
    execCommand(command: string): boolean {
      state.execCalls.push(command);
      return copy();
    },
  };
  vi.stubGlobal("document", doc);
  return state;
}

/** Installs a `navigator` with no `clipboard` — what a non-secure origin serves. */
function stubInsecureNavigator(): void {
  vi.stubGlobal("navigator", {});
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("writeClipboard", () => {
  it("uses the async Clipboard API where it exists, and touches no textarea", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const doc = stubDocument(() => true);

    await expect(writeClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(doc.areas).toHaveLength(0);
  });

  it("copies through the fallback when the Clipboard API is absent", async () => {
    stubInsecureNavigator();
    const doc = stubDocument(() => true);

    await expect(writeClipboard("reply text")).resolves.toBe(true);
    expect(doc.execCalls).toEqual(["copy"]);
    const area = doc.areas[0];
    expect(area?.value).toBe("reply text");
    expect(area?.selectCount).toBe(1);
    expect(doc.appended).toHaveLength(1);
  });

  it("keeps the fallback's textarea out of layout so selecting it cannot scroll the page", async () => {
    stubInsecureNavigator();
    const doc = stubDocument(() => true);

    await writeClipboard("x");
    const area = doc.areas[0];
    expect(area?.attributes.readonly).toBe("");
    expect(area?.style.position).toBe("fixed");
    expect(area?.style.opacity).toBe("0");
  });

  it("reaches the fallback without suspending, so the click's gesture is still live", () => {
    stubInsecureNavigator();
    const doc = stubDocument(() => true);

    // Deliberately not awaited: the copy command has to have run by the time the call
    // returns, not on some later turn of the microtask queue.
    void writeClipboard("x");
    expect(doc.execCalls).toEqual(["copy"]);
  });

  it("falls back when the Clipboard API rejects", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("NotAllowedError");
        },
      },
    });
    const doc = stubDocument(() => true);

    await expect(writeClipboard("x")).resolves.toBe(true);
    expect(doc.execCalls).toEqual(["copy"]);
  });

  it("reports a refused copy rather than one that did not happen", async () => {
    stubInsecureNavigator();
    stubDocument(() => false);

    await expect(writeClipboard("x")).resolves.toBe(false);
  });

  it("reports false and cleans up when the copy command itself throws", async () => {
    stubInsecureNavigator();
    const doc = stubDocument(() => {
      throw new Error("blocked");
    });

    await expect(writeClipboard("x")).resolves.toBe(false);
    expect(doc.areas[0]?.removed).toBe(true);
  });

  it("removes the textarea after a successful copy too", async () => {
    stubInsecureNavigator();
    const doc = stubDocument(() => true);

    await writeClipboard("x");
    expect(doc.areas[0]?.removed).toBe(true);
  });
});

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const CLIPBOARD_MODULE = join(SRC, "lib", "clipboard.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("clipboard writes go through one seam", () => {
  it("has no other module writing to navigator.clipboard", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== CLIPBOARD_MODULE)
      .filter((file) =>
        /navigator\s*\.\s*clipboard[\s\S]{0,40}?writeText/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
