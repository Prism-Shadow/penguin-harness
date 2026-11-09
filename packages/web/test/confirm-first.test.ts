// @vitest-environment jsdom
/**
 * A consequential action asks first: pressing it opens a confirmation and sends nothing, and only
 * the confirmation's own button sends the request. Each surface is the real one, mounted against
 * the package's fake server.
 *
 * - On an Agent's API tab: turning the API off, opening it to keyless callers, and deleting a key.
 * - On an Agent's Overview tab: importing an Agent State package over the Agent's own.
 * - In the server's Settings: turning the Agent API, Chrome connections and company mode off for
 *   every user.
 *
 * (A workbench's restore is agent-workbenches.test.ts's.)
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { AgentApiKeyInfo } from "@prismshadow/penguin-server/api";
import { ApiTab } from "../src/features/agents/api-tab";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { AgentApiSection } from "../src/features/settings/agent-api-section";
import { ChromeExtensionSection } from "../src/features/settings/chrome-extension-section";
import { CompanySection } from "../src/features/settings/company-section";
import { AuthProvider } from "../src/state/auth";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  buttonIn,
  mountAgentApp,
  topDialog,
} from "./helpers/agent-app";
import { adminSettingsServer } from "./helpers/admin-settings";
import { button, click, mount, pickFile, switchNamed, unmountAll, waitFor } from "./helpers/dom";
import type { FetchRequest } from "./helpers/fetch";

const KEY: AgentApiKeyInfo = {
  keyId: "kq3VtX9cRb2LmN0a",
  name: "docs-site search",
  prefix: "penguin_Zr8kQ2vT",
  createdBy: "admin",
  createdAt: "2026-10-01T08:00:00.000Z",
  lastUsedAt: null,
};

/** The writes a surface's server has seen so far, oldest first. */
type Writes = () => FetchRequest[];

/** One action: how to press it, the confirmation's button, and the write it must end in. */
interface Action {
  name: string;
  open: () => Promise<Writes>;
  press: () => Promise<void>;
  confirm: string;
  write: { method: string; path: string; body?: unknown };
}

async function apiTab(): Promise<Writes> {
  const server = agentServer(undefined, { apiKeys: [KEY] });
  await mountAgentApp(h(ApiTab, { projectId: PROJECT_ID, agentId: AGENT_ID, isOwner: true }), {
    at: `/agents/${AGENT_ID}?tab=api`,
  });
  await waitFor(() => document.querySelector('button[role="switch"]') !== null);
  return () => server.writes();
}

async function overview(): Promise<Writes> {
  const server = agentServer();
  await mountAgentApp(h(AgentSettingsPage), { at: `/agents/${AGENT_ID}?tab=overview` });
  await waitFor(() => document.body.textContent?.includes(en.agent.importSnapshot) === true);
  return () => server.writes();
}

/** A section of the server's Settings, its switch on, against the server-global settings. */
const settingsSection = (section: () => ReturnType<typeof h>, label: string) => async () => {
  const server = adminSettingsServer();
  await mount(h(AuthProvider, null, section()));
  await waitFor(() => {
    try {
      return switchNamed(label).getAttribute("aria-checked") === "true";
    } catch {
      return false;
    }
  });
  return () => server.fetch.requests.filter((r) => r.method !== "GET");
};

const AGENT_PATH = `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}`;

const ACTIONS: Action[] = [
  {
    name: "turning an Agent's API off",
    open: apiTab,
    press: () => click(switchNamed(en.agent.apiEnable)),
    confirm: en.agent.apiOff,
    write: { method: "PUT", path: `${AGENT_PATH}/api`, body: { enabled: false } },
  },
  {
    name: "opening an Agent's API to keyless callers",
    open: apiTab,
    press: () => click(switchNamed(en.agent.apiOpen)),
    confirm: en.agent.apiOpenConfirm,
    write: { method: "PUT", path: `${AGENT_PATH}/api`, body: { open: true } },
  },
  {
    name: "deleting one of an Agent's API keys",
    open: apiTab,
    press: () => click(button(`${en.agent.apiDeleteKey} ${KEY.name}`)),
    confirm: en.common.delete,
    write: { method: "DELETE", path: `${AGENT_PATH}/api/keys/${KEY.keyId}` },
  },
  {
    name: "importing an Agent State package over the Agent's own",
    open: overview,
    press: async () => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      await pickFile(input, new File(["package"], "agent.zip", { type: "application/zip" }));
      await waitFor(() => document.querySelector('[role="dialog"]') !== null);
    },
    confirm: en.agent.importSnapshot,
    write: { method: "POST", path: `${AGENT_PATH}/import` },
  },
  {
    name: "turning the Agent API off for every user",
    open: settingsSection(() => h(AgentApiSection), en.settings.agentApiToggle),
    press: () => click(switchNamed(en.settings.agentApiToggle)),
    confirm: en.settings.agentApiOff,
    write: { method: "PUT", path: "/api/admin/settings", body: { agentApiEnabled: false } },
  },
  {
    name: "turning Chrome connections off for every user",
    open: settingsSection(() => h(ChromeExtensionSection), en.browserSettings.allow),
    press: () => click(switchNamed(en.browserSettings.allow)),
    confirm: en.browserSettings.off,
    write: {
      method: "PUT",
      path: "/api/admin/settings",
      body: { browserExtensionsEnabled: false },
    },
  },
  {
    name: "turning company mode off for every user",
    open: settingsSection(() => h(CompanySection), en.settings.companyModeServer),
    press: () => click(switchNamed(en.settings.companyModeServer)),
    confirm: en.settings.companyModeOff,
    write: { method: "PUT", path: "/api/admin/settings", body: { companyMode: false } },
  },
];

describe("a consequential action asks first", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(unmountAll);

  it.each(ACTIONS)("$name: sends nothing until the confirmation's button", async (action) => {
    const writes = await action.open();
    const before = writes().length;
    await action.press();
    await waitFor(() => document.querySelector('[role="dialog"]') !== null);
    expect(writes()).toHaveLength(before);

    await click(buttonIn(topDialog(), action.confirm));
    await waitFor(() => writes().length > before);
    const sent = writes().slice(before);
    expect(sent.map((r) => [r.method, r.path])).toEqual([[action.write.method, action.write.path]]);
    if (action.write.body !== undefined) expect(sent[0]!.body).toEqual(action.write.body);
  });
});
