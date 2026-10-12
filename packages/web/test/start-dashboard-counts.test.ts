// @vitest-environment jsdom
/**
 * The start page's toolkit and Benchmark counts follow the server while the page stays open
 * (features/chat/use-start-dashboard.ts, features/benchmark/use-rsi-toolkits.ts), and the Use
 * dialog's Method select reads the toolkits the same way.
 *
 * - Given the page was opened once, when an admin installs a toolkit (or removes one) and the
 *   user comes back to the page, then the toolkit count shows the earlier number until the fresh
 *   library lands and the new number after it — without a reload.
 * - Given a Benchmark imported between two visits, then the Benchmark count follows the same way.
 * - Given a later read fails, then the earlier count stays on screen; given the very first read
 *   fails, then there is no count to show.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { mount, settle, unmountAll } from "./helpers/dom";

type Counts = typeof import("../src/features/chat/use-start-dashboard");

/** A fresh copy of the hooks, so one test's last-read lists never seed another's. */
async function freshCounts(): Promise<Counts> {
  vi.resetModules();
  return import("../src/features/chat/use-start-dashboard");
}

/** What the start page's panel shows for the two counts: a number, or "—" while there is none. */
async function visit(counts: Counts, projectId = "p1") {
  function Probe() {
    const toolkits = counts.useRsiToolkits();
    const { benchmarks } = counts.useProjectBenchmarks(projectId);
    return h("p", null, `${toolkits.value?.length ?? "—"} / ${benchmarks?.length ?? "—"}`);
  }
  return mount(h(Probe));
}

const plugin = (name: string) => ({
  name,
  description: "",
  version: "0.0.0",
  package: `@penguinharness/${name}`,
  source: "builtin",
  skills: [{ name, description: "", version: "" }],
  hooks: [],
  mcpServers: [],
});

/** A server whose library and Benchmark list the test changes between visits. */
function server() {
  const state = {
    toolkits: ["default-rsi-toolkit"],
    benchmarks: ["example-benchmark"],
    down: false,
  };
  const gates: Array<() => void> = [];
  let holding = false;
  const fetch = stubFetch(async (request) => {
    if (holding) await new Promise<void>((resolve) => gates.push(resolve));
    if (state.down) return apiError(503, "unavailable");
    if (request.path === "/api/plugins") {
      return json({
        groups: [{ id: "rsi", title: "Agent Self-Evolution", plugins: state.toolkits.map(plugin) }],
      });
    }
    if (request.path === "/api/projects/p1/benchmarks") {
      return json({ benchmarks: state.benchmarks.map((id) => ({ id })) });
    }
    return apiError(404, "not_found");
  });
  return {
    state,
    fetch,
    /** Holds every later answer until {@link release}. */
    hold() {
      holding = true;
    },
    async release() {
      holding = false;
      for (const open of gates.splice(0)) open();
      await settle();
    },
  };
}

afterEach(async () => {
  await unmountAll();
});

describe("start page counts", () => {
  it("show a toolkit installed after the first visit on the next one, without a reload", async () => {
    const counts = await freshCounts();
    const srv = server();
    const first = await visit(counts);
    await settle();
    expect(first.container.textContent).toBe("1 / 1");
    await first.unmount();

    srv.state.toolkits.push("opro-rsi-toolkit", "ape-rsi-toolkit");
    srv.hold();
    const second = await visit(counts);
    // The earlier numbers while the fresh lists are on their way, never "—".
    expect(second.container.textContent).toBe("1 / 1");
    await srv.release();
    expect(second.container.textContent).toBe("3 / 1");
    await second.unmount();

    srv.state.toolkits.splice(1, 1);
    const third = await visit(counts);
    await settle();
    expect(third.container.textContent).toBe("2 / 1");
  });

  it("show a Benchmark imported between two visits", async () => {
    const counts = await freshCounts();
    const srv = server();
    const first = await visit(counts);
    await settle();
    await first.unmount();

    srv.state.benchmarks.push("penguinharness-benchmark-sec-a");
    const second = await visit(counts);
    await settle();

    expect(second.container.textContent).toBe("1 / 2");
  });

  it("keep the earlier counts when a later read fails, and have none when the first one does", async () => {
    const counts = await freshCounts();
    const srv = server();
    srv.state.down = true;
    const never = await visit(counts);
    await settle();
    expect(never.container.textContent).toBe("— / —");
    await never.unmount();

    srv.state.down = false;
    const ok = await visit(counts);
    await settle();
    await ok.unmount();
    srv.state.down = true;
    const failed = await visit(counts);
    await settle();

    expect(failed.container.textContent).toBe("1 / 1");
    expect(srv.fetch.requests.filter((r) => r.path === "/api/plugins")).toHaveLength(3);
  });
});
