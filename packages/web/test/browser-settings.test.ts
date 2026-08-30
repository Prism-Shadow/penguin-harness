/**
 * Settings › Personal › Browser and Settings › Server › Chrome extension
 * (features/settings/browser-section.tsx, chrome-extension-section.tsx): the paired Chromes as
 * rendered to static markup, and the two confirmations as the elements the pages render, driven
 * through their handlers against the fetch fake (node env, no DOM).
 *
 * - The list names each paired Chrome with its extension's version and when it was last
 *   connected (or that it never was), and a dot saying whether it is connected; with none paired
 *   it says so.
 * - Revoke only asks: pressing it sends nothing. The question is in the danger tone, names the
 *   Chrome and says the agents lose it until it is paired again. Answered yes, it revokes that
 *   Chrome, says so, and the list reloads; a revoke the server refused says why and reloads
 *   nothing.
 * - Turning the server's switch off asks first, in the danger tone, saying every user's
 *   extension disconnects. Answered yes, it writes the switch off and hands on what the server
 *   stored; a failed write is handed on as the failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BrowserExtensionRecord, ServerSettings } from "@prismshadow/penguin-server/api";
import { Button } from "@prismshadow/penguin-ui";
import { PairedChromes, RevokeConfirm } from "../src/features/settings/browser-section";
import { ExtensionsOffConfirm } from "../src/features/settings/chrome-extension-section";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";

const toasts = vi.hoisted(() => [] as string[]);

vi.mock("@prismshadow/penguin-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prismshadow/penguin-ui")>();
  return {
    ...actual,
    toastSuccess: (text: string) => toasts.push(`success: ${text}`),
    toastError: (text: string) => toasts.push(`error: ${text}`),
  };
});

const MAC: BrowserExtensionRecord = {
  id: "ext-mac",
  name: "Chrome 130 on macOS",
  version: "0.2.13",
  createdAt: "2026-10-01T08:00:00.000Z",
  lastSeenAt: "2026-10-02T09:30:00.000Z",
  connected: true,
};
const LINUX: BrowserExtensionRecord = {
  ...MAC,
  id: "ext-linux",
  name: "Chrome 129 on Linux",
  lastSeenAt: null,
  connected: false,
};

/** The props a ConfirmModal element was given. */
type Confirm = ReactElement<{
  open: boolean;
  tone?: string;
  title: string;
  confirmLabel: string;
  children: ReactNode;
  onConfirm: () => void;
}>;

/** Every element of `type` in a tree of plain elements. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  return ([] as ReactNode[])
    .concat(node)
    .filter(isValidElement)
    .flatMap((el) => {
      const element = el as ReactElement<{ children?: ReactNode }>;
      const own = element.type === type ? [element as ReactElement<Record<string, unknown>>] : [];
      return [...own, ...find(element.props.children, type)];
    });
}

beforeEach(() => {
  toasts.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the paired Chromes", () => {
  it("names each with its version, when it was last connected, and whether it is connected", () => {
    const html = renderToStaticMarkup(
      createElement(PairedChromes, {
        list: { paired: [MAC, LINUX], enabled: true },
        onRevoke: () => {},
      }),
    );
    expect(html.split('data-testid="paired-chrome"').length - 1).toBe(2);
    expect(html).toContain(MAC.name);
    expect(html).toContain(S.browserSettings.pairedLine("0.2.13", null));
    expect(html).toContain(`aria-label="${S.browserSettings.connected}"`);
    expect(html).toContain(`aria-label="${S.browserSettings.notConnected}"`);
  });

  it("says when none is paired", () => {
    const html = renderToStaticMarkup(
      createElement(PairedChromes, { list: { paired: [], enabled: true }, onRevoke: () => {} }),
    );
    expect(html).toContain(S.browserSettings.pairedNone);
  });

  it("only asks when Revoke is pressed: nothing is sent", () => {
    const fetch = stubFetch(() => json({}));
    const onRevoke = vi.fn();
    const tree = PairedChromes({ list: { paired: [MAC], enabled: true }, onRevoke });
    const [revoke] = find(tree, Button);
    expect(revoke!.props.children).toBe(S.browserSettings.revoke);
    (revoke!.props.onClick as () => void)();
    expect(onRevoke).toHaveBeenCalledExactlyOnceWith(MAC);
    expect(fetch.requests).toEqual([]);
  });
});

describe("revoking a Chrome", () => {
  it("asks in the danger tone, naming the Chrome and that it must be paired again", () => {
    const confirm = RevokeConfirm({
      record: MAC,
      onClose: () => {},
      onRevoked: () => {},
    }) as Confirm;
    expect(confirm.props.open).toBe(true);
    // The confirm's default tone is danger; nothing here lowers it.
    expect(confirm.props.tone).toBeUndefined();
    expect(confirm.props.confirmLabel).toBe(S.browserSettings.revoke);
    expect(renderToStaticMarkup(confirm.props.children as ReactElement)).toContain(
      S.browserSettings.revokeBody(MAC.name),
    );
    const closed = RevokeConfirm({ record: null, onClose: () => {}, onRevoked: () => {} });
    expect((closed as Confirm).props.open).toBe(false);
  });

  it("revokes that Chrome once answered yes, says so, and reloads the list", async () => {
    const fetch = stubFetch(() => new Response(null, { status: 204 }));
    const onClose = vi.fn();
    const onRevoked = vi.fn();
    (RevokeConfirm({ record: MAC, onClose, onRevoked }) as Confirm).props.onConfirm();
    expect(onClose).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onRevoked).toHaveBeenCalledOnce());
    expect(fetch.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "DELETE /api/builtin-browser/extension/ext-mac",
    ]);
    expect(toasts).toEqual([`success: ${S.browserSettings.revoked(MAC.name)}`]);
  });

  it("says why a refused revoke failed, and reloads nothing", async () => {
    stubFetch(() =>
      apiError(404, "not_found", "No Chrome with that id is paired to your account."),
    );
    const onRevoked = vi.fn();
    (RevokeConfirm({ record: MAC, onClose: () => {}, onRevoked }) as Confirm).props.onConfirm();
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0]).toMatch(/^error: /);
    expect(onRevoked).not.toHaveBeenCalled();
  });
});

describe("turning Chrome connections off server-wide", () => {
  const stored = (browserExtensionsEnabled: boolean): ServerSettings => ({
    proxyForApp: true,
    proxyForAgent: true,
    proxyUrl: null,
    attachmentMaxMb: 100,
    attachmentTotalMb: 120,
    companyMode: false,
    browserExtensionsEnabled,
    githubTokenSet: false,
  });

  it("asks first in the danger tone, saying every user's extension disconnects", () => {
    const confirm = ExtensionsOffConfirm({
      open: true,
      onClose: () => {},
      onWriting: () => {},
      onSettled: () => {},
    }) as Confirm;
    expect(confirm.props.tone).toBeUndefined();
    expect(confirm.props.title).toBe(S.browserSettings.offTitle);
    expect(confirm.props.confirmLabel).toBe(S.browserSettings.off);
    expect(renderToStaticMarkup(confirm.props.children as ReactElement)).toContain(
      S.browserSettings.offBody,
    );
  });

  it("writes the switch off once answered yes, and hands on what the server stored", async () => {
    const fetch = stubFetch(() => json({ settings: stored(false) }));
    const onWriting = vi.fn();
    const onSettled = vi.fn();
    (
      ExtensionsOffConfirm({ open: true, onClose: () => {}, onWriting, onSettled }) as Confirm
    ).props.onConfirm();
    expect(onWriting).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledExactlyOnceWith({ enabled: false }));
    expect(fetch.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["PUT", "/api/admin/settings", { browserExtensionsEnabled: false }],
    ]);
  });

  it("hands on a failed write as the failure", async () => {
    stubFetch(() => apiError(403, "forbidden"));
    const onSettled = vi.fn();
    (
      ExtensionsOffConfirm({
        open: true,
        onClose: () => {},
        onWriting: () => {},
        onSettled,
      }) as Confirm
    ).props.onConfirm();
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
    expect(onSettled.mock.calls[0]![0]).toHaveProperty("error");
  });
});
