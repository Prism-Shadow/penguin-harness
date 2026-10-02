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
 * - A member keeps the two read-only parts and nothing that writes. A divider follows the balance
 *   wherever something comes after it.
 * - "Connected" is the GROUP holding a key: a key set on one model is that model's alone.
 * - Not connected, the owner gets the status and Connect; connected, one "Connected" menu with
 *   Sync models (Penguin Go only), Reconnect and Disconnect in the danger tone. A member reads
 *   the status as plain text, with no menu and no Connect.
 * - The balance is one control: its menu pins (or unpins) it beside the user name and refreshes
 *   it, over a line with the vendor's figures and the read time — or, for a failed read, the
 *   reason, with a dash as the amount.
 * - Given Disconnect confirmed, one `PUT …/models/providers/:id` clears the group key and the
 *   table the server answers with is adopted, so the group reads "Not connected" without a
 *   reload; given the server refuses, nothing is adopted and the group stays connected.
 */
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModelsResponse } from "@prismshadow/penguin-server/api";
import { MODEL_PROVIDERS, providerInfo } from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import {
  connectedMenuItems,
  connectionStatus,
  dividerAfterBalance,
  groupHeaderActions,
  groupKeyFromEnv,
  groupKeyStored,
  hasConnectFlow,
} from "../src/features/models/group-header";
import {
  ConnectionMenu,
  DisconnectConfirm,
  GroupConnection,
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

  it("not connected: the owner reads the status and gets Connect", () => {
    const html = render("tokendance", false, true);
    expect(html).toContain(S.models.notConnectedStatus);
    expect(html).toContain(`aria-label="${S.models.oauthKey} TokenDance"`);
    expect(html).not.toContain('aria-haspopup="menu"');
  });

  it("connected: the owner gets one Connected trigger that opens a menu, and no Connect button", () => {
    const html = render("penguin-go", true, true);
    expect(html).toContain(`aria-label="${S.models.connectedStatus} Penguin Go"`);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain(`aria-label="${S.models.oauthKey} Penguin Go"`);
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

  it("pins an unpinned balance, unpins a pinned one, and always offers a refresh", () => {
    const menu = (pinned: boolean) =>
      renderedText(
        createElement(BalanceMenu, { pinned, info: "", onPin: () => {}, onRefresh: () => {} }),
      );
    expect(menu(false)).toBe(`${S.models.pinBalance} ${S.models.balanceRefresh}`);
    expect(menu(true)).toBe(`${S.models.unpinBalance} ${S.models.balanceRefresh}`);
  });

  it("carries the vendor's figures and the read time on a line that is not a row", () => {
    const view = balanceView({ loading: false, answer: reading }, "DeepSeek", "CNY");
    const html = renderToStaticMarkup(
      createElement(BalanceMenu, {
        pinned: false,
        info: view.title,
        onPin: () => {},
        onRefresh: () => {},
      }),
    );
    // Two rows to choose, and the information line outside the menu role.
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    const [, after] = html.split("</div>");
    expect(after).toContain("¥110.00");
    expect(after).toContain("DeepSeek");
  });

  it("a failed read shows a dash as the amount and the reason on the menu's line", () => {
    const view = balanceView(
      {
        loading: false,
        answer: {
          ok: false,
          provider: "tokendance",
          error: "no_key",
          message: "The TokenDance group stores no API key.",
          fetchedAt: reading.fetchedAt,
        },
      },
      "TokenDance",
      "CNY",
    );
    expect(view.text).toBe("—");
    const text = renderedText(
      createElement(BalanceMenu, {
        pinned: true,
        info: view.title,
        onPin: () => {},
        onRefresh: () => {},
      }),
    );
    expect(text).toContain(S.models.balanceErrors.no_key!);
  });
});

describe("the divider after the balance", () => {
  it("stands between the balance and whatever follows it", () => {
    expect(dividerAfterBalance(owner("tokendance", true))).toBe(true);
    expect(dividerAfterBalance(owner("deepseek", true))).toBe(true);
    // A member of TokenDance: the balance, then the connection status.
    expect(dividerAfterBalance(member("tokendance", true))).toBe(true);
  });

  it("is left out where it would separate nothing", () => {
    // A member of DeepSeek sees the balance alone.
    expect(dividerAfterBalance(member("deepseek", true))).toBe(false);
    // No balance to lead: no key stored, or a group without one.
    expect(dividerAfterBalance(owner("tokendance", false))).toBe(false);
    expect(dividerAfterBalance(owner("openai", true))).toBe(false);
    expect(dividerAfterBalance([])).toBe(false);
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
