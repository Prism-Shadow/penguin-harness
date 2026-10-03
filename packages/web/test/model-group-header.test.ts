/**
 * A provider group's header on the models page (group-header.ts, group-connection.tsx,
 * group-balance.tsx): which actions each kind of group offers, in the order they stand, the
 * connection of a group whose key comes from an authorization flow, and the balance's menu.
 *
 * - The matrix, per group kind: the balance where the catalog declares one (TokenDance, DeepSeek)
 *   and the group holds a key (or the environment lends one, or it is pinned); the connection on
 *   the three groups with a flow; Add model only where hand-added models are taken (custom,
 *   vLLM, OpenRouter, TokenDance, SiliconFlow, user-defined); Delete group only on a user-defined
 *   group; then the speed test and the group settings on every group, the settings last. No
 *   group offers a separate "Enter key": the group key is set in the settings (or by Connect).
 * - A member keeps the two read-only parts and nothing that writes.
 * - "Connected" is the GROUP holding a key: a key set on one model is that model's alone.
 * - Not connected, the owner's status is one button: it shows "Not connected" and pressing it
 *   starts the connect flow (once per press; never while the page is busy). Connected, one
 *   "Connected" menu with Sync models (Penguin Go only), Reconnect and Disconnect in the danger
 *   tone. A member reads the status as plain text, with nothing to press.
 * - The balance is one control whose menu is exactly three lines: pin to the bottom-left (or
 *   unpin), refresh, and — not a row to choose — when it was read, in local time; or, for a
 *   failed read, "Update failed" with the reason, the amount reading as a dash.
 * - Given Disconnect confirmed, one `PUT …/models/providers/:id` clears the group key and the
 *   table the server answers with is adopted, so the group reads "Not connected" without a
 *   reload; given the server refuses, nothing is adopted and the group stays connected.
 */
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelsResponse } from "@prismshadow/penguin-server/api";
import { MODEL_PROVIDERS, providerInfo } from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import {
  connectedMenuItems,
  connectionStatus,
  groupHeaderActions,
  groupKeyFromEnv,
  groupKeyStored,
  hasConnectFlow,
} from "../src/features/models/group-header";
import {
  ConnectionMenu,
  DisconnectConfirm,
  GroupConnection,
  NotConnectedButton,
} from "../src/features/models/group-connection";
import type { DisconnectHost } from "../src/features/models/group-connection";
import { BalanceMenu, balanceView } from "../src/features/models/group-balance";
import { userProviderInfo } from "../src/features/models/model-grouping";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";

const group = (id: string): ModelProviderInfo => providerInfo(id) ?? userProviderInfo(id);
const owner = (id: string, keyStored = false, balancePinned = false) =>
  groupHeaderActions(group(id), { isOwner: true, keyStored, balancePinned });
const member = (id: string, keyStored = false, balancePinned = false) =>
  groupHeaderActions(group(id), { isOwner: false, keyStored, balancePinned });

/** A group holding a key of its own, and one whose table has none. */
const keyedGroup = { apiKeyMasked: "sk-t…1234", createdAt: "2026-10-01T00:00:00.000Z" };
const keylessGroup = { baseUrl: "https://proxy.example/v1" };

/** What an element reads as: its static markup without the tags, entities decoded. */
function renderedText(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const noActions = { onConnect: () => {}, onSyncModels: () => {}, onDisconnect: () => {} };

describe("the group header's actions, in order, by group kind", () => {
  it("TokenDance: balance once a key is stored, the connection, Add model, speed test, settings", () => {
    expect(owner("tokendance", true)).toEqual([
      "balance",
      "connect",
      "addModel",
      "speedTest",
      "settings",
    ]);
    // Without a key there is nothing to ask the vendor with.
    expect(owner("tokendance", false)).toEqual(["connect", "addModel", "speedTest", "settings"]);
  });

  it("Penguin Go and ModelScope connect, keyed or not; the sync lives in the Connected menu", () => {
    for (const id of ["penguin-go", "modelscope"]) {
      for (const keyStored of [false, true]) {
        expect(owner(id, keyStored), `${id} keyStored=${keyStored}`).toEqual([
          "connect",
          "speedTest",
          "settings",
        ]);
      }
    }
  });

  it("DeepSeek shows its balance and connects nowhere; the other vendors and gateways test and configure", () => {
    expect(owner("deepseek", true)).toEqual(["balance", "speedTest", "settings"]);
    for (const id of ["fireworks", "opencode-go", "anthropic", "openai", "google", "minimax"]) {
      expect(owner(id, true), id).toEqual(["speedTest", "settings"]);
    }
  });

  it("OpenRouter, SiliconFlow, vLLM and custom take hand-added models; only a user-defined group deletes", () => {
    for (const id of ["openrouter", "siliconflow", "vllm", "custom"]) {
      expect(owner(id, true), id).toEqual(["addModel", "speedTest", "settings"]);
    }
    expect(owner("my-own-group")).toEqual(["addModel", "deleteGroup", "speedTest", "settings"]);
  });

  it("every group the owner sees ends on the speed test then the settings, and none offers a key field", () => {
    for (const id of [...MODEL_PROVIDERS.map((p) => p.id), "my-own-group"]) {
      for (const keyStored of [false, true]) {
        const actions = owner(id, keyStored);
        expect(actions.slice(-2), `${id} keyStored=${keyStored}`).toEqual([
          "speedTest",
          "settings",
        ]);
        expect(actions as string[], id).not.toContain("groupKey");
      }
    }
  });

  it("Add model appears on exactly the built-in groups that take hand-added models", () => {
    const adding = MODEL_PROVIDERS.filter((p) => owner(p.id, true).includes("addModel")).map(
      (p) => p.id,
    );
    expect(adding.sort()).toEqual(["custom", "openrouter", "siliconflow", "tokendance", "vllm"]);
  });

  it("a member keeps the balance and the connection status, and nothing that writes", () => {
    expect(member("tokendance", true)).toEqual(["balance", "connect"]);
    expect(member("penguin-go", true)).toEqual(["connect"]);
    expect(member("deepseek", true)).toEqual(["balance"]);
    expect(member("vllm")).toEqual([]);
    expect(member("custom")).toEqual([]);
    expect(member("my-own-group")).toEqual([]);
  });

  it("a pinned balance stays in its header after the key is gone, so the pin can come off there", () => {
    expect(owner("deepseek", false, true)).toEqual(["balance", "speedTest", "settings"]);
    // Only where the catalog declares a balance at all.
    expect(owner("openrouter", false, true)).toEqual(["addModel", "speedTest", "settings"]);
  });
});

describe("a key lent by the server's environment", () => {
  it("shows DeepSeek's balance, as a stored key does", () => {
    const facts = { isOwner: true, keyStored: false, keyFromEnv: true, balancePinned: false };
    expect(groupHeaderActions(group("deepseek"), facts)).toEqual([
      "balance",
      "speedTest",
      "settings",
    ]);
    expect(groupHeaderActions(group("deepseek"), { ...facts, isOwner: false })).toEqual([
      "balance",
    ]);
  });

  it("is read off the rows' masked preview, and does not make a group connected", () => {
    const envRows = [{ envKeyMasked: "sk-d…0003" }, {}];
    expect(groupKeyFromEnv(envRows)).toBe(true);
    expect(groupKeyFromEnv([{}, {}])).toBe(false);
    expect(groupKeyFromEnv([])).toBe(false);
    expect(connectionStatus(group("tokendance"), undefined)).toBe("notConnected");
  });
});

describe("the connection status", () => {
  it("is exactly the three groups with an authorization flow", () => {
    const connecting = MODEL_PROVIDERS.filter(hasConnectFlow).map((p) => p.id);
    expect(connecting).toEqual(["tokendance", "penguin-go", "modelscope"]);
  });

  it("reads connected once the group holds a key of its own, however it got there", () => {
    expect(groupKeyStored(keyedGroup)).toBe(true);
    expect(groupKeyStored(keylessGroup)).toBe(false);
    expect(groupKeyStored(undefined)).toBe(false);
    expect(connectionStatus(group("tokendance"), keyedGroup)).toBe("connected");
    // A group table with an endpoint but no key, or none at all: models keyed one by one do
    // not connect the group.
    expect(connectionStatus(group("penguin-go"), keylessGroup)).toBe("notConnected");
    expect(connectionStatus(group("modelscope"), undefined)).toBe("notConnected");
  });

  it("is absent on a group that does not connect", () => {
    expect(connectionStatus(group("deepseek"), keyedGroup)).toBeNull();
    expect(connectionStatus(group("my-own-group"), keyedGroup)).toBeNull();
  });
});

describe("the connection control", () => {
  const render = (id: string, connected: boolean, isOwner: boolean) =>
    renderToStaticMarkup(
      createElement(GroupConnection, {
        provider: group(id),
        connected,
        isOwner,
        busy: false,
        actions: noActions,
      }),
    );

  it("not connected: the owner's status is the one button, named for what it shows and does", () => {
    for (const id of ["tokendance", "penguin-go", "modelscope"]) {
      const html = render(id, false, true);
      expect(html.match(/<button/g), id).toHaveLength(1);
      expect(
        renderedText(
          createElement(GroupConnection, {
            provider: group(id),
            connected: false,
            isOwner: true,
            busy: false,
            actions: noActions,
          }),
        ),
        id,
      ).toBe(S.models.notConnectedStatus);
      const label = html.match(/aria-label="([^"]*)"/)?.[1] ?? "";
      expect(label.startsWith(S.models.notConnectedStatus), id).toBe(true);
      expect(label, id).toContain(`${S.models.oauthKey} ${group(id).label}`);
      expect(html, id).not.toContain('aria-haspopup="menu"');
    }
  });

  it("pressing Not connected starts the connect flow once, and a busy page waits", () => {
    const onConnect = vi.fn();
    const press = (busy: boolean) => {
      const button = NotConnectedButton({ provider: group("modelscope"), busy, onConnect });
      return button as ReactElement<{ onClick: () => void; disabled: boolean }>;
    };
    press(false).props.onClick();
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(press(false).props.disabled).toBe(false);
    expect(press(true).props.disabled).toBe(true);
  });

  it("connected: the owner gets one Connected trigger that opens a menu, and no Connect button", () => {
    const html = render("penguin-go", true, true);
    expect(html).toContain(`aria-label="${S.models.connectedStatus} Penguin Go"`);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain(S.models.notConnectedStatus);
  });

  it("a member reads the status as plain text, connected or not, with nothing to press", () => {
    for (const connected of [true, false]) {
      const html = render("tokendance", connected, false);
      expect(html).toContain(connected ? S.models.connectedStatus : S.models.notConnectedStatus);
      expect(html).not.toContain("<button");
    }
  });

  it("the Connected menu offers Sync models on Penguin Go only, then Reconnect and Disconnect", () => {
    expect(connectedMenuItems(group("penguin-go"))).toEqual([
      "syncModels",
      "reconnect",
      "disconnect",
    ]);
    for (const id of ["tokendance", "modelscope"]) {
      expect(connectedMenuItems(group(id)), id).toEqual(["reconnect", "disconnect"]);
    }
    const menu = renderedText(
      createElement(ConnectionMenu, { provider: group("penguin-go"), onSelect: () => {} }),
    );
    expect(menu).toBe(`${S.models.syncModels} ${S.models.reconnect} ${S.models.disconnect}`);
  });

  it("Disconnect is the menu's one row in the danger tone", () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionMenu, { provider: group("tokendance"), onSelect: () => {} }),
    );
    const rows = html.split("<button").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain("tone-danger");
    expect(rows[1]).toContain("tone-danger");
    expect(rows[1]).toContain(S.models.disconnect);
  });
});

describe("the balance menu", () => {
  const reading = {
    ok: true as const,
    provider: "deepseek",
    amount: "110.00",
    currency: "CNY",
    fetchedAt: "2026-09-30T06:05:00.000Z",
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The menu's elements that can be chosen, in order, as the menu holds them (not rendered). */
  function rows(node: ReactNode): { label: string; onSelect: () => void }[] {
    if (!isValidElement(node)) {
      return Array.isArray(node) ? node.flatMap(rows) : [];
    }
    const props = node.props as { label?: string; onSelect?: () => void; children?: ReactNode };
    if (typeof props.onSelect === "function" && typeof props.label === "string") {
      return [{ label: props.label, onSelect: props.onSelect }];
    }
    return rows(props.children);
  }

  const menu = (pinned: boolean, updated: string, onPin = () => {}, onRefresh = () => {}) =>
    createElement(BalanceMenu, { pinned, updated, onPin, onRefresh });

  it("holds exactly three lines: pin, refresh, and when it was read, which is not a row", () => {
    const view = balanceView({ loading: false, answer: reading }, "DeepSeek", "CNY");
    const html = renderToStaticMarkup(menu(false, view.updated));
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(renderedText(menu(false, view.updated))).toBe(
      `${S.models.pinBalance} ${S.models.balanceRefresh} ${view.updated}`,
    );
    // The last line sits after the menu, outside its role.
    const [, after] = html.split("</div>");
    expect(after).toContain(view.updated);
    // The vendor's own figures are not repeated there.
    expect(view.updated).not.toContain("¥110.00");
  });

  it("pins an unpinned balance, unpins a pinned one, and refreshes from the second row", () => {
    const onPin = vi.fn();
    const onRefresh = vi.fn();
    const unpinned = rows(BalanceMenu({ pinned: false, updated: "", onPin, onRefresh }));
    expect(unpinned.map((r) => r.label)).toEqual([S.models.pinBalance, S.models.balanceRefresh]);
    unpinned[0]!.onSelect();
    expect(onPin).toHaveBeenCalledTimes(1);
    unpinned[1]!.onSelect();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    const pinned = rows(BalanceMenu({ pinned: true, updated: "", onPin, onRefresh }));
    expect(pinned.map((r) => r.label)).toEqual([S.models.unpinBalance, S.models.balanceRefresh]);
  });

  it("dates the reading in local time, to the minute", () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    const shanghai = balanceView({ loading: false, answer: reading }, "DeepSeek", "CNY");
    expect(shanghai.updated).toContain("2026-09-30 14:05");
    vi.stubEnv("TZ", "America/Los_Angeles");
    const pacific = balanceView({ loading: false, answer: reading }, "DeepSeek", "CNY");
    expect(pacific.updated).toContain("2026-09-29 23:05");
  });

  it("a failed read reads as a dash, and its last line says the update failed and why", () => {
    const view = balanceView(
      {
        loading: false,
        answer: {
          ok: false,
          provider: "tokendance",
          error: "upstream_failed",
          status: 401,
          message: "TokenDance answered the balance request with HTTP 401.",
          fetchedAt: reading.fetchedAt,
        },
      },
      "TokenDance",
      "CNY",
    );
    expect(view.text).toBe("—");
    expect(view.updated.startsWith(S.models.balanceFailed(""))).toBe(true);
    expect(view.updated).toContain(S.models.balanceErrors.upstream_failed!);
    expect(view.updated).toContain("401");
    expect(renderedText(menu(true, view.updated))).toBe(
      `${S.models.unpinBalance} ${S.models.balanceRefresh} ${view.updated}`,
    );
    // A request that never reached the server fails the same way, with its own reason.
    const offline = balanceView(
      { loading: false, requestError: "Network error" },
      "TokenDance",
      "CNY",
    );
    expect(offline.text).toBe("—");
    expect(offline.updated.startsWith(S.models.balanceFailed(""))).toBe(true);
    expect(offline.updated).toContain("Network error");
  });
});

describe("Disconnect", () => {
  /** The table the server answers a cleared key with: the group keeps its endpoint, loses its key. */
  const CLEARED: ModelsResponse = {
    providers: { tokendance: { baseUrl: "https://tokendance.space/gateway/v1" } },
    models: [],
  };

  /** The page's side, recorded; `closed` resolves when the confirmation closes. */
  function page(): DisconnectHost & {
    adopted: ModelsResponse[];
    busy: boolean[];
    closed: Promise<void>;
    close: () => void;
  } {
    let close!: () => void;
    const closed = new Promise<void>((resolve) => (close = resolve));
    const adopted: ModelsResponse[] = [];
    const busy: boolean[] = [];
    return {
      projectId: "p1",
      adopted,
      busy,
      closed,
      close,
      adopt: (res) => adopted.push(res),
      setBusy: (on) => busy.push(on),
    };
  }

  const confirm = (host: ReturnType<typeof page>) =>
    DisconnectConfirm({
      host,
      provider: group("tokendance"),
      busy: false,
      onClose: host.close,
    }) as ReactElement<{ onConfirm: () => void }>;

  it("clears the group key and reads Not connected from the server's answer", async () => {
    const fetch = stubFetch(() => json(CLEARED));
    const host = page();
    expect(connectionStatus(group("tokendance"), keyedGroup)).toBe("connected");
    confirm(host).props.onConfirm();
    await host.closed;

    expect(fetch.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["PUT", "/api/projects/p1/models/providers/tokendance", { clearApiKey: true }],
    ]);
    expect(host.adopted).toEqual([CLEARED]);
    expect(connectionStatus(group("tokendance"), host.adopted[0]!.providers.tokendance)).toBe(
      "notConnected",
    );
    expect(host.busy).toEqual([true, false]);
  });

  it("a refused clear adopts nothing, so the group stays connected, and the dialog still closes", async () => {
    stubFetch(() => apiError(403, "forbidden"));
    const host = page();
    confirm(host).props.onConfirm();
    await host.closed;

    expect(host.adopted).toEqual([]);
    expect(host.busy).toEqual([true, false]);
  });

  it("names the group and what it deletes before anything is sent", () => {
    const fetch = stubFetch();
    const body = renderedText(
      (confirm(page()).props as unknown as { children: ReactElement }).children,
    );
    expect(body).toContain("TokenDance");
    expect(fetch.requests).toEqual([]);
  });
});
