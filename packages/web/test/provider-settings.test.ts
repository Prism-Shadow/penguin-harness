/**
 * A group's settings (provider-settings-dialog.tsx) and the inheritance a group's models read
 * off it (connection.ts). The file is the only source: a group's models follow its
 * `[providers.<id>]` table and nothing else, and the catalog is a reference shown beside it.
 *
 * - Given the dialog opened on a group's stored connection and saved untouched, nothing is sent;
 *   given one field changed, exactly that field is sent — a cleared base URL or protocol as
 *   `null`, a key only when typed, the clear box only on a stored key.
 * - Every group takes a protocol, Penguin Go and OpenCode Go included: their rows store their
 *   own, which a group protocol never overrides.
 * - Given Detect, the probe names the group and never a model (so the server backs it with the
 *   GROUP key), on the URL in the field or — left blank — the one the group stores; with neither
 *   there is nothing to probe, and the catalog's endpoint is never probed in their place.
 * - Given Save, the endpoint is probed only when nothing decides the protocol: a custom or
 *   user-defined group given a base URL, left on "Not set", with no model storing its own. A
 *   protocol picked, a model's own protocol (Atria's, in custom) and a built-in group never
 *   trigger it.
 * - Given a custom or user-defined group with a model that stores no base URL, a blank group base
 *   URL is refused; a built-in group never refuses one.
 * - Where the catalog gives the group an endpoint or protocol the field does not hold (blank
 *   included), a "Catalog: …" line names it; where the field matches, or the catalog has
 *   nothing for the group, there is no line.
 * - A blank group key promises an environment variable only where it may be sent there.
 * - A model with nothing of its own follows the group's table field by field, and a field the
 *   table leaves blank is the client's default — never the catalog's value.
 * - A group key reaches a model with no base URL of its own or one on the group's origin; a
 *   model on another origin (Atria in custom, one re-pointed at a proxy) gets none.
 * - The dialog counts the models that store a base URL, key or protocol of their own.
 * - Given a group protocol stored outside the picker's three (set from the CLI), the picker
 *   shows that protocol, never "Not set", and saving untouched leaves it as it is.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { catalogEntryFor, presetProviderTable } from "@prismshadow/penguin-core/model-catalog";
import type { ProviderConnectionDto } from "@prismshadow/penguin-server/api";
import {
  applyProviderUpdate,
  groupKeyMissesRow,
  inheritedConnection,
  rowKey,
  rowsWithOwnConnection,
} from "../src/features/models/connection";
import {
  catalogHint,
  groupEnvKey,
  initialDraft,
  protocolChoice,
  providerBaseUrlMissing,
  providerDetectOnSave,
  providerDetectRequest,
  providerSettingsUpdate,
} from "../src/features/models/provider-settings-dialog";
import { ProtocolSuffixMenu } from "../src/features/models/protocol-suffix";
import { S } from "../src/lib/strings";

/** The table a new Project writes for a built-in group, as GET /models reports it. */
function presetGroup(id: string): ProviderConnectionDto {
  const table = presetProviderTable()[id] ?? {};
  return {
    ...(table.base_url !== undefined ? { baseUrl: table.base_url } : {}),
    ...(table.client_type !== undefined ? { clientType: table.client_type } : {}),
  };
}

const STORED = {
  baseUrl: "https://proxy.example/v1",
  clientType: "openai-chat",
  apiKeyMasked: "sk-g…2222",
  createdAt: "2026-10-01T00:00:00.000Z",
};

/** A model as the dialog reads it: what it stores of its own. */
const row = (own: { clientType?: string; baseUrl?: string; key?: boolean } = {}) => ({
  clientType: own.clientType ?? "",
  originalBaseUrl: own.baseUrl ?? "",
  ...(own.key ? { credential: { apiKeyMasked: "sk-o…1111" } } : {}),
});

/** Custom's catalog preset as a new Project stores it: its own endpoint and protocol on the row. */
const ATRIA = catalogEntryFor("custom", "Atria-Dawn-Preview")!;
const atriaRow = row({ baseUrl: ATRIA.baseUrl, clientType: ATRIA.clientType });

describe("saving the group settings sends what changed, and only that", () => {
  it("sends nothing for an untouched form", () => {
    expect(providerSettingsUpdate(STORED, initialDraft(STORED))).toBeNull();
    expect(providerSettingsUpdate(undefined, initialDraft(undefined))).toBeNull();
  });

  it("sends an edited field alone, and a cleared one as null", () => {
    const draft = initialDraft(STORED);
    expect(providerSettingsUpdate(STORED, { ...draft, baseUrl: " https://b.example " })).toEqual({
      baseUrl: "https://b.example",
    });
    expect(providerSettingsUpdate(STORED, { ...draft, baseUrl: "" })).toEqual({ baseUrl: null });
    expect(providerSettingsUpdate(STORED, { ...draft, clientType: "ant-messages" })).toEqual({
      clientType: "ant-messages",
    });
    // Back to "Not set": the group sets none.
    expect(providerSettingsUpdate(STORED, { ...draft, clientType: null })).toEqual({
      clientType: null,
    });
  });

  it("sends a key only when one is typed, and the clear box only for a stored key", () => {
    const draft = initialDraft(STORED);
    expect(providerSettingsUpdate(STORED, { ...draft, apiKey: " sk-new " })).toEqual({
      apiKey: "sk-new",
    });
    expect(providerSettingsUpdate(STORED, { ...draft, clearApiKey: true })).toEqual({
      clearApiKey: true,
    });
    // A typed key wins over the box; a group with no key has nothing to clear.
    expect(
      providerSettingsUpdate(STORED, { ...draft, apiKey: "sk-new", clearApiKey: true }),
    ).toEqual({ apiKey: "sk-new" });
    expect(
      providerSettingsUpdate(undefined, { ...initialDraft(undefined), clearApiKey: true }),
    ).toBeNull();
  });

  it("sends a protocol for Penguin Go and OpenCode Go like any group", () => {
    for (const id of ["penguin-go", "opencode-go"]) {
      const group = presetGroup(id);
      const draft = { ...initialDraft(group), clientType: "openai-chat" };
      expect(providerSettingsUpdate(group, draft), id).toEqual({ clientType: "openai-chat" });
    }
  });
});

describe("Detect in the group settings", () => {
  const blank = { apiKey: "", clearApiKey: false, baseUrl: "" };

  it("probes on behalf of the group, never a model, so the group key backs it", () => {
    const body = providerDetectRequest("my-group", undefined, {
      ...blank,
      baseUrl: "http://10.0.0.5:8000/v1",
    });
    expect(body).toEqual({ baseUrl: "http://10.0.0.5:8000/v1", provider: "my-group" });
    expect(body).not.toHaveProperty("modelId");
    // A key typed in the dialog is tried instead; a ticked clear box tries none.
    expect(
      providerDetectRequest("my-group", undefined, {
        ...blank,
        baseUrl: "http://h/v1",
        apiKey: " sk-t ",
      }),
    ).toMatchObject({ apiKey: "sk-t" });
    expect(
      providerDetectRequest("my-group", undefined, {
        ...blank,
        baseUrl: "http://h/v1",
        clearApiKey: true,
      }),
    ).toMatchObject({ clearApiKey: true });
  });

  it("probes the field's URL, else the group's, and never the catalog's", () => {
    const stored = { baseUrl: "https://proxy.example/or/v1" };
    expect(
      providerDetectRequest("openrouter", stored, { ...blank, baseUrl: "https://b.example/v1" }),
    ).toMatchObject({ baseUrl: "https://b.example/v1" });
    expect(providerDetectRequest("openrouter", stored, blank)).toMatchObject({
      baseUrl: stored.baseUrl,
    });
    // A gateway whose table was cleared has nothing to probe, though the catalog names one.
    expect(providerDetectRequest("openrouter", undefined, blank)).toBeNull();
    expect(
      providerDetectRequest("custom", undefined, { ...blank, baseUrl: "not a url" }),
    ).toBeNull();
  });
});

describe("Save asks the endpoint only when nothing decides the protocol", () => {
  const typed = { baseUrl: "http://10.0.0.5:8000/v1", clientType: null };

  it("detects on a custom-like group with a base URL, on Not set, with no model protocol", () => {
    expect(providerDetectOnSave("my-group", [row(), row()], typed)).toBe(true);
    expect(providerDetectOnSave("custom", [], typed)).toBe(true);
  });

  it("does not detect when a protocol is picked, a model stores one, or the group is built-in", () => {
    expect(providerDetectOnSave("my-group", [row()], { ...typed, clientType: "openai-chat" })).toBe(
      false,
    );
    expect(
      providerDetectOnSave("my-group", [row(), row({ clientType: "ant-messages" })], typed),
    ).toBe(false);
    // Custom holding Atria: its row stores a protocol, which settles it.
    expect(providerDetectOnSave("custom", [atriaRow], typed)).toBe(false);
    for (const id of ["vllm", "openrouter", "deepseek"]) {
      expect(providerDetectOnSave(id, [row()], typed), id).toBe(false);
    }
    expect(providerDetectOnSave("my-group", [row()], { ...typed, baseUrl: " " })).toBe(false);
  });
});

describe("a blank group base URL", () => {
  it("is refused on a custom-like group while some model stores no base URL", () => {
    expect(
      providerBaseUrlMissing("my-group", [row({ baseUrl: "http://a/v1" }), row()], { baseUrl: "" }),
    ).toBe(true);
    expect(
      providerBaseUrlMissing("my-group", [row({ baseUrl: "http://a/v1" })], { baseUrl: "" }),
    ).toBe(false);
    expect(providerBaseUrlMissing("my-group", [row()], { baseUrl: "http://b/v1" })).toBe(false);
    // An empty custom group, or custom holding only Atria (which stores its own endpoint).
    expect(providerBaseUrlMissing("custom", [], { baseUrl: "" })).toBe(false);
    expect(providerBaseUrlMissing("custom", [atriaRow], { baseUrl: "" })).toBe(false);
  });

  it("is never refused on a built-in group", () => {
    expect(providerBaseUrlMissing("vllm", [row()], { baseUrl: "" })).toBe(false);
    expect(providerBaseUrlMissing("openrouter", [row()], { baseUrl: "" })).toBe(false);
  });
});

describe("the catalog as a reference beside the fields", () => {
  it("says nothing while the fields hold the catalog's values", () => {
    for (const id of ["openrouter", "tokendance", "penguin-go", "vllm"]) {
      expect(catalogHint(id, initialDraft(presetGroup(id))), id).toEqual({});
    }
  });

  it("names the catalog's endpoint and protocol where the field differs, blank included", () => {
    const openrouter = presetGroup("openrouter");
    expect(catalogHint("openrouter", { baseUrl: "", clientType: null })).toEqual({
      baseUrl: openrouter.baseUrl,
      clientType: openrouter.clientType,
    });
    expect(
      catalogHint("openrouter", { baseUrl: "https://proxy.example/v1", clientType: "openai-chat" }),
    ).toEqual({ baseUrl: openrouter.baseUrl, clientType: openrouter.clientType });
    // Penguin Go's catalog names the relay but no group protocol (its rows pin their own).
    expect(catalogHint("penguin-go", { baseUrl: "", clientType: "openai-chat" })).toEqual({
      baseUrl: presetGroup("penguin-go").baseUrl,
    });
  });

  it("has nothing to say for a group the catalog gives no connection", () => {
    for (const id of ["deepseek", "anthropic", "custom", "my-group"]) {
      expect(
        catalogHint(id, { baseUrl: "https://proxy.example/v1", clientType: null }),
        id,
      ).toEqual({});
    }
  });
});

describe("a blank group key and the environment", () => {
  const detected = new Set(["DEEPSEEK_API_KEY"]);
  const blank = { baseUrl: "", clientType: null };

  it("promises the vendor's variable on its own endpoint, where the server proved it is set", () => {
    expect(groupEnvKey("deepseek", blank, detected)).toBe("DEEPSEEK_API_KEY");
    expect(
      groupEnvKey("deepseek", { ...blank, baseUrl: "https://api.deepseek.com/" }, detected),
    ).toBe("DEEPSEEK_API_KEY");
  });

  it("promises nothing for a proxy, an unset variable or a gateway", () => {
    expect(
      groupEnvKey("deepseek", { ...blank, baseUrl: "https://proxy.example/v1" }, detected),
    ).toBeUndefined();
    expect(groupEnvKey("deepseek", blank, new Set())).toBeUndefined();
    expect(groupEnvKey("openrouter", blank, new Set(["OPENAI_API_KEY"]))).toBeUndefined();
  });
});

describe("what a group's models inherit", () => {
  it("a blank field follows the group's table, and nothing where the table is blank", () => {
    const followed = inheritedConnection("openrouter", "x-ai/grok-5", presetGroup("openrouter"));
    expect(followed).toMatchObject({
      baseUrl: presetGroup("openrouter").baseUrl,
      baseUrlSource: "provider",
      clientTypeSource: "provider",
    });
    // The group leaves its protocol blank: the model is routed by its id, not given the
    // catalog's protocol.
    const partial = inheritedConnection("openrouter", "x-ai/grok-5", {
      baseUrl: "https://proxy.example/or/v1",
    });
    expect(partial.baseUrl).toBe("https://proxy.example/or/v1");
    expect(partial.clientType).toBeUndefined();
    expect(partial.clientTypeSource).toBe("none");
    // No table at all: every field is the client's default.
    expect(inheritedConnection("openrouter", "x-ai/grok-5", undefined)).toEqual({
      baseUrlSource: "none",
      clientTypeSource: "none",
      apiKeySource: "none",
    });
  });

  it("reads the group as a pending update will leave it", () => {
    const next = applyProviderUpdate(STORED, { baseUrl: null, clientType: "ant-messages" });
    expect(next.baseUrl).toBeUndefined();
    expect(next.clientType).toBe("ant-messages");
    expect(next.apiKeyMasked).toBe(STORED.apiKeyMasked);
    expect(applyProviderUpdate(STORED, { clearApiKey: true }).apiKeyMasked).toBeUndefined();
    expect(applyProviderUpdate(undefined, { apiKey: "sk-n" }).apiKeyMasked).toBeDefined();
  });

  it("counts the models that store a field of their own, once each, Atria included", () => {
    const rows = [
      row(),
      row({ key: true }),
      row({ baseUrl: "http://a/v1", clientType: "openai-chat", key: true }),
    ];
    expect(rowsWithOwnConnection(rows)).toBe(2);
    expect(rowsWithOwnConnection([row(), row()])).toBe(0);
    expect(rowsWithOwnConnection([row(), atriaRow])).toBe(1);
  });
});

describe("a group key follows its endpoint", () => {
  const OLLAMA = {
    baseUrl: "http://127.0.0.1:11434/v1",
    clientType: "openai-chat",
    apiKeyMasked: "sk-o…3333",
  };
  const keyless = { apiKeyInput: "", clearApiKey: false };

  it("reaches a model with no base URL of its own, in every field", () => {
    expect(inheritedConnection("custom", "qwen3.8-27b-local", OLLAMA)).toMatchObject({
      baseUrl: OLLAMA.baseUrl,
      clientType: OLLAMA.clientType,
      apiKeySource: "provider",
    });
    expect(
      rowKey({ ...keyless, provider: "custom", modelId: "qwen3.8-27b-local" }, OLLAMA),
    ).toEqual({ source: "provider", masked: OLLAMA.apiKeyMasked });
  });

  it("does not reach Atria, which stores its own host, nor a model re-pointed at a proxy", () => {
    const atria = {
      ...keyless,
      provider: "custom",
      modelId: ATRIA.modelId,
      baseUrl: ATRIA.baseUrl,
    };
    expect(rowKey(atria, OLLAMA)).toEqual({ source: "none" });
    expect(groupKeyMissesRow(ATRIA.baseUrl!, OLLAMA)).toBe(true);
    const openrouter = { ...presetGroup("openrouter"), apiKeyMasked: "sk-or…4444" };
    const proxied = {
      ...keyless,
      provider: "openrouter",
      modelId: "x-ai/grok-5",
      baseUrl: "https://proxy.example/v1",
    };
    expect(rowKey(proxied, openrouter)).toEqual({ source: "none" });
    expect(groupKeyMissesRow(proxied.baseUrl, openrouter)).toBe(true);
  });

  it("reaches a model on another path of the group's origin (OpenCode Go's Messages rows)", () => {
    const opencode = { ...presetGroup("opencode-go"), apiKeyMasked: "sk-oc…5555" };
    const messages = new URL(opencode.baseUrl!);
    messages.pathname = "/zen/go";
    const row = {
      ...keyless,
      provider: "opencode-go",
      modelId: "claude-sonnet-4.6",
      baseUrl: messages.toString(),
    };
    expect(rowKey(row, opencode)).toEqual({ source: "provider", masked: opencode.apiKeyMasked });
    expect(groupKeyMissesRow(row.baseUrl, opencode)).toBe(false);
  });

  it("leaves nothing to miss where the group holds no key", () => {
    expect(groupKeyMissesRow("https://proxy.example/v1", { baseUrl: OLLAMA.baseUrl })).toBe(false);
  });
});

describe("a group protocol outside the picker's three", () => {
  // vLLM's own adapter, which a new Project writes on its group: a protocol the picker does not list.
  const STORED_ADAPTER = { clientType: "openai-chat-vllm-adapter" };

  it("is what the picker shows checked, never Not set", () => {
    const choice = protocolChoice(initialDraft(STORED_ADAPTER));
    expect(choice).toBe("openai-chat-vllm-adapter");
    const html = renderToStaticMarkup(
      createElement(ProtocolSuffixMenu, {
        value: choice,
        path: "/chat/completions",
        detecting: false,
        tone: null,
        follow: { label: S.models.protocolNone, onPick: () => {} },
        onPick: () => {},
      }),
    );
    expect(html).toContain(`aria-label="${S.models.protocol}: openai-chat-vllm-adapter"`);
    expect(html).not.toContain(`aria-label="${S.models.protocol}: ${S.models.protocolNone}"`);
    // The group's own pick from the three and an unset group read as before.
    expect(protocolChoice(initialDraft({ clientType: "openai" }))).toBe("openai-chat");
    expect(protocolChoice(initialDraft(undefined))).toBeNull();
  });

  it("is left as it is by a save that does not pick another", () => {
    const draft = initialDraft(STORED_ADAPTER);
    expect(providerSettingsUpdate(STORED_ADAPTER, draft)).toBeNull();
    expect(
      providerSettingsUpdate(STORED_ADAPTER, { ...draft, baseUrl: "http://gpu:8000/v1" }),
    ).toEqual({ baseUrl: "http://gpu:8000/v1" });
    expect(providerSettingsUpdate(STORED_ADAPTER, { ...draft, clientType: "openai-chat" })).toEqual(
      { clientType: "openai-chat" },
    );
  });
});
