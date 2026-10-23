// @vitest-environment jsdom
/**
 * The Agents page holds still while machines answer (features/agents/agents-page.tsx over
 * lib/machine-agent-lists.ts): what it shows changes only when the data does.
 *
 * - Given a connected machine whose list an earlier page load remembered, its cards are on the
 *   page before the machine answers, inert and without the plug mark — their controls say the
 *   machine is being read — while its first answer is held; once it answers the same list the
 *   cards act, and no text on the page changed.
 * - Given a delete of this server's Agent, the other cards stay on screen while the list is read
 *   again: the skeleton never shows.
 * - Given the page left and re-entered a minute later, every card acts at once, and the machine
 *   is asked exactly once more.
 * - Given a machine whose read fails, its remembered cards stay, with its failure on the plug.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentsPage } from "../src/features/agents/agents-page";
import { PROJECT_ID, agentServer, mountAgentApp } from "./helpers/agent-app";
import type { AgentServer, FakeMachine } from "./helpers/agent-app";
import { button, click, run, unmountAll, waitFor, watchText } from "./helpers/dom";

const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: ["default_agent", "helper"],
};
const AGENTS_PATH = `/api/projects/${PROJECT_ID}/agents`;

/** The cards on the page, top to bottom. */
const cards = () => [...document.querySelectorAll<HTMLElement>(".ui-frame")];

/** What a card is: its name, and the machine tag after it when it has one. */
function describeCard(card: HTMLElement): string {
  const title = card.querySelector("div > div")!;
  const name = title.querySelector("a, span.font-bold, span.text-base")?.textContent ?? "";
  const tag = [...title.querySelectorAll("span")].find((s) => s.textContent?.startsWith("[SSH:"));
  return tag === undefined ? name : `${name} ${tag.textContent}`;
}

const onGpu = (name: string) => `${name} ${en.chat.machineTag("gpu-box")}`;
const ALL_CARDS = ["Helper", onGpu("default_agent"), onGpu("helper")];

/** The card of `name` on gpu-box, if it is on the page. */
const gpuCard = (name: string) => cards().find((c) => describeCard(c) === onGpu(name));

/** The card's Settings button. */
const settingsOf = (card: HTMLElement) =>
  [...card.querySelectorAll("button")].find((b) => b.textContent === en.common.settings)!;

/** Whether gpu-box's `helper` card can be acted on: its name is a link. */
const gpuCardActs = () => gpuCard("helper")?.querySelector("a") != null;

/** The machine's Agent-list reads: made so far, or answered so far. */
const listReads = (server: AgentServer) =>
  server.fetch.requests.filter(
    (r) => r.machine === "gpu1" && r.method === "GET" && r.path === AGENTS_PATH,
  ).length;
const answeredListReads = (server: AgentServer) =>
  server
    .requests()
    .filter((r) => r.machine === "gpu1" && r.method === "GET" && r.path === AGENTS_PATH).length;

const openPage = () => mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });

/**
 * A first page load that hears gpu-box out, then a reload — memory gone, storage kept — with
 * `beforeReload` run between the two; returns what it returned.
 */
async function afterAReload<T>(beforeReload: () => T): Promise<T> {
  await openPage();
  await waitFor(gpuCardActs);
  await unmountAll();
  const made = beforeReload();
  await openPage();
  return made;
}

describe("the Agents page while machines answer", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("shows a remembered machine's cards before it answers, inert without the plug, and changes no text when it answers", async () => {
    const server = agentServer(undefined, { machines: [GPU] });
    const slow = await afterAReload(() => server.hold("gpu1"));
    await waitFor(() => cards().length === 3);
    expect(answeredListReads(server)).toBe(1);
    expect(cards().map(describeCard)).toEqual(ALL_CARDS);

    const page = watchText("body");
    const card = gpuCard("helper")!;
    expect(card.querySelector("a")).toBeNull();
    // Not out of reach — being read: no lifted plug.
    expect(card.querySelector('span[role="img"]')).toBeNull();
    const settings = settingsOf(card);
    expect(settings.disabled).toBe(true);
    expect(settings.getAttribute("data-tooltip") ?? settings.getAttribute("title")).toBe(
      en.agent.readingMachineAgents("gpu-box"),
    );

    slow.release();
    await waitFor(gpuCardActs);
    expect(settingsOf(gpuCard("helper")!).disabled).toBe(false);
    expect(page.texts()).toHaveLength(1);
  });

  it("keeps the other cards on screen while the list is read again after a delete", async () => {
    const server = agentServer(undefined, { machines: [GPU] });
    await openPage();
    await waitFor(gpuCardActs);
    const skeleton = watchText("[data-skeleton]");
    const localReads = () =>
      server.fetch.requests.filter(
        (r) => r.machine === null && r.method === "GET" && r.path === AGENTS_PATH,
      ).length;
    const before = localReads();
    const reread = server.holdNext(null, new RegExp(`^${AGENTS_PATH}$`));

    const helper = cards().find((c) => describeCard(c) === "Helper")!;
    await click(helper.querySelector(`button[aria-label="${en.agent.deleteAgent}"]`)!);
    await click(button(en.common.delete));
    await waitFor(() => localReads() === before + 1);
    expect(cards().map(describeCard)).toEqual(ALL_CARDS);

    reread.release();
    await waitFor(() => cards().length === 2);
    expect(server.localAgents()).toEqual([]);
    expect(cards().map(describeCard)).toEqual([onGpu("default_agent"), onGpu("helper")]);
    expect(skeleton.texts()).toEqual([]);
  });

  it("acts at once when the page is entered again, and asks the machine exactly once more", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const server = agentServer(undefined, { machines: [GPU] });
    const router = await openPage();
    await waitFor(gpuCardActs);
    expect(listReads(server)).toBe(1);

    await run(() => router.navigate("/chat"));
    vi.setSystemTime(Date.now() + 60_000);
    const slow = server.hold("gpu1");
    await run(() => router.navigate("/list"));
    await waitFor(() => cards().length === 3);
    // Nothing waits for the machine's re-read: the cards act from the first paint back.
    expect(gpuCardActs()).toBe(true);
    expect(settingsOf(gpuCard("helper")!).disabled).toBe(false);
    await waitFor(() => listReads(server) === 2);

    slow.release();
    await waitFor(() => answeredListReads(server) === 2);
    expect(gpuCardActs()).toBe(true);
    expect(listReads(server)).toBe(2);
  });

  it("keeps a failing machine's remembered cards, with its failure on the plug", async () => {
    const server = agentServer(undefined, { machines: [GPU] });
    await afterAReload(() => server.failNext("gpu1", /\/agents$/));
    const plug = () => gpuCard("helper")?.querySelector<HTMLElement>('span[role="img"]') ?? null;
    await waitFor(() => plug() !== null);
    expect(plug()!.getAttribute("aria-label")).toContain("gpu1 did not answer");
    expect(cards().map(describeCard)).toEqual(ALL_CARDS);
    expect(gpuCardActs()).toBe(false);
  });
});
