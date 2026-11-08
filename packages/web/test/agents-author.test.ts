// @vitest-environment jsdom
/**
 * An Agent's author on the Agents page and in Agent settings (features/agents/agents-page.tsx,
 * agent-groups.ts, the Overview tab of agent-settings-page.tsx).
 *
 * - Given Agents made by people, by agents and by company mode, the page groups them by author
 *   by default: people's first, then agents', then company mode's, whatever order the list came
 *   in; an organization employee sits under its own author, with no employees section beside.
 *   An Agent the list carries no author for is a person's.
 * - A search leaves out the groups it empties.
 * - A folded group stays folded on the next visit, and a search opens it.
 * - Given "No grouping", the page is one list with the employees in a section of their own,
 *   and the next visit opens it the same way.
 * - Given an author picked on the Overview tab, nothing is written until Save; Save writes the
 *   author, and the tab shows it saved.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { Employment } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentsPage } from "../src/features/agents/agents-page";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { AGENT_ID, PROJECT_ID, agentServer, mountAgentApp } from "./helpers/agent-app";
import { button, click, type, unmountAll, waitFor } from "./helpers/dom";

const ACME: Employment = { orgId: "acme", orgName: "Acme", title: "Writer", status: "active" };

/** The list as the server answers it: deliberately not in group order. */
const MORE_AGENTS = [
  { agentId: "acme_ceo", author: "company" as const, employments: [{ ...ACME, title: "CEO" }] },
  { agentId: "scout", author: "agent" as const },
  { agentId: "hired_hand", author: "user" as const, employments: [ACME] },
];

/** The group sections on the page, top to bottom: each title with the cards' names in it. */
function groups(): Array<{ title: string; open: boolean; cards: string[] }> {
  return [...document.querySelectorAll<HTMLElement>("section")]
    .map((section) => ({
      section,
      head: section.querySelector(":scope > [data-slot=head] > button[aria-expanded]"),
    }))
    .filter(({ head }) => head !== null)
    .map(({ section, head }) => ({
      title: head!.querySelector(".font-semibold")?.textContent ?? "",
      open: head!.getAttribute("aria-expanded") === "true",
      cards: cardNames(section),
    }));
}

function cardNames(root: ParentNode = document): string[] {
  return [...root.querySelectorAll<HTMLElement>("[data-agent-card]")].map(
    (card) => card.querySelector("a, span.font-bold")?.textContent ?? "",
  );
}

/** The ruled sections' titles: the employees section is one. */
const ruledTitles = () => [...document.querySelectorAll("section h2")].map((t) => t.textContent);

async function pickOption(trigger: HTMLElement, label: string): Promise<void> {
  await click(trigger);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.textContent?.trim() === label,
  );
  if (option === undefined) throw new Error(`no option ${label}`);
  await click(option);
}

async function openList() {
  const server = agentServer(undefined, { moreAgents: MORE_AGENTS });
  await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
  await waitFor(() => cardNames().length === 4);
  return server;
}

describe("the Agents page's grouping by author", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("groups people's, agents' and company mode's Agents in that order, employees under their author", async () => {
    await openList();
    expect(groups()).toEqual([
      { title: en.agent.authorGroups.user, open: true, cards: ["Helper", "hired_hand"] },
      { title: en.agent.authorGroups.agent, open: true, cards: ["scout"] },
      { title: en.agent.authorGroups.company, open: true, cards: ["acme_ceo"] },
    ]);
    expect(ruledTitles().some((t) => t?.includes(en.agent.employeesSection))).toBe(false);
  });

  it("leaves out the groups a search empties", async () => {
    await openList();
    await type(document.querySelector<HTMLInputElement>("input")!, "scout");
    expect(groups().map((g) => g.title)).toEqual([en.agent.authorGroups.agent]);
  });

  it("keeps a folded group folded on the next visit, and opens it for a search", async () => {
    await openList();
    await click(document.querySelector("section > [data-slot=head] > button[aria-expanded]")!);
    expect(groups()[0]).toMatchObject({ title: en.agent.authorGroups.user, open: false });
    await unmountAll();

    await openList();
    expect(groups().map((g) => g.open)).toEqual([false, true, true]);
    await type(document.querySelector<HTMLInputElement>("input")!, "hired");
    expect(groups()).toEqual([
      { title: en.agent.authorGroups.user, open: true, cards: ["hired_hand"] },
    ]);
  });

  it("shows one list with the employees apart under No grouping, and opens that way next time", async () => {
    await openList();
    await pickOption(button(en.agent.groupByLabel), en.agent.groupBy.none);
    const flat = () => {
      expect(groups()).toEqual([]);
      expect(cardNames()).toEqual(["Helper", "scout", "acme_ceo", "hired_hand"]);
      expect(ruledTitles().some((t) => t?.includes(en.agent.employeesSection))).toBe(true);
    };
    flat();
    await unmountAll();

    await openList();
    flat();
  });
});

describe("the Overview tab's author", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  /** The Author select's trigger, which its label names. */
  const authorSelect = (): HTMLButtonElement => {
    const label = [...document.querySelectorAll("label")].find(
      (l) => l.textContent?.trim() === en.agent.authorLabel,
    );
    return document.getElementById(label!.htmlFor) as HTMLButtonElement;
  };

  it("writes a picked author on Save, and not before", async () => {
    const server = agentServer();
    await mountAgentApp(h(AgentSettingsPage), { at: `/agents/${AGENT_ID}?tab=overview` });
    await waitFor(() => document.querySelector("label") !== null);
    const configPath = `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/config`;
    expect(authorSelect().textContent).toBe(en.agent.authors.user);

    await pickOption(authorSelect(), en.agent.authors.agent);
    expect(server.writes(configPath)).toEqual([]);

    await click(button(en.common.save));
    await waitFor(() => server.writes(configPath).length === 1);
    expect(server.writes(configPath)[0]!.body).toEqual({ config: { author: "agent" } });
    expect(authorSelect().textContent).toBe(en.agent.authors.agent);
  });
});
