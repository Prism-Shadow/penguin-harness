} from "@prismshadow/penguin-web/internal";

||||||| parent of f458c43380 (workbench-tabs/theme to plugin-workbenches web/lib; theme-color stays in host (host theme.tsx only consumer))

const UI = "/api/projects/p/agents/a/workbenches/demo/ui";
const tab = (key: string, file: string) => ({
  id: `demo.${key}`,
  key,
  title: key,
  renderer: { iframe: { src: `${UI}/${file}` } },
});

const info = (over: Partial<WorkbenchInfo>): WorkbenchInfo => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  revision: "abcdef012345",
  uiRev: "0123456789ab",
  tabs: [tab("board", "index.html")],
  loadedAt: "2026-08-30T00:00:00Z",
  error: null,
  hints: [],
  ...over,
});

describe("workbench tabs", () => {
  it("shows one tab per contribution, keeping the workbench's load error", () => {
    const tabs = workbenchTabsOf([
      info({
        tabs: [tab("board", "index.html"), { ...tab("stats", "stats.html"), titleZh: "统计" }],
      }),
      info({ id: "headless", tabs: [] }),
      info({ id: "broken", error: "module tree rejected" }),
      info({
        id: "other",
        tabs: [{ id: "other.x", key: "x", title: "X", renderer: { builtin: "nope" } }],
      }),
    ]);
    expect(tabs.map((t) => t.tabId)).toEqual(["demo/board", "demo/stats", "broken/board"]);
    expect(tabs[1]).toMatchObject({ key: "stats", titleZh: "统计", src: `${UI}/stats.html` });
    expect(tabs[2]!.error).toBe("module tree rejected");
  });

  it("serves the page of a machine's workbench through that machine, and says which", () => {
    // A Session on a machine runs a copy of the Agent there, and the workbenches it built live in
    // that copy: the page is fetched through the machine's connection, and every later call
    // about the tab (reload, history, remove) has to go the same way.
    const [local] = workbenchTabsOf([info({})]);
    expect(local).toMatchObject({ machineId: null, src: `${UI}/index.html` });
    const [remote] = workbenchTabsOf([info({})], "m-1");
    expect(remote).toMatchObject({ machineId: "m-1", src: `/server/m-1${UI}/index.html` });
    expect(workbenchAppPath("p", "a", "demo", "board", "m-1")).toBe(
      "/app/p/a/demo/board?machine=m-1",
    );
  });

  it("falls back to Chat when the active tab is gone", () => {
    const tabs = workbenchTabsOf([info({})]);
    expect(settleActiveTab("demo/board", tabs)).toBe("demo/board");
    expect(settleActiveTab("demo/gone", tabs)).toBeNull();
    expect(settleActiveTab(null, tabs)).toBeNull();
  });

  it("keys the page URL on the UI revision so a changed UI reloads", () => {
    expect(workbenchUiUrl({ src: `${UI}/index.html`, uiRev: "0123456789ab" })).toBe(
      `${UI}/index.html?rev=0123456789ab`,
    );
  });

  it("names a full page by workbench and, optionally, tab", () => {
    expect(workbenchAppPath("p 1", "a", "demo")).toBe("/app/p%201/a/demo");
    expect(workbenchAppPath("p 1", "a", "demo", "stats")).toBe("/app/p%201/a/demo/stats");
    const tabs = workbenchTabsOf([
      info({ tabs: [tab("board", "index.html"), tab("stats", "stats.html")] }),
    ]);
    expect(appPageTab(tabs, "demo", undefined)?.key).toBe("board");
    expect(appPageTab(tabs, "demo", "stats")?.key).toBe("stats");
    expect(appPageTab(tabs, "demo", "nope")).toBeNull();
    expect(appPageTab(tabs, "gone", undefined)).toBeNull();
  });
});

describe("workbenches with nothing to show", () => {
  it("surfaces a workbench that contributes no tab but has an error or a hint", () => {
    // A workbench whose FIRST load fails has no tabs at all, so without this the reader sees
    // nothing anywhere in the app — no tab, no mark, no message.
    const broken = info({ id: "broken", tabs: [], error: "index.ts(3,1): TS1005" });
    const hinted = info({ id: "hinted", tabs: [], hints: ["ui/index.html is shown by no tab"] });
    expect(workbenchNoticesOf([broken, hinted, info({})])).toEqual([
      { workbenchId: "broken", error: "index.ts(3,1): TS1005", hints: [] },
      { workbenchId: "hinted", error: null, hints: ["ui/index.html is shown by no tab"] },
    ]);
  });

  it("says nothing about a workbench that is fine, or one whose tabs can carry its error", () => {
    expect(workbenchNoticesOf([info({})])).toEqual([]);
    expect(workbenchNoticesOf([info({ error: "broken" })])).toEqual([]);
    expect(workbenchNoticesOf([info({ tabs: [] })])).toEqual([]);
  });
});

describe("the chat page under a workbench tab", () => {
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  /** jsdom's matchMedia: no query ever matches (the stub the mounted suites share). */
  const unmatchedQuery = {
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;

  it("keeps the workbench page in one owner", () => {
    // The contributed session tab owns the strip and the frame: one useWorkbenchTabs instance,
    // so the strip and what covers the page can never disagree. No second workbench-state
    // reader on the page: a second useWorkbenchTabs instance would keep its own active tab
    // and desync from the strip.
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    const tab = read("src/features/workbenches/session-tab.tsx").replace(/\s+/g, " ");
    expect(tab).toContain("useWorkbenchTabs(");
    expect(tab).toContain("<WorkbenchTabStrip");
    expect(tab).toContain("<WorkbenchFrame");
    const toolbar = read("src/features/chat/toolbar/main-chat-toolbar.tsx").replace(/\s+/g, " ");
    expect(toolbar).not.toContain("workflowTabs");
    const body = read("src/features/chat/body/main-chat-body.tsx").replace(/\s+/g, " ");
    expect(body).not.toContain("workflowTabs");
  });

  it("tells the page when the workbench covers it, and takes it back for chat", async () => {
    stubFetch((request) =>
      request.path === "/api/projects/p/agents/a/workbenches"
        ? json({ workbenches: [info({})] })
        : json({}),
    );
    vi.stubGlobal("matchMedia", () => unmatchedQuery);
    /** What the tab reported, in order. */
    const covers: boolean[] = [];
    const page = await mount(
      h(
        MemoryRouter,
        { initialEntries: ["/chat"] },
        h(
          LocaleProvider,
          null,
          h(
            ThemeProvider,
            null,
            h(WorkbenchSessionTab, {
              projectId: "p",
              agentId: "a",
              machineId: null,
              onCoveredChange: (covered: boolean) => covers.push(covered),
            }),
          ),
        ),
      ),
    );
    await settle();
    // Nothing covers the page while the tab strip is all the tab draws.
    expect(covers).toEqual([false]);

    // Select the workbench: the frame covers everything under the strip. (On a transition the
    // leaving effect reports its false before the entering one reports — the page reads the
    // last report, and the cover is idempotent there.)
    const tabs = () => [...page.container.querySelectorAll('button[role="tab"]')];
    const board = tabs().find((b) => b.textContent === "board");
    expect(board).toBeDefined();
    await click(board!);
    expect(covers.at(-1)).toBe(true);

    // Back to chat: the page is uncovered again.
    const back = tabs().find((b) => b.textContent === S.workbenches.chatTab);
    expect(back).toBeDefined();
    await click(back!);
    expect(covers.at(-1)).toBe(false);

    // Leaving the page takes the cover with it, whatever was shown.
    await click(board!);
    expect(covers.at(-1)).toBe(true);
    await page.unmount();
    expect(covers.at(-1)).toBe(false);
  });

  it("hides what the cover covers and keeps it laid out, then shows it again", async () => {
    stubFetch();
    vi.stubGlobal("matchMedia", () => unmatchedQuery);
    /** The view fragment under test: one conversation, its history still loading. */
    const scope = {
      currency: "USD",
      infoOpen: false,
      setInfoOpen: () => {},
      processes: [],
      procBusy: false,
      setProcToKill: () => {},
      usageCostParts: null,
      usageBuckets: [],
      selected: {
        sessionId: "s1",
        title: "Hello",
        agentId: "a",
        modelId: "m",
        provider: "deepseek",
        workspace: "/tmp",
        createdAt: "2026-11-09T00:00:00Z",
      },
      archivedRow: null,
      stream: {
        error: null,
        errorCause: null,
        loading: false,
        transfer: { window: null },
        retryNow: () => {},
        retry: () => {},
        version: 0,
        outlineOffset: 0,
        taskState: "idle",
        goal: null,
        older: { hasMore: false, loading: false, error: null, errorCause: null, beyondTail: false },
        prefixItems: [],
      },
      outline: [],
      streamScrollRef: { current: null },
      railFit: { shown: true },
      machineNameOf: () => null,
      onRemoveProcess: () => {},
      exitedIds: [],
      onClearExitedProcesses: () => {},
      anySubagentPending: false,
      hs: {
        tokensText: "0",
        costText: null,
        costUncosted: false,
        elapsedNode: "0s",
        elapsedSplit: [],
      },
      cacheHitRate: null,
      sessionAgentName: null,
      headerActivity: null,
      backgroundCount: 0,
      navigate: () => {},
      location: { key: "k" },
      company: { workMode: "dev" },
      projectId: "p",
      sessionsLoading: false,
      machineLabels: new Map(),
      removeSession: () => {},
      replace: () => {},
      models: [],
      parkedDraftId: null,
      draft: null,
      pageMachineId: null,
      onDraftWorkspace: () => {},
      onDraftAgent: () => {},
      setFetchedSession: () => {},
      routed: null,
      failureShown: null,
      setFailureShown: () => {},
      activeModelRef: null,
      routeSessionOwner: null,
      routeSessionPending: false,
      routeSessionOffline: false,
      routeOutcome: null,
      composerRef: { current: null },
      addComposerReference: () => {},
      newChat: () => {},
      ctx: null,
      rightMount: { view: null, open: false, animateEntrance: false },
      bottomMount: { view: null, open: false, animateEntrance: false },
      chatDock: {},
      emptyChat: true,
      input: null,
      allItems: [],
      coveredByWorkbench: "",
    } as unknown as MainChatView;
    const page = await mount(
      h("div", null, renderMainChatToolbar(scope), renderMainChatBody(scope)),
    );

    // The toolbar row and the dock area the cover hides: present, laid out, visible.
    const row = page.container.querySelector('div[class*="border-b border-gray-200 px-3"]');
    expect(row).not.toBeNull();
    const area = page.container.querySelector("[data-dock-area]");
    expect(area).not.toBeNull();
    expect(row!.className).not.toContain("invisible");
    expect(area!.className).not.toContain("invisible");

    // Covered: hidden by visibility, so the box keeps its place and size — nothing reflows
    // when the cover opens, and no dock layer above the page shows through. The same element
    // stays mounted: hiding is a class, not an unmount.
    scope.coveredByWorkbench = "invisible";
    await page.rerender(h("div", null, renderMainChatToolbar(scope), renderMainChatBody(scope)));
    expect(row!.className).toContain("invisible");
    expect(area!.className).toContain("invisible");
    expect(row!.className).not.toContain("hidden");
    expect(area!.className).not.toContain("hidden");
    expect(page.container.contains(row!)).toBe(true);
    expect(page.container.contains(area!)).toBe(true);

    // Back to chat: uncovered, the same nodes shown again.
    scope.coveredByWorkbench = "";
    await page.rerender(h("div", null, renderMainChatToolbar(scope), renderMainChatBody(scope)));
    expect(row!.className).not.toContain("invisible");
    expect(area!.className).not.toContain("invisible");
    expect(page.container.contains(row!)).toBe(true);
    expect(page.container.contains(area!)).toBe(true);
  });
  it("does not paint what the page covers, so no dock layer shows through it", () => {
    // Source-shape auxiliary to the behavioral tests above: the wiring the cover rides on.
    // The tab owns the cover: it draws the strip and the frame that lies over the page.
    // session-tab names its tab store `workflowTabs` (chat-page calls the same one `workbenchTabs`).
    const read = (rel: string) =>
      readFileSync(join(process.cwd(), "src", rel), "utf8").replace(/\s+/g, " ");
    expect(read("features/workbenches/session-tab.tsx")).toContain(
      `{workflowTabs.activeTab !== null && projectId !== null && pageAgentId !== null && ( <div className="absolute inset-x-0 bottom-0 top-9 z-10">`,
    );
    // The page collects the tabs' reports into the one hiding class...
    expect(read("features/chat/chat-page.tsx")).toContain(
      `const coveredByWorkbench = coveredTabs.size > 0 ? "invisible" : "";`,
    );
    // ...and paints it on what the cover hides.
    expect(read("features/chat/toolbar/main-chat-toolbar.tsx")).toMatch(
      /\{selected && \( <div className=\{`[^`]*\$\{coveredByWorkbench\}`\}/,
    );
    expect(read("features/chat/body/main-chat-body.tsx")).toMatch(
      /<div data-dock-area className=\{`[^`]*\$\{coveredByWorkbench\}`\}>/,
    );
  });
});
