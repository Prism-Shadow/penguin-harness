/**
 * Which messaging failures the dashboard counts as needing a human.
 *
 * The rule under test is the recorder's own criterion — "does a human need to step in" — and
 * the cases that matter are the ones where something failed and the answer is still no: the
 * chat has already handed the only person who can act the exact fix, or there is no fix at
 * all. Getting this wrong is not cosmetic: the cost center raises a to-do badge on the
 * unexpected count, so routine refusals filed there point a red dot at nothing.
 */
import { describe, expect, it } from "vitest";
import { messagingErrorKind } from "../src/runtime/messaging/error-kind.js";
import {
  MessagingMediaTooLargeError,
  MessagingPermissionError,
  MessagingUnsupportedError,
} from "../src/runtime/messaging/media.js";

describe("messagingErrorKind", () => {
  it("files a scope the app was never granted as expected", () => {
    // Feishu's 99991672: the chat receives the scope names and the console link, so the fix
    // is already in the hands of the only person who can apply it.
    const err = new MessagingPermissionError(
      ["im:message", "im:message.history:readonly"],
      "https://open.feishu.cn/app/cli_x/auth?q=im:message",
      "Access denied. One of the following scopes is required (code 99991672)",
    );
    expect(messagingErrorKind(err)).toBe("expected");
  });

  it("files a transfer over the cap as expected", () => {
    // The sender fixes it by sending something smaller, and the chat says so.
    expect(messagingErrorKind(new MessagingMediaTooLargeError("The image", 20 * 1024 * 1024))).toBe(
      "expected",
    );
  });

  it("files what a channel structurally cannot carry as expected", () => {
    // QQ's outbound media: it will refuse the next one identically, and no deployment change
    // available here alters that. A defect count that includes it teaches people to ignore it.
    expect(
      messagingErrorKind(
        new MessagingUnsupportedError('QQ cannot receive "chart.png": requires a public URL'),
      ),
    ).toBe("expected");
  });

  it("leaves everything it has not been taught about unexpected", () => {
    // The safe direction: a real fault miscounted as routine is invisible, while routine noise
    // miscounted as a fault is merely loud.
    expect(messagingErrorKind(new Error("socket hang up"))).toBe("unexpected");
    expect(messagingErrorKind(new TypeError("x is not a function"))).toBe("unexpected");
    expect(messagingErrorKind("a thrown string")).toBe("unexpected");
    expect(messagingErrorKind(undefined)).toBe("unexpected");
  });

  it("classifies by type, not by message text", () => {
    // A plain Error repeating a permission error's words is still an unclassified failure:
    // matching on wording would make the count depend on a channel's phrasing.
    expect(messagingErrorKind(new Error("Access denied (code 99991672)"))).toBe("unexpected");
  });
});
