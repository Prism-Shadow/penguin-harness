/**
 * The models page's two catalog actions (preset-sync.tsx), as their controls run them. Each
 * control's handler is reached through the element it returns (node env, no DOM) and drives the
 * real `syncPresets` wrapper over the package's fetch fake, so what is asserted is the request
 * that goes over the wire.
 *
 * - Given the header's "Add new models", when it is clicked, one POST …/models/sync-presets goes
 *   out with mode "add", and the table the server answers with is adopted.
 * - Given the Restore defaults confirmation, when its confirm button is pressed, one POST goes
 *   out with mode "restore", the table is adopted, and the dialog closes once the request settles.
 * - Given the server refuses, nothing is adopted, and the busy flag and the badge re-probe still
 *   run.
 * - The confirmation names, in both languages, that keys are kept and that it is final.
 */
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelsResponse, PresetSyncResponse } from "@prismshadow/penguin-server/api";
import {
  AddNewModelsButton,
  AddNewModelsConfirm,
  RestoreDefaultsBody,
  RestoreDefaultsConfirm,
} from "../src/features/models/preset-sync";
import type { PresetSyncHost } from "../src/features/models/preset-sync";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { apiError, json, stubFetch } from "./helpers/fetch";

const ANSWER: PresetSyncResponse = {
  providers: {},
  models: [
    {
      provider: "deepseek",
      modelId: "deepseek-flash",
      isDefault: true,
      effective: { baseUrlSource: "none", clientTypeSource: "none", apiKeySource: "none" },
    },
  ],
  added: 1,
  restored: 3,
};

/**
 * The page's side of an action, recorded; `settled` resolves when the action's last step (the
 * badge re-probe) has run, success or not.
 */
function host(): PresetSyncHost & {
  adopted: ModelsResponse[];
  busy: boolean[];
  settled: Promise<void>;
} {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => (settle = resolve));
  const adopted: ModelsResponse[] = [];
  const busy: boolean[] = [];
  return {
    projectId: "p1",
    adopted,
    busy,
    settled,
    adopt: (res) => adopted.push(res),
    setBusy: (on) => busy.push(on),
    refreshTodos: () => settle(),
  };
}

/** What an element reads as: its static markup without the tags, entities decoded. */
function renderedText(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The sync requests that went out, as the server saw them. */
function syncRequests(fetch: ReturnType<typeof stubFetch>) {
  return fetch.requests.filter((r) => r.path === "/api/projects/p1/models/sync-presets");
}

afterEach(() => setActiveStrings(zh));

describe("the catalog actions send the server's sync in their own mode", () => {
  it('the "Add new models" button only opens its confirmation; it sends nothing itself', () => {
    const fetch = stubFetch(() => json(ANSWER));
    let opened = 0;
    const button = AddNewModelsButton({
      onOpen: () => (opened += 1),
      disabled: false,
      note: "",
    }) as ReactElement<{ onClick: () => void }>;
    button.props.onClick();

    expect(opened).toBe(1);
    expect(syncRequests(fetch)).toEqual([]);
  });

  it('the "Add new models" confirm posts mode "add", adopts the answer, then closes', async () => {
    const fetch = stubFetch(() => json(ANSWER));
    const page = host();
    let closed!: () => void;
    const closing = new Promise<void>((resolve) => (closed = resolve));
    const confirm = AddNewModelsConfirm({
      host: page,
      title: "",
      items: ["openrouter/x"],
      busy: false,
      setSyncing: () => {},
      onClose: () => closed(),
    }) as ReactElement<{ onConfirm: () => void }>;
    confirm.props.onConfirm();
    await closing;

    expect(syncRequests(fetch).map((r) => [r.method, r.body])).toEqual([["POST", { mode: "add" }]]);
    expect(page.adopted).toEqual([ANSWER]);
    expect(page.busy).toEqual([true, false]);
  });

  it('the Restore defaults confirm posts mode "restore", adopts the answer, then closes', async () => {
    const fetch = stubFetch(() => json(ANSWER));
    const page = host();
    const syncing: boolean[] = [];
    let closed!: () => void;
    const closing = new Promise<void>((resolve) => (closed = resolve));
    const confirm = RestoreDefaultsConfirm({
      host: page,
      busy: false,
      setSyncing: (on) => syncing.push(on),
      onClose: () => closed(),
    }) as ReactElement<{ onConfirm: () => void }>;
    confirm.props.onConfirm();
    await closing;

    expect(syncRequests(fetch).map((r) => [r.method, r.body])).toEqual([
      ["POST", { mode: "restore" }],
    ]);
    expect(page.adopted).toEqual([ANSWER]);
    expect(syncing).toEqual([true, false]);
  });

  it("a refused sync adopts nothing, and still lowers the busy flag and re-probes the badge", async () => {
    const fetch = stubFetch(() => apiError(403, "forbidden"));
    const page = host();
    const confirm = AddNewModelsConfirm({
      host: page,
      title: "",
      items: [],
      busy: false,
      setSyncing: () => {},
      onClose: () => {},
    }) as ReactElement<{ onConfirm: () => void }>;
    confirm.props.onConfirm();
    await page.settled;

    expect(syncRequests(fetch)).toHaveLength(1);
    expect(page.adopted).toEqual([]);
    expect(page.busy).toEqual([true, false]);
  });
});

describe("the Restore defaults confirmation", () => {
  it("says, in both languages, that keys are kept and that it cannot be undone", () => {
    for (const dict of [zh, en]) {
      setActiveStrings(dict);
      const text = renderedText(createElement(RestoreDefaultsBody));
      expect(text).toContain("API key");
      expect(text).toContain(dict.models.restoreDefaultsKeeps);
      expect(text).toContain(dict.models.restoreDefaultsFinal);
    }
  });
});
