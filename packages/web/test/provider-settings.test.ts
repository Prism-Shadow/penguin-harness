/**
 * A group's settings (provider-settings-dialog.tsx) and the inheritance a group's models read
 * off it (connection.ts). The file is the only source: a group's models follow its
 * `[providers.<id>]` table and nothing else, and the catalog only seeds a new Project's file.
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
 *   user-defined group given a base URL, left on "Not set", with a model that stores no protocol
 *   of its own (or no model yet). A protocol picked, every model storing its own (Atria alone, in
 *   custom) and a built-in group never trigger it.
 * - Given a custom or user-defined group with a model that stores no base URL, a blank group base
 *   URL is refused; a built-in group never refuses one.
 * - Given Save on a base URL that is not an absolute http(s) URL, the field says why and nothing
 *   is sent. Given a group with one model lacking its own protocol, the endpoint is probed and the
 *   protocol found is saved; given every model storing its own, only the changed fields go out.
 *   Given the dialog dismissed while the probe is in flight, nothing is written.
 * - Given a group whose file values differ from the catalog's, and models that carry values of
 *   their own, the dialog shows the file's values and says nothing else: no catalog value, no
 *   line under the fields, no count of the models' own values.
 * - Given a group whose catalog names a model list (OpenRouter, TokenDance), the dialog links
 *   to it in a new tab; custom and a user-defined group have none, and no link.
 * - A blank group key promises an environment variable only where it may be sent there.
 * - A model with nothing of its own follows the group's table field by field, and a field the
 *   table leaves blank is the client's default — never the catalog's value.
 * - A group key reaches a model with no base URL of its own or one on the group's origin; a
 *   model on another origin (Atria in custom, one re-pointed at a proxy) gets none.
 * - Given a group protocol stored as one of the picker's five (an older spelling included), the
 *   picker shows it checked; given one stored outside them (set from the CLI), the picker shows
 *   that protocol, never "Not set". Either way saving untouched leaves it as it is, and picking
 *   Google GenAI or MMSP sends it.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  catalogEntryFor,
  catalogGroupConnection,
  presetProviderTable,
  providerInfo,
} from "@prismshadow/penguin-core/model-catalog";
import type { ModelsResponse, ProviderConnectionDto } from "@prismshadow/penguin-server/api";
import {
  applyProviderUpdate,
  groupKeyMissesRow,
  inheritedConnection,
  rowKey,
} from "../src/features/models/connection";
import {
  ProviderSettingsDialog,
  groupEnvKey,
  initialDraft,
  protocolChoice,
  providerBaseUrlMissing,
  providerDetectOnSave,
  providerDetectRequest,
  providerSettingsUpdate,
  probeGroupProtocol,
  saveGroupSettings,
} from "../src/features/models/provider-settings-dialog";
import { userProviderInfo } from "../src/features/models/model-grouping";
import { ProtocolSuffixMenu } from "../src/features/models/protocol-suffix";
import { S } from "../src/lib/strings";
import { json, stubFetch } from "./helpers/fetch";

// The dialog is a Modal, which portals to document.body; the server renderer has no portals, so
// here a portal renders in place. Nothing else about react-dom changes. (The Modal also notes
// where focus was when it opened; the describe below gives it a document with nothing focused.)
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: unknown) => children,
}));

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

describe("the protocol the group settings show", () => {
  it.each([
    ["openai-responses", "openai-responses"],
    ["ant-messages", "ant-messages"],
    ["openai-chat", "openai-chat"],
    ["google-genai", "google-genai"],
    ["mmsp", "mmsp"],
    ["openai", "openai-chat"],
    ["gemini-generate-content", "google-genai"],
  ])(
    "a group stored on %s shows %s checked, and saving untouched sends nothing",
    (stored, shown) => {
      const group = { clientType: stored };
      const draft = initialDraft(group);
      expect(protocolChoice(draft)).toBe(shown);
      expect(providerSettingsUpdate(group, draft)).toBeNull();
    },
  );

  it("a protocol stored outside the picker shows as itself, never Not set, and stays as it is", () => {
    for (const stored of ["openai-chat-vllm-adapter", "google-official", "gemini-official"]) {
      const group = { clientType: stored };
      const draft = initialDraft(group);
      expect(protocolChoice(draft), stored).toBe(stored);
      expect(providerSettingsUpdate(group, draft), stored).toBeNull();
    }
  });

  it("picking Google GenAI or MMSP sends it", () => {
    const draft = initialDraft(STORED);
    expect(providerSettingsUpdate(STORED, { ...draft, clientType: "google-genai" })).toEqual({
      clientType: "google-genai",
    });
    expect(providerSettingsUpdate(STORED, { ...draft, clientType: "mmsp" })).toEqual({
      clientType: "mmsp",
    });
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

  it("detects on a custom-like group with a base URL, on Not set, while some model would follow the group's protocol", () => {
    expect(providerDetectOnSave("my-group", [row(), row()], typed)).toBe(true);
    // One model storing its own protocol does not settle the others'.
    expect(
      providerDetectOnSave("my-group", [row(), row({ clientType: "ant-messages" })], typed),
    ).toBe(true);
    expect(providerDetectOnSave("custom", [atriaRow, row()], typed)).toBe(true);
    // No model yet: the ones added later will follow the group.
    expect(providerDetectOnSave("custom", [], typed)).toBe(true);
  });

  it("does not detect when a protocol is picked, every model stores one, or the group is built-in", () => {
    expect(providerDetectOnSave("my-group", [row()], { ...typed, clientType: "openai-chat" })).toBe(
      false,
    );
    expect(
      providerDetectOnSave(
        "my-group",
        [row({ clientType: "ant-messages" }), row({ clientType: "openai-chat" })],
        typed,
      ),
    ).toBe(false);
    // Custom holding Atria alone: its row stores a protocol, which settles it.
    expect(providerDetectOnSave("custom", [atriaRow], typed)).toBe(false);
    for (const id of ["vllm", "openrouter", "deepseek"]) {
      expect(providerDetectOnSave(id, [row()], typed), id).toBe(false);
    }
    expect(providerDetectOnSave("my-group", [row()], { ...typed, baseUrl: " " })).toBe(false);
  });
});

describe("Save, as the dialog runs it", () => {
  const ANSWER: ModelsResponse = { providers: {}, models: [] };
  const typed = { ...initialDraft(undefined), baseUrl: "http://10.0.0.5:8000/v1" };

  /** One Save over the fetch fake, probing with the dialog's own probe. */
  const save = (
    providerId: string,
    rows: ReturnType<typeof row>[],
    draft: ReturnType<typeof initialDraft>,
    dismissed: () => boolean = () => false,
  ) =>
    saveGroupSettings("p1", providerId, undefined, rows, draft, {
      probe: () => probeGroupProtocol("p1", providerId, undefined, draft),
      dismissed,
    });

  it("refuses a base URL that is not an absolute http(s) URL with the field's error, and sends nothing", async () => {
    const network = stubFetch(() => json(ANSWER));
    for (const baseUrl of ["not-a-url", "10.0.0.5:8000/v1", "ftp://10.0.0.5/v1"]) {
      for (const id of ["my-group", "openrouter"]) {
        expect(await save(id, [row()], { ...typed, baseUrl }), `${id} ${baseUrl}`).toEqual({
          kind: "invalid",
          baseUrlError: S.models.baseUrlInvalid,
        });
      }
    }
    expect(network.requests).toEqual([]);
  });

  it("probes where one model has no protocol of its own, and saves the protocol found", async () => {
    const network = stubFetch((req) =>
      req.method === "POST"
        ? json({ detected: "openai-responses", baseUrl: typed.baseUrl, probes: [] })
        : json(ANSWER),
    );
    const result = await save("my-group", [row(), row({ clientType: "ant-messages" })], typed);
    expect(result).toEqual({ kind: "saved", res: ANSWER });
    expect(network.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /api/projects/p1/models/detect",
      "PUT /api/projects/p1/models/providers/my-group",
    ]);
    expect(network.requests[1]!.body).toEqual({
      baseUrl: typed.baseUrl,
      clientType: "openai-responses",
    });
  });

  it("does not probe where every model stores its own protocol: only the base URL is sent", async () => {
    const network = stubFetch(() => json(ANSWER));
    const rows = [row({ clientType: "ant-messages" }), row({ clientType: "openai-chat" })];
    expect(await save("my-group", rows, typed)).toEqual({ kind: "saved", res: ANSWER });
    expect(network.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "PUT /api/projects/p1/models/providers/my-group",
    ]);
    expect(network.requests[0]!.body).toEqual({ baseUrl: typed.baseUrl });
  });

  it("writes nothing when the dialog is dismissed while the probe is in flight", async () => {
    let probing!: () => void;
    const probeSent = new Promise<void>((resolve) => (probing = resolve));
    let answer!: (res: Response) => void;
    const network = stubFetch((req) => {
      if (req.method !== "POST") return json(ANSWER);
      probing();
      return new Promise<Response>((resolve) => (answer = resolve));
    });
    let dismissed = false;
    const pending = save("my-group", [row()], typed, () => dismissed);
    await probeSent;
    dismissed = true;
    answer(json({ detected: "openai-chat", probes: [] }));
    expect(await pending).toEqual({ kind: "dismissed" });
    expect(network.requests.map((r) => r.method)).toEqual(["POST"]);
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

describe("what the group settings dialog shows", () => {
  /** A page with nothing focused, which is all the Modal reads from the document while rendering. */
  beforeEach(() => {
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("document", { activeElement: null, body: null });
  });

  /** The dialog's markup, opened on a group as stored. */
  const dialog = (
    id: string,
    group: ProviderConnectionDto | undefined,
    rows: ReturnType<typeof row>[] = [],
  ) =>
    renderToStaticMarkup(
      createElement(ProviderSettingsDialog, {
        projectId: "p1",
        provider: providerInfo(id) ?? userProviderInfo(id),
        group,
        rows,
        detectedEnvKeys: new Set<string>(),
        onClose: () => {},
        onSaved: () => {},
      }),
    );

  it("shows the file's values and nothing about the catalog or the models' own values", () => {
    // The catalog gives OpenRouter its endpoint and Responses; the file holds a proxy on Chat
    // Completions, or no table at all.
    const catalog = catalogGroupConnection("openrouter")!;
    const proxied = {
      baseUrl: "https://proxy.example/or/v1",
      clientType: "openai-chat",
      apiKeyMasked: "sk-or…4444",
    };
    const ownValues = [row({ key: true }), row({ baseUrl: "http://a/v1" }), row()];
    for (const group of [proxied, undefined]) {
      const html = dialog("openrouter", group, ownValues);
      expect(html).not.toContain(catalog.base_url!);
      expect(html).not.toContain(S.models.protocolNames[catalog.client_type!]!);
      // No explanatory line under the fields: no catalog value, no count of overrides.
      expect(html).not.toMatch(/<p[\s>]/);
    }
    expect(dialog("openrouter", proxied, ownValues)).toContain(`value="${proxied.baseUrl}"`);
  });

  it("links the vendor's model list in a new tab where the catalog names one", () => {
    for (const id of ["openrouter", "tokendance"]) {
      const html = dialog(id, presetGroup(id));
      const anchors = html.match(/<a [^>]*>.*?<\/a>/g) ?? [];
      const list = anchors.find((a) => a.includes(S.models.modelList));
      expect(list, id).toBeDefined();
      expect(list, id).toContain(`href="${providerInfo(id)!.modelsUrl}"`);
      expect(list, id).toContain('target="_blank"');
    }
  });

  it("has no model-list link where the catalog names none", () => {
    expect(dialog("custom", undefined)).not.toContain(S.models.modelList);
    expect(dialog("my-ollama", { baseUrl: "http://127.0.0.1:11434/v1" })).not.toContain(
      S.models.modelList,
    );
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
});
