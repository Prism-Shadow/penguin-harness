// @vitest-environment jsdom
/**
 * Penguin Go uses the shared balance controls, against the real browser API wrappers.
 *
 * - Given a group header, mounting reads once; time alone never refreshes it, while the
 *   menu's refresh forces a new read. Pinning reads once and refreshes every five minutes,
 *   updating both copies; unpinning stops polling, and the account preference is written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { providerInfo } from "@prismshadow/penguin-server/model-catalog";
import { GroupBalance, PinnedBalanceBadge } from "../src/features/models/group-balance";
import { ProjectProvider } from "../src/state/project";
import { ThemeProvider } from "../src/state/theme";
import { en } from "../src/lib/strings-en";
import { setActiveStrings, zh } from "../src/lib/strings";
import { noteLocalShown } from "../src/lib/local-first";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { button, click, mount, unmountAll, waitFor } from "./helpers/dom";

describe("Penguin Go balance refresh", () => {
  beforeEach(() => {
    // The window's own content is on screen: the balance is a remote read that waits for it.
    noteLocalShown();
    setActiveStrings(en);
    localStorage.clear();
    localStorage.setItem("penguin.currency", "CNY");
    vi.stubGlobal("matchMedia", (media: string) => ({
      media,
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(async () => {
    await unmountAll();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setActiveStrings(zh);
  });

  it("reads on mount and manual refresh, and polls only while pinned every five minutes", async () => {
    let reads = 0;
    const server = stubFetch((request) => {
      if (request.path === "/api/me/prefs") return json({ prefs: {} });
      if (request.path === "/api/projects")
        return json({ projects: [{ projectId: "go-refresh", role: "owner" }] });
      if (request.path.endsWith("/agents")) return json({ agents: [] });
      if (request.path.endsWith("/models/balance")) {
        reads++;
        return json({
          ok: true,
          provider: "penguin-go",
          amount: String(reads * 7),
          currency: "CNY",
          fetchedAt: "2026-10-13T00:00:00Z",
        });
      }
      return apiError(404, "not_found");
    });
    const balances = () => server.requests.filter((r) => r.path.endsWith("/models/balance"));
    await mount(
      h(
        ThemeProvider,
        null,
        h(
          ProjectProvider,
          null,
          h(GroupBalance, { projectId: "go-refresh", provider: providerInfo("penguin-go")! }),
          h(PinnedBalanceBadge),
        ),
      ),
    );
    await waitFor(() => document.body.textContent?.includes("¥7") === true);
    expect(balances()).toHaveLength(1);
    expect(balances()[0]!.query.get("provider")).toBe("penguin-go");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(balances()).toHaveLength(1);

    const openMenu = () => click(document.querySelector('button[aria-haspopup="menu"]')!);
    await openMenu();
    await click(button(en.models.balanceRefresh));
    await waitFor(() => reads === 2);
    expect(balances()[1]!.query.get("force")).toBe("1");
    await openMenu();
    await click(button(en.models.pinBalance));
    await waitFor(() => reads === 3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299_999);
    });
    expect(reads).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await waitFor(() => reads === 4);
    const amounts = [
      ...document.querySelectorAll("button[aria-haspopup='menu'], span.tabular-nums"),
    ].map((element) =>
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join("")
        .trim(),
    );
    expect(amounts).toEqual(["¥28.00", "¥28.00"]);

    await openMenu();
    await click(button(en.models.unpinBalance));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    expect(reads).toBe(4);
    const pins = server.requests.filter((r) => r.path === "/api/me/prefs" && r.method === "PUT");
    expect(pins.map((r) => r.body)).toEqual([
      { pinnedBalance: { projectId: "go-refresh", provider: "penguin-go" } },
      { pinnedBalance: null },
    ]);
  });
});
