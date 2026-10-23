// @vitest-environment jsdom
/**
 * The Machine dialog's notice about model keys only this server's environment holds
 * (features/machines/machine-detail-dialog.tsx, lib/notice-dismissals.ts), through the real dialog,
 * the real prefs client and a fake server that outlives each page.
 *
 * - Given a sync that left env-only keys, the notice stays off screen until the account's
 *   preferences are read, then shows with a close cross beside the skipped-models list.
 * - Given the person closes it, it goes at once and the whole map is written, keeping the other
 *   notices already closed; a fresh page keeps it closed for the same keys.
 * - Given a new env-only key on the next sync, a fresh page shows it again; a key that went away
 *   does not.
 * - Given another machine with the same keys, its notice is its own.
 * - Given preferences that cannot be read, the notice shows (fail-open), and closing it hides it
 *   for this page without writing a map that was never read.
 */
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MachineEnvOnly, MachineInfo, UiPrefs } from "@prismshadow/penguin-server/api";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { button, click, hasButton, mount, settle, unmountAll, waitFor } from "./helpers/dom";

const OPENAI: MachineEnvOnly = {
  projectId: "p1",
  provider: "openai",
  modelId: "gpt-5",
  variable: "OPENAI_API_KEY",
};
const DEEPSEEK: MachineEnvOnly = {
  projectId: "p1",
  provider: "deepseek",
  modelId: "deepseek-chat",
  variable: "DEEPSEEK_API_KEY",
};

const machine = (id: string, envOnly: MachineEnvOnly[]): MachineInfo => ({
  id,
  alias: id.replace(/^ssh:/, ""),
  installed: { version: "0.2.16", at: "2026-10-01T08:00:00.000Z" },
  machineId: "M0000000000000001",
  local: false,
  connection: { pid: 4242 },
  socket: null,
  keepConnected: true,
  api: null,
  status: { state: "running", checkedAt: "2026-10-15T08:00:00.000Z", port: 7364 },
  root: "/home/ubuntu/.penguin/data",
  configSync: {
    at: "2026-10-15T08:00:00.000Z",
    ok: true,
    envOnly,
    skipped: [
      {
        projectId: "p1",
        provider: "penguin-go",
        modelId: "gemini-3.7-flash",
        code: "model_not_addable",
        reason: "cannot be added",
      },
    ],
  },
});

/** The account's preferences, kept across pages as the server keeps them. */
function server(initial: UiPrefs, { unreadable = false } = {}) {
  let prefs: UiPrefs = initial;
  let held: (() => void) | null = null;
  const fetch = stubFetch(async (req) => {
    if (req.path === "/api/me/prefs") {
      if (unreadable) return apiError(500, "internal", "prefs unavailable");
      if (req.method === "PUT") prefs = { ...prefs, ...(req.body as UiPrefs) };
      else if (held !== null) await new Promise<void>((resolve) => (held = resolve));
      return json({ prefs });
    }
    return apiError(404, "not_found");
  });
  return {
    holdReads: () => {
      held = () => {};
    },
    release: () => {
      const go = held;
      held = null;
      go?.();
    },
    writes: () => fetch.requests.filter((r) => r.method === "PUT" && r.path === "/api/me/prefs"),
    prefs: () => prefs,
  };
}

/** A fresh page: new modules (an unread store), the dialog open on `info`. */
async function page(info: MachineInfo) {
  vi.resetModules();
  const { MachineDetailDialog } = await import("../src/features/machines/machine-detail-dialog");
  const { setActiveStrings } = await import("../src/lib/strings");
  const { en } = await import("../src/lib/strings-en");
  setActiveStrings(en);
  await mount(
    h(MachineDetailDialog, {
      projectId: "p1",
      hostEpoch: 0,
      machine: info,
      job: null,
      imageVersion: "0.2.16",
      locale: "en",
      error: null,
      busy: false,
      noImage: false,
      onAct: () => {},
      onClose: () => {},
    }),
  );
  const notice = () => document.querySelector("[data-env-only]") !== null;
  return { notice, envOnlyText: en.machines.detail.configSync.envOnly };
}

afterEach(async () => {
  await unmountAll();
});

describe("the env-only keys notice", () => {
  it("stays off screen until the account is read, then shows with a close cross beside the skipped list", async () => {
    const srv = server({});
    srv.holdReads();
    const shown = await page(machine("ssh:gpu-a100", [OPENAI]));
    await settle();
    expect(shown.notice()).toBe(false);
    expect(document.querySelector("[data-skipped]")).not.toBeNull();
    srv.release();
    await waitFor(shown.notice);
    expect(document.body.textContent).toContain(shown.envOnlyText);
    expect(hasButton("Dismiss")).toBe(true);
  });

  it("closes at once, writes the whole map keeping other closed notices, and stays closed on a fresh page", async () => {
    const other = { "machine-env-only:ssh:nas": "p1/openai/gpt-5:OPENAI_API_KEY" };
    const srv = server({ noticesDismissed: other });
    const first = await page(machine("ssh:gpu-a100", [OPENAI]));
    await waitFor(first.notice);
    await click(button("Dismiss"));
    expect(first.notice()).toBe(false);
    await waitFor(() => srv.writes().length === 1);
    expect(srv.prefs().noticesDismissed).toEqual({
      ...other,
      "machine-env-only:ssh:gpu-a100": "p1/openai/gpt-5:OPENAI_API_KEY",
    });
    // The skipped-models list is not part of what was closed.
    expect(document.querySelector("[data-skipped]")).not.toBeNull();

    await unmountAll();
    const again = await page(machine("ssh:gpu-a100", [OPENAI]));
    await waitFor(
      () => srv.writes().length === 1 && document.querySelector("[data-skipped]") !== null,
    );
    await settle();
    expect(again.notice()).toBe(false);
  });

  it("comes back for a new env-only key, not for one that went away, and is its own per machine", async () => {
    const srv = server({
      noticesDismissed: {
        "machine-env-only:ssh:gpu-a100": [
          "p1/deepseek/deepseek-chat:DEEPSEEK_API_KEY",
          "p1/openai/gpt-5:OPENAI_API_KEY",
        ].join("\n"),
      },
    });
    const fewer = await page(machine("ssh:gpu-a100", [OPENAI]));
    await waitFor(() => document.querySelector("[data-skipped]") !== null);
    await settle();
    expect(fewer.notice()).toBe(false);

    await unmountAll();
    const more = await page(
      machine("ssh:gpu-a100", [
        OPENAI,
        DEEPSEEK,
        { ...OPENAI, modelId: "gpt-6", variable: "OPENAI_API_KEY" },
      ]),
    );
    await waitFor(more.notice);

    await unmountAll();
    const elsewhere = await page(machine("ssh:build-box", [OPENAI]));
    await waitFor(elsewhere.notice);
    expect(srv.writes()).toHaveLength(0);
  });

  it("shows when the account cannot be read, and closing it then hides it without writing", async () => {
    const srv = server({}, { unreadable: true });
    const shown = await page(machine("ssh:gpu-a100", [OPENAI]));
    await waitFor(shown.notice);
    await click(button("Dismiss"));
    expect(shown.notice()).toBe(false);
    await settle();
    expect(srv.writes()).toHaveLength(0);
  });
});
