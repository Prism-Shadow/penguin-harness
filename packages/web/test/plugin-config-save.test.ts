// @vitest-environment jsdom
/**
 * A card of the Settings dialog's Plugins page (features/settings/plugin-config-card.tsx) under
 * the settings commit model, and the page's machine switch, against the plugin-config route
 * behind the fetch fake.
 *
 * - A boolean field writes the moment it is flipped, alone, to its own entry; the text typed
 *   beside it stays typed and unsaved.
 * - Turning the card's switch on is reported once the write has landed (the backend offer).
 * - A refused switch write puts the switch back and says why in a toast.
 * - Save and Reset are held while the card is as stored; a cleared number box is a change, sent
 *   as no value.
 * - A number box holding no finite number is named, and holds Save (the browser's own number
 *   box never hands one over, so the rule is checked on the draft directly).
 * - Save sends only the typed fields that changed, and the card is clean afterwards.
 * - A field the server refuses is named under that field, and the card keeps its draft.
 * - When the page reads the entries again, a clean card follows them and a dirty one keeps the
 *   typing.
 * - Picking another machine while a card is dirty asks first, and switches only on discard.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h, useState } from "react";
import type { PluginConfigEntry } from "@prismshadow/penguin-server/api";
import { hasUnsaved, toastStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import {
  PluginCard,
  cardDraftOf,
  unparsedNumbers,
} from "../src/features/settings/plugin-config-card";
import { ConfigMachinePicker } from "../src/features/settings/plugins-section";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch } from "./helpers/fetch";
import { button, click, field, mount, run, switchNamed, type, unmountAll } from "./helpers/dom";

const ENTRY: PluginConfigEntry = {
  name: "sandbox",
  configuration: {
    title: "Sandbox",
    switch: "enabled",
    properties: {
      enabled: { type: "boolean", title: "Enable" },
      writableTemp: { type: "boolean", title: "Temporary directory writable" },
      timeout: { type: "number", title: "Timeout" },
      note: { type: "string", title: "Note" },
    },
  },
  values: { enabled: false, writableTemp: false, timeout: 30, note: "first" },
};

/** The plugin-config route: a PUT merges into the entry and answers with every entry. */
function pluginServer(): { fetch: FakeFetch; refuseNext: (code: string, message: string) => void } {
  let entry = structuredClone(ENTRY);
  let refusal: { code: string; message: string } | null = null;
  const fetch = stubFetch((request) => {
    if (request.path === "/api/admin/plugin-config" && request.method === "PUT") {
      if (refusal !== null) {
        const { code, message } = refusal;
        refusal = null;
        return apiError(400, code, message);
      }
      const body = request.body as { values: Record<string, unknown> };
      entry = { ...entry, values: { ...entry.values, ...body.values } };
      return json({ plugins: [entry] });
    }
    return apiError(404, "not_found");
  });
  return {
    fetch,
    refuseNext: (code, message) => {
      refusal = { code, message };
    },
  };
}

const puts = (fetch: FakeFetch) =>
  fetch.requests.filter((r) => r.method === "PUT").map((r) => r.body);

/** The page around one card: its entries and busy flag, and a way to hand it a reload. */
const page: { reload: (entries: PluginConfigEntry[]) => void } = { reload: () => {} };

function Page({ onSwitchedOn = () => {} }: { onSwitchedOn?: (e: PluginConfigEntry) => void }) {
  const [entries, setEntries] = useState<PluginConfigEntry[]>([ENTRY]);
  const [busy, setBusy] = useState<string | null>(null);
  page.reload = setEntries;
  return h(PluginCard, {
    members: entries,
    machine: null,
    busy,
    setBusy,
    locale: "en",
    onStored: (stored) =>
      setEntries((prev) => prev.map((e) => (e.name === stored.name ? stored : e))),
    onStoredAll: setEntries,
    onAction: () => {},
    onSwitchedOn,
  });
}

const TEMP = "Temporary directory writable";
const checked = (name: string) => switchNamed(name).getAttribute("aria-checked");

describe("a plugin settings card", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => toastStore.setState({ items: [] }));
  afterEach(async () => {
    await unmountAll();
  });

  it("writes a flipped boolean alone, and keeps the text typed beside it unsaved", async () => {
    const server = pluginServer();
    await mount(h(Page));
    await click(switchNamed("Enable"));
    await type(field("Note"), "typed");
    await click(switchNamed(TEMP));
    expect(puts(server.fetch)).toEqual([
      { name: "sandbox", values: { enabled: true } },
      { name: "sandbox", values: { writableTemp: true } },
    ]);
    expect(checked(TEMP)).toBe("true");
    expect(field("Note").value).toBe("typed");
    expect(button("Save").disabled).toBe(false);
  });

  it("reports the card's switch turned on once the write has landed", async () => {
    pluginServer();
    const onSwitchedOn = vi.fn();
    await mount(h(Page, { onSwitchedOn }));
    await click(switchNamed("Enable"));
    expect(onSwitchedOn).toHaveBeenCalledTimes(1);
    expect(onSwitchedOn.mock.calls[0]![0].values.enabled).toBe(true);
  });

  it("puts a refused switch back and says why", async () => {
    const server = pluginServer();
    server.refuseNext("internal", "disk full");
    await mount(h(Page));
    await click(switchNamed("Enable"));
    expect(checked("Enable")).toBe("false");
    expect(toastStore.getState().items.map((t) => t.kind)).toEqual(["error"]);
  });

  it("holds Save and Reset while unchanged, and sends a cleared number box as no value", async () => {
    const server = pluginServer();
    await mount(h(Page));
    await click(switchNamed("Enable"));
    expect(button("Save").disabled).toBe(true);
    expect(button("Reset").disabled).toBe(true);
    await type(field("Timeout"), "");
    await click(button("Save"));
    expect(puts(server.fetch).at(-1)).toEqual({ name: "sandbox", values: { timeout: null } });
  });

  it("names a number box that holds no finite number", () => {
    const entry = { ...ENTRY, values: { ...ENTRY.values, enabled: true } };
    const draft = cardDraftOf([entry]);
    draft.drafts.sandbox = { ...draft.drafts.sandbox, timeout: "abc" };
    expect(unparsedNumbers([entry], draft)).toEqual(["sandbox\0timeout"]);
    draft.drafts.sandbox = { ...draft.drafts.sandbox, timeout: "45" };
    expect(unparsedNumbers([entry], draft)).toEqual([]);
  });

  it("saves only the typed fields that changed, and is clean afterwards", async () => {
    const server = pluginServer();
    await mount(h(Page));
    await click(switchNamed("Enable"));
    await type(field("Timeout"), "45");
    await click(button("Save"));
    expect(puts(server.fetch).at(-1)).toEqual({ name: "sandbox", values: { timeout: 45 } });
    expect(button("Save").disabled).toBe(true);
    expect(hasUnsaved()).toBe(false);
  });

  it("names a refused field under it and keeps the draft", async () => {
    const server = pluginServer();
    await mount(h(Page));
    await click(switchNamed("Enable"));
    server.refuseNext("plugin_config_invalid", '"note" must be shorter');
    await type(field("Note"), "far too long");
    await click(button("Save"));
    expect(field("Note").value).toBe("far too long");
    expect(field("Note").getAttribute("aria-invalid")).toBe("true");
    expect(hasUnsaved()).toBe(true);
  });

  it("follows a reload while clean, and keeps the typing while dirty", async () => {
    pluginServer();
    await mount(h(Page));
    await click(switchNamed("Enable"));
    const reloaded = (note: string) => [
      { ...ENTRY, values: { ...ENTRY.values, enabled: true, note } },
    ];
    await run(() => page.reload(reloaded("from the server")));
    expect(field("Note").value).toBe("from the server");
    await type(field("Note"), "mine");
    await run(() => page.reload(reloaded("again from the server")));
    expect(field("Note").value).toBe("mine");
    expect(button("Save").disabled).toBe(false);
  });
});

describe("the Plugins page's machine switch", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("asks while a card is dirty, and switches only on discard", async () => {
    pluginServer();
    const onPick = vi.fn();
    await mount(
      h(
        "div",
        null,
        h(ConfigMachinePicker, {
          machine: null,
          machineIds: ["box-1"],
          nameOf: (id: string) => id,
          disabled: false,
          onPick,
        }),
        h(Page),
        h(UnsavedPrompt),
      ),
    );
    await click(switchNamed("Enable"));
    await type(field("Note"), "typed");
    const pick = async () => {
      await click(button("Machine: This server"));
      await click(button("box-1"));
    };
    await pick();
    await click(button("Keep editing"));
    expect(onPick).not.toHaveBeenCalled();
    await pick();
    await click(button("Discard changes"));
    expect(onPick).toHaveBeenCalledWith("box-1");
    expect(field("Note").value).toBe("first");
  });
});
