// @vitest-environment jsdom
/**
 * Switching tabs on the Agent settings page (the agents feature's agent-settings-page.tsx): one rule
 * for every tab, and no placeholder for data the page already has.
 *
 * - Given the page holds the Agent's config, the tabs drawn from it — Overview, System Prompt,
 *   Runtime and Tools — switch in without any waiting state, there and back.
 * - Given a tab that reads its own data (the Vault), while that read is out the tab holds one
 *   waiting state under its description and nothing of what the read brings; when it answers,
 *   the switch, the keys and the prompt arrive together and the wait is gone.
 * - Given a change on the Schedules tab, the read after it refreshes the table in place: the
 *   table stays on screen while the answer is out, and the tab never drops back to its wait.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { ScheduleItem } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentSettingsPage } from "@prismshadow/penguin-library-agent/web/agents/agent-settings-page";
import { AGENT_ID, agentConfig, agentServer, mountAgentApp } from "./helpers/agent-app";
import { button, click, field, hasButton, unmountAll, waitFor } from "./helpers/dom";

const PAGE = `/agents/${AGENT_ID}`;

const NIGHTLY: ScheduleItem = {
  name: "nightly-report",
  prompt: "Summarise the day.",
  enabled: true,
  startAt: "2026-11-19T02:00:00.000Z",
  period: "1d",
  status: "active",
  queued: false,
};

const waits = () => document.querySelectorAll(".ui-waiting");
const switches = () => document.querySelectorAll('[role="switch"]');

/**
 * Every waiting state that entered the page while it was watched, however briefly: the
 * observer's records keep a node that was added and removed again before anyone looked.
 */
function watchWaits() {
  let entered = 0;
  const count = (records: MutationRecord[]) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(".ui-waiting")) entered++;
        entered += node.querySelectorAll(".ui-waiting").length;
      }
    }
  };
  const observer = new MutationObserver(count);
  observer.observe(document.body, { subtree: true, childList: true });
  return () => {
    count(observer.takeRecords());
    observer.disconnect();
    return entered;
  };
}

describe("switching Agent settings tabs", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("shows no waiting state for the tabs drawn from the config the page holds", async () => {
    agentServer();
    await mountAgentApp(h(AgentSettingsPage), { at: `${PAGE}?tab=overview` });
    await waitFor(() => document.querySelector('[role="tablist"]') !== null);
    const entered = watchWaits();
    for (const tab of [
      en.agent.tabPrompt,
      en.agent.tabRuntime,
      en.agent.tabTools,
      en.agent.tabOverview,
      en.agent.tabPrompt,
    ]) {
      await click(button(tab));
      await waitFor(() => document.querySelector('[aria-selected="true"]')?.textContent === tab);
    }
    expect(field(en.agent.systemPrompt)).toBeDefined();
    expect(entered()).toBe(0);
  });

  it("holds one wait while the Vault is read, then brings its switch, keys and prompt together", async () => {
    const server = agentServer();
    await mountAgentApp(h(AgentSettingsPage), { at: `${PAGE}?tab=overview` });
    await waitFor(() => document.querySelector('[role="tablist"]') !== null);
    const read = server.holdNext(null, /\/vault$/);

    await click(button(en.agent.tabVault));
    expect(waits()).toHaveLength(1);
    expect(switches()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("GITHUB_TOKEN");
    expect(document.querySelector("textarea")).toBeNull();

    read.release();
    await waitFor(() => waits().length === 0);
    expect(switches().length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("GITHUB_TOKEN");
    expect(field(en.vault.injection.promptLabel)).toBeDefined();
  });

  it("refreshes the Schedules table in place after a change, never dropping back to the wait", async () => {
    const server = agentServer(agentConfig(), { schedules: [{ item: NIGHTLY }] });
    await mountAgentApp(h(AgentSettingsPage), { at: `${PAGE}?tab=schedules` });
    await waitFor(() => document.body.textContent?.includes(NIGHTLY.name) === true);
    const entered = watchWaits();
    const reread = server.holdNext(null, /\/schedules$/);

    await click(button(en.schedule.disable));
    await waitFor(() => server.requests().some((r) => r.method === "PUT"));
    expect(document.body.textContent).toContain(NIGHTLY.name);
    expect(waits()).toHaveLength(0);

    reread.release();
    await waitFor(() => hasButton(en.schedule.enable));
    expect(document.body.textContent).toContain(NIGHTLY.name);
    expect(entered()).toBe(0);
  });
});
