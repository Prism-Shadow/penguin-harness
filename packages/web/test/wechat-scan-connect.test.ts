/**
 * The WeChat scan-to-connect block: what it renders, and the decision its poll loop makes on
 * each answer.
 *
 * It carries more states than QQ's, and that is what most of this file is about. WeChat
 * separates SCANNING from confirming and may interpose a pairing code shown on the phone, so
 * two of its answers change the panel's caption while leaving the code up — tearing the QR
 * down mid-flow would strand a user who is looking at their phone. Two more end the flow
 * without being failures or lapses: a code spent on wrong pairing digits, and a bot that was
 * already bound here, which is news rather than an error.
 *
 * The QR itself is QQ's component, so its rendering rules are asserted there; what is
 * asserted here is that this panel reaches for it rather than growing a second one.
 *
 * The loop is tested by value rather than by mounting: this package's vitest runs in `node`,
 * deliberately, so the classification lives in a pure function (`wechatScanStep`, the
 * `updateCheckOutcome` idiom) and the effects around it stay a thin shell.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WeChatBindingInfo, WeChatScanPollResponse } from "@prismshadow/penguin-server/api";
import { ApiError } from "../src/api/client";
import { WeChatScanConnect, wechatScanStep } from "../src/features/messaging/wechat-scan-connect";
import type { WeChatScanTally } from "../src/features/messaging/wechat-scan-connect";
import { S, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

describe("WeChatScanConnect", () => {
  const render = (opts: { enabled?: boolean; bound?: boolean } = {}) =>
    renderToStaticMarkup(
      createElement(WeChatScanConnect, {
        sessionId: "session-1",
        enabled: opts.enabled ?? false,
        bound: opts.bound ?? false,
        onBound: () => {},
      }),
    );

  it("offers the scan as a control alone, with its explanation disclosed elsewhere", () => {
    const html = render();
    expect(html).toContain(S.wechat.scanStart);
    // What scanning is, and that it is the ONLY way to bind this channel, is semantics: the
    // setup fold says it. A neighbouring button is not a title for a standing sentence.
    expect(html).not.toContain(S.wechat.scanOnly);
    // Nothing is requested until the user asks: no code exists on first render.
    expect(html).not.toContain(S.wechat.scanWaiting);
  });

  it("offers to replace a credential rather than to connect once one is stored", () => {
    // The same control, two meanings: with a token saved, scanning rebinds.
    expect(render({ bound: true })).toContain(S.wechat.scanRescan);
    expect(render({ bound: true })).not.toContain(S.wechat.scanStart);
  });

  it("gates the scan while the connection is enabled, and says why", () => {
    const html = render({ enabled: true });
    expect(html).toContain("disabled=");
    // A rebind would swap the credential under a live connector, so it is refused with a
    // reason rather than silently done.
    expect(html).toContain(`title="${S.wechat.scanDisableFirst}"`);
    expect(render()).not.toContain(`title="${S.wechat.scanDisableFirst}"`);
  });
});

describe("wechatScanStep", () => {
  const fresh: WeChatScanTally = { failures: 0, refreshes: 0 };
  const ok = (res: WeChatScanPollResponse) => ({ ok: true, res }) as const;
  const failed = (error: unknown) => ({ ok: false, error }) as const;

  it("keeps waiting while nothing has happened yet", () => {
    expect(wechatScanStep(ok({ status: "pending" }), fresh)).toEqual({ kind: "wait" });
  });

  it("reports progress without taking the code down, which is what the phone is still for", () => {
    // Both are mid-flow: the QR is still the thing being authorized, and only the caption
    // (and, for the second, the pairing-code input) changes.
    expect(wechatScanStep(ok({ status: "scanned" }), fresh)).toEqual({
      kind: "progress",
      status: "scanned",
    });
    expect(wechatScanStep(ok({ status: "need_verify_code" }), fresh)).toEqual({
      kind: "progress",
      status: "need_verify_code",
    });
  });

  it("hands the binding on, so the editor adopts it without a second GET", () => {
    const binding = { channel: "wechat", botId: "bot_9001" } as WeChatBindingInfo;
    expect(wechatScanStep(ok({ status: "completed", botId: "bot_9001", binding }), fresh)).toEqual({
      kind: "bound",
      botId: "bot_9001",
      binding,
    });
  });

  it("ends on a spent pairing code, which polling the same handle cannot recover", () => {
    expect(wechatScanStep(ok({ status: "blocked" }), fresh)).toEqual({
      kind: "stop",
      notice: S.wechat.scanBlocked,
      tone: "error",
      // The platform declared the code spent, so the server consumed the task on that poll.
      releaseTask: false,
    });
  });

  it("reports an already-bound bot as news rather than as a failure", () => {
    // Nothing was saved because nothing needed to be: the existing binding still works, and
    // a red toast would tell the user to fix something that is not broken.
    expect(wechatScanStep(ok({ status: "already_bound" }), fresh)).toEqual({
      kind: "stop",
      notice: S.wechat.scanAlreadyBound,
      tone: "info",
      releaseTask: false,
    });
  });

  it("rides out a transient failure rather than taking the code off the screen", () => {
    // The user is walking to their phone when one poll 502s. Tearing the panel down there
    // means their scan lands on a task the panel already abandoned and binds nothing.
    const error = new ApiError(502, "wechat_scan_failed", "bad gateway");
    expect(wechatScanStep(failed(error), fresh)).toEqual({ kind: "wait" });
    expect(wechatScanStep(failed(error), { failures: 1, refreshes: 0 })).toEqual({ kind: "wait" });
    // Failing over and over is not transient any more. Giving up releases the task: nothing
    // resolved it, so the server would otherwise hold its handle until the sweep.
    expect(wechatScanStep(failed(error), { failures: 2, refreshes: 0 })).toEqual({
      kind: "stop",
      notice: S.wechat.scanFailed("bad gateway"),
      tone: "error",
      releaseTask: true,
    });
    // One answer that came back resets the run — the loop passes failures: 0 again.
    expect(wechatScanStep(ok({ status: "pending" }), { failures: 2, refreshes: 0 })).toEqual({
      kind: "wait",
    });
  });

  it("replaces a lapsed code, but a bounded number of times", () => {
    expect(wechatScanStep(ok({ status: "expired" }), fresh)).toEqual({ kind: "refresh" });
    expect(wechatScanStep(ok({ status: "expired" }), { failures: 0, refreshes: 2 })).toEqual({
      kind: "refresh",
    });
    // A platform reporting codes it just created as expired would otherwise loop
    // create/poll for as long as the panel stays open.
    expect(wechatScanStep(ok({ status: "expired" }), { failures: 0, refreshes: 3 })).toEqual({
      kind: "stop",
      notice: S.wechat.scanExpiredRepeatedly,
      tone: "error",
      releaseTask: false,
    });
  });

  it("names no position for the code, which wraps above the text in a narrow panel", () => {
    // The waiting panel is `flex flex-wrap`: in the dock or on a phone the steps sit BELOW
    // the QR, so copy that says "the code on the left" is wrong exactly where it is read.
    for (const dict of [zh, en]) {
      expect(dict.wechat.scanSteps).not.toMatch(/左侧|右侧|left|right/);
      expect(dict.wechat.verifyPrompt).not.toMatch(/左侧|右侧|left|right/);
    }
  });
});
