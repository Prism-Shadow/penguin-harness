/**
 * The QQ scan-to-connect block's rendered shape.
 *
 * Three rules that a type checker cannot see. The QR is generated locally and inlined as
 * `<svg>`, so no third party ever learns the task handle from an image request. It is drawn
 * dark-on-white in BOTH themes rather than inheriting the panel's colours, because a code
 * inverted for a dark background is read unreliably by phone cameras. And it carries the
 * four-module quiet zone the QR spec requires, without which scanners lose the finder
 * patterns against a busy page.
 *
 * The fourth is the one that matters most and is asserted here as well as server-side: the
 * copy tells the reader the decryption key stays on the server, because "why is it safe to
 * let a web page fetch my App Secret" is the question this flow has to answer.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encode } from "uqr";
import { QQScanConnect, QrCode } from "../src/features/messaging/qq-scan-connect";
import { S } from "../src/lib/strings";

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

  it("offers the scan as the leading path, with the manual fields as the fallback", () => {
    const html = render(false);
    expect(html).toContain(S.qq.scanStart);
    expect(html).toContain(S.qq.scanHint);
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
