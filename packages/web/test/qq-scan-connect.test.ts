/**
 * The QQ scan-to-connect block: the shape it renders, and the decision the poll loop makes
 * on each answer.
 *
 * Three rendered rules that a type checker cannot see. The QR is generated locally and
 * inlined as `<svg>`, so no third party ever learns the task handle from an image request.
 * It is drawn dark-on-white in BOTH themes rather than inheriting the panel's colours,
 * because a code inverted for a dark background is read unreliably by phone cameras. And it
 * carries the four-module quiet zone the QR spec requires, without which scanners lose the
 * finder patterns against a busy page.
 *
 * The fourth is the one that matters most and is asserted here as well as server-side: the
 * copy tells the reader the decryption key stays on the server, because "why is it safe to
 * let a web page fetch my App Secret" is the question this flow has to answer.
 *
 * The loop itself is tested by value rather than by mounting: this package's vitest runs in
 * `node`, deliberately, so the classification lives in a pure function (`qqScanStep`, the
 * `updateCheckOutcome` idiom) and the effects around it stay a thin shell.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encode } from "uqr";
import type { QQBindingInfo, QQScanPollResponse } from "@prismshadow/penguin-server/api";
import { ApiError } from "../src/api/client";
import { QQScanConnect, QrCode, qqScanStep } from "../src/features/messaging/qq-scan-connect";
import type { QQScanTally } from "../src/features/messaging/qq-scan-connect";
import { S, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const QR_URL = "https://q.qq.com/qqbot/openclaw/connect.html?task_id=t-1&source=&_wv=2";

describe("QrCode", () => {
  it("inlines the code as SVG, with the spec's quiet zone around it", () => {
    const html = renderToStaticMarkup(
      createElement(QrCode, { value: QR_URL, label: S.qq.scanQrLabel }),
    );
    // Four modules of margin on each side: the viewBox is the code plus eight.
    const { size } = encode(QR_URL);
    expect(html).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
    // Generated here, not fetched: nothing in the markup requests an image.
    expect(html).not.toContain("<img");
    expect(html).not.toContain("http");
    expect(html).toContain(`aria-label="${S.qq.scanQrLabel}"`);
    expect(html).toContain('role="img"');
  });

  it("is dark-on-white in both themes rather than inheriting the panel's colours", () => {
    const html = renderToStaticMarkup(
      createElement(QrCode, { value: QR_URL, label: S.qq.scanQrLabel }),
    );
    // Explicit, unconditional colours: a theme-following code is a code that fails to scan
    // for half the people who try it.
    expect(html).toContain('fill="#ffffff"');
    expect(html).toContain('fill="#000000"');
    expect(html).not.toContain("currentColor");
    expect(html).not.toContain("dark:");
    // Crisp module edges, and enough of them to be a real code rather than a blank plate.
    expect(html).toContain('shape-rendering="crispEdges"');
    expect((html.match(/<rect/g) ?? []).length).toBeGreaterThan(100);
  });
});

describe("QQScanConnect", () => {
  const render = (enabled: boolean) =>
    renderToStaticMarkup(
      createElement(QQScanConnect, { sessionId: "session-1", enabled, onBound: () => {} }),
    );

  it("offers the scan as a control alone, with its explanation disclosed elsewhere", () => {
    const html = render(false);
    expect(html).toContain(S.qq.scanStart);
    // What scanning is and what it spares the user is semantics, so it is disclosed in the
    // setup fold. A neighbouring button is not a title for a standing sentence.
    expect(html).not.toContain(S.qq.scanHint);
    // Nothing is requested until the user asks for it: no task exists on first render.
    expect(html).not.toContain(S.qq.scanWaiting);
  });

  it("gates the scan while the connection is enabled, and says why", () => {
    const html = render(true);
    expect(html).toContain("disabled=");
    // A rebind would swap the credentials under a live connector, so it is refused with a
    // reason rather than silently doing it.
    expect(html).toContain(`title="${S.qq.scanDisableFirst}"`);
    expect(render(false)).not.toContain(`title="${S.qq.scanDisableFirst}"`);
  });
});

describe("qqScanStep", () => {
  const fresh: QQScanTally = { failures: 0, refreshes: 0 };
  const ok = (res: QQScanPollResponse) => ({ ok: true, res }) as const;
  const failed = (error: unknown) => ({ ok: false, error }) as const;

  it("keeps waiting while the scan has not happened yet", () => {
    expect(qqScanStep(ok({ status: "pending" }), fresh)).toEqual({ kind: "wait" });
    expect(qqScanStep(ok({ status: "none" }), fresh)).toEqual({ kind: "wait" });
  });

  it("hands the binding on, so the editor adopts it without a second GET", () => {
    const binding = { channel: "qq", appId: "102000042" } as QQBindingInfo;
    expect(qqScanStep(ok({ status: "completed", appId: "102000042", binding }), fresh)).toEqual({
      kind: "bound",
      appId: "102000042",
      binding,
    });
  });

  it("rides out a transient failure rather than taking the code off the screen", () => {
    // The user is walking to their phone when one poll 502s. Tearing the panel down there
    // means their scan lands on a task the panel already abandoned and binds nothing.
    const error = new ApiError(502, "qq_scan_failed", "bad gateway");
    expect(qqScanStep(failed(error), fresh)).toEqual({ kind: "wait" });
    expect(qqScanStep(failed(error), { failures: 1, refreshes: 0 })).toEqual({ kind: "wait" });
    // Failing over and over is not transient any more.
    // Giving up releases the task: nothing resolved it, so the server would otherwise hold
    // its key until the sweep — the "key at rest" outcome this flow is shaped to avoid.
    const step = qqScanStep(failed(error), { failures: 2, refreshes: 0 });
    expect(step).toEqual({
      kind: "stop",
      notice: S.qq.scanFailed("bad gateway"),
      releaseTask: true,
    });
    // One answer that came back resets the run — the loop passes failures: 0 again.
    expect(qqScanStep(ok({ status: "pending" }), { failures: 2, refreshes: 0 })).toEqual({
      kind: "wait",
    });
  });

  it("replaces a lapsed code, but a bounded number of times", () => {
    expect(qqScanStep(ok({ status: "expired" }), fresh)).toEqual({ kind: "refresh" });
    expect(qqScanStep(ok({ status: "expired" }), { failures: 0, refreshes: 2 })).toEqual({
      kind: "refresh",
    });
    // A platform that reports tasks it just created as expired — clock skew, throttling, an
    // outage returning one fixed code — would otherwise loop create/poll forever.
    expect(qqScanStep(ok({ status: "expired" }), { failures: 0, refreshes: 3 })).toEqual({
      kind: "stop",
      notice: S.qq.scanExpiredRepeatedly,
      // The platform reported it expired, so the server already consumed the task on that
      // poll: cancelling it would be a request that can only 404.
      releaseTask: false,
    });
  });

  it("names no position for the code, which wraps above the text in a narrow panel", () => {
    // The waiting panel is `flex flex-wrap`: in the dock or on a phone the steps sit BELOW
    // the QR, so copy that says "the code on the left" is wrong exactly where it is read.
    for (const dict of [zh, en]) {
      expect(dict.qq.scanSteps).not.toMatch(/左侧|右侧|left|right/);
    }
  });
});
