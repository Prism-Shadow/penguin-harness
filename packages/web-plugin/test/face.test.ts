/**
 * The face a plugin's web half calls (src/index.ts), with the Web App's side (src/host.ts) played
 * by a stand-in host.
 *
 * - Before the Web App hands its host over, a host ability throws, naming the one that was
 *   called, and nothing is an `ApiError`.
 * - Once handed over, every call reaches the host's own function with its arguments, and
 *   `ApiError` and the tone maps are the host's own.
 * - A plugin's table answers in the language on screen, and switches with it.
 * - A plugin's error codes are found in the language on screen; a code no table carries is not.
 */
import { describe, expect, it } from "vitest";
import { ApiError, apiFetch, defineStrings, openPanel, toneInk, webLocale } from "../src/index";
import { contributedErrorText, provideWebHost, setWebLocale, type WebHost } from "../src/host";

class HostApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A host that records every call it is handed. */
function standInHost(calls: unknown[][]): WebHost {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const tones = { busy: "b", attention: "a", success: "s", link: "l", danger: "d", muted: "m" };
  return {
    ApiError: HostApiError,
    apiFetch: async <T>(path: string, options?: unknown) => {
      calls.push(["apiFetch", path, options]);
      return { ok: true } as T;
    },
    apiErrorText: () => "",
    failureOf: () => ({ text: "", report: null }),
    failureNode: () => null,
    toastApiError: record("toastApiError"),
    requestSettings: record("requestSettings"),
    openPanel: record("openPanel"),
    isTabShown: () => false,
    currentDockScope: () => "~none",
    formatDateTime: (iso) => iso,
    toneInk: tones,
    toneSurface: tones,
    toneDot: tones,
  };
}

describe("the face's host abilities", () => {
  it("says which ability was called before the host was handed over", () => {
    expect(() => openPanel("board")).toThrow(/openPanel was called before the Web App provided/);
    expect(new HostApiError(500, "internal", "x") instanceof ApiError).toBe(false);
  });

  it("forwards every call to the host it was handed, with the host's own error class and tones", async () => {
    const calls: unknown[][] = [];
    provideWebHost(standInHost(calls));
    expect(await apiFetch("/api/board", { method: "POST", body: { a: 1 } })).toEqual({ ok: true });
    openPanel("board", "bottom");
    expect(calls).toEqual([
      ["apiFetch", "/api/board", { method: "POST", body: { a: 1 } }],
      ["openPanel", "board", "bottom", undefined],
    ]);
    expect(new HostApiError(409, "busy", "x") instanceof ApiError).toBe(true);
    expect(toneInk.danger).toBe("d");
  });
});

describe("a plugin's string tables", () => {
  const zh = {
    title: "看板",
    count: (n: number) => `${n} 张卡片`,
    apiErrors: { board_full: "看板已满。" },
  };
  const en: typeof zh = {
    title: "Board",
    count: (n) => `${n} cards`,
    apiErrors: { board_full: "The board is full." },
  };
  const S = defineStrings({ zh, en });

  it("answers in the language on screen and follows a switch", () => {
    setWebLocale("zh");
    expect([S.title, S.count(2)]).toEqual(["看板", "2 张卡片"]);
    setWebLocale("en");
    expect(webLocale()).toBe("en");
    expect([S.title, S.count(2)]).toEqual(["Board", "2 cards"]);
  });

  it("brings the plugin's error codes, and nothing for a code no table carries", () => {
    setWebLocale("zh");
    expect(contributedErrorText("board_full")).toBe("看板已满。");
    setWebLocale("en");
    expect(contributedErrorText("board_full")).toBe("The board is full.");
    expect(contributedErrorText("no_such_code")).toBeUndefined();
  });
});
