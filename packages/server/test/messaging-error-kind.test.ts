/**
 * Which messaging failures the dashboard counts as needing a human.
 *
 * The rule under test is the recorder's own criterion — "does a human need to step in" — and
 * it answers from the error's type AND the capture point's code, because the same refusal is
 * routine where the chat was handed the fix and waits for a human where nobody was. The cost
 * center highlights the unexpected count, so getting either half wrong points that highlight
 * at nothing, or hides the one failure worth an alert.
 *
 * Only the two halves live here; that the classification reaches `error_records` this way is
 * proved end to end in messaging.test.ts and messaging-qq.test.ts.
 */
import { describe, expect, it } from "vitest";
import { messagingErrorKind } from "../src/runtime/messaging/error-kind.js";
import {
  MessagingMediaTooLargeError,
  MessagingOutboundCapError,
  MessagingPermissionError,
  MessagingUnsupportedError,
} from "../src/runtime/messaging/media.js";
import { MessagingConnectionClosedError } from "../src/runtime/messaging/qq-api.js";

/** Feishu's 99991672, which every one of its calls throws alike — the point of the code half. */
const scopeDenial = (): MessagingPermissionError =>
  new MessagingPermissionError(
    ["im:message", "im:message.history:readonly"],
    "https://open.feishu.cn/app/cli_x/auth?q=im:message",
    "Access denied. One of the following scopes is required (code 99991672)",
  );

/** QQ's refusal of any outbound file, which the platform repeats identically every time. */
const qqFileRefusal = (): MessagingUnsupportedError =>
  new MessagingUnsupportedError('QQ cannot receive "chart.png": requires a public URL');

describe("messagingErrorKind", () => {
  it("files a typed refusal as expected on an inbound download, where the chat was told", () => {
    // The inbound download answers into the chat with the scope names and the console link:
    // it has already handed the fix to the only person who can apply it, so a dashboard adds
    // nothing.
    expect(messagingErrorKind(scopeDenial(), "messaging_image_fetch_failed")).toBe("expected");
    // An inbound FILE download is the same capture point in every way that matters here: on
    // Feishu it is the very same scope denial, answered into the chat with the same scope
    // names and console link (see messagingInboundFilePermissionNotice).
    expect(messagingErrorKind(scopeDenial(), "messaging_file_fetch_failed")).toBe("expected");
    // The same denial on a send, which is the ordinary half-configured app: nothing reaches
    // the chat, because the message that would carry the notice is the one being refused.
    expect(messagingErrorKind(scopeDenial(), "messaging_send_failed")).toBe("unexpected");
    expect(messagingErrorKind(scopeDenial(), "messaging_inbound_failed")).toBe("unexpected");
  });

  it("files an outbound file refusal as expected only when nobody has anything to fix", () => {
    // A reply's file that did not go out is recorded and never posted into the chat, so
    // nobody is told anything there. What stays routine is what nobody could act on: a
    // channel that can never carry a file...
    expect(messagingErrorKind(qqFileRefusal(), "messaging_file_send_failed")).toBe("expected");
    // ...and the bridge's own caps, per file and per reply.
    expect(
      messagingErrorKind(
        new MessagingOutboundCapError('"huge.png" was not sent: over the 10MB limit'),
        "messaging_file_too_large",
      ),
    ).toBe("expected");
    expect(
      messagingErrorKind(
        new MessagingOutboundCapError("2 more files were not sent: at most 5 per reply"),
        "messaging_files_skipped",
      ),
    ).toBe("expected");
    // A missing permission on the upload is NOT: the same denial is routine on an inbound
    // download because the chat is handed the fix there, while here nobody is handed
    // anything, and a human still has to grant the scope.
    expect(messagingErrorKind(scopeDenial(), "messaging_file_send_failed")).toBe("unexpected");
    // Nor anything else the upload throws.
    expect(messagingErrorKind(new Error("upload rejected"), "messaging_file_send_failed")).toBe(
      "unexpected",
    );
    expect(
      messagingErrorKind(
        new MessagingMediaTooLargeError("The file", 30 * 1024 * 1024),
        "messaging_file_send_failed",
      ),
    ).toBe("unexpected");
  });

  it("holds each outbound type to its own capture point", () => {
    // The allowlist pairs a type with a code. The cap error is routine where the bridge files
    // it and nowhere else, and the structural refusal is not routine at the caps' codes.
    expect(
      messagingErrorKind(new MessagingOutboundCapError("over a cap"), "messaging_send_failed"),
    ).toBe("unexpected");
    expect(
      messagingErrorKind(new MessagingOutboundCapError("over a cap"), "messaging_file_send_failed"),
    ).toBe("unexpected");
    expect(messagingErrorKind(qqFileRefusal(), "messaging_file_too_large")).toBe("unexpected");
    // And a plain Error at the caps' own codes is still unclassified: the type is half the rule.
    expect(messagingErrorKind(new Error("over a cap"), "messaging_file_too_large")).toBe(
      "unexpected",
    );
    expect(messagingErrorKind(new Error("over a cap"), "messaging_files_skipped")).toBe(
      "unexpected",
    );
  });

  it("leaves everything it has not been taught about unexpected, wording included", () => {
    // The safe direction: a real fault miscounted as routine is invisible, while routine noise
    // miscounted as a fault is merely loud. A plain Error repeating a permission error's words
    // is still unclassified — matching on wording would make the count depend on how a
    // platform phrases its refusal.
    expect(messagingErrorKind(new Error("socket hang up"), "messaging_image_fetch_failed")).toBe(
      "unexpected",
    );
    expect(
      messagingErrorKind(
        new Error("Access denied (code 99991672)"),
        "messaging_image_fetch_failed",
      ),
    ).toBe("unexpected");
    expect(messagingErrorKind(undefined, "messaging_connect_failed")).toBe("unexpected");
  });

  it("a platform close is read from its own verdict, not from the capture point", () => {
    // Classified by its own verdict wherever it is caught, including capture points the sets
    // above deliberately exclude: nobody needs telling because the connector's next handshake
    // already put the connection back.
    expect(
      messagingErrorKind(
        new MessagingConnectionClosedError("gateway connection closed (code 4009)", 4009, true),
        "messaging_connect_failed",
      ),
    ).toBe("expected");
    // A close that leaves the binding down until a person changes a credential or a console
    // setting keeps its place on the dashboard, whatever number it carries.
    expect(
      messagingErrorKind(
        new MessagingConnectionClosedError("gateway connection closed (code 4004)", 4004, false),
        "messaging_connect_failed",
      ),
    ).toBe("unexpected");
    expect(
      messagingErrorKind(
        new MessagingConnectionClosedError("gateway refused this bot", 4914, false),
        "messaging_connect_failed",
      ),
    ).toBe("unexpected");
    // The verdict travels with the type, so it holds wherever the failure is caught.
    expect(
      messagingErrorKind(
        new MessagingConnectionClosedError("gateway connection closed (code 4009)", 4009, true),
        "messaging_inbound_failed",
      ),
    ).toBe("expected");
    // And a plain Error that merely quotes the code is not one: matching on wording would tie
    // the count to how a platform phrases its own close.
    expect(
      messagingErrorKind(
        new Error("gateway connection closed (code 4009)"),
        "messaging_connect_failed",
      ),
    ).toBe("unexpected");
  });
});
