// @vitest-environment jsdom
/**
 * An Agent settings page's Copy agent dialog (features/agents/copy-agent-dialog.tsx), a record
 * dialog under the settings commit model.
 *
 * - It opens with the copy's name as "<name> copy" and no id, and Copy waits for an id that keeps
 *   the naming rule.
 * - Copy asks the server the source lives on for a new Agent with that id and name, copied from
 *   the source, and hands the new id on.
 * - A refused copy (a taken id) leaves the dialog open with the reason under the id.
 * - Closing it untouched closes at once; closing after an edit asks first.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Fragment, createElement as h } from "react";
import type { ReactElement } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { UnsavedPrompt } from "../src/lib/unsaved/unsaved-prompt";
import { CopyAgentDialog } from "../src/features/agents/copy-agent-dialog";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FakeFetch } from "./helpers/fetch";
import { button, click, field, hasButton, mount, type, unmountAll, waitFor } from "./helpers/dom";

const a = en.agent;
const promptOpen = () => hasButton(en.common.discard);
const withPrompt = (element: ReactElement) => h(Fragment, null, element, h(UnsavedPrompt));

/** The copy the server answers with: the id asked for, the rest copied. */
const created = (agentId: string, name: string) =>
  ({
    agentId,
    name,
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T00:00:00Z",
    activeSessionCount: 0,
    sessionCount: 0,
    apiEnabled: false,
  }) as unknown as AgentSummary;

describe("the Copy agent dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  let fetch: FakeFetch;
  async function openCopy(machineId: string | null = null, refuse = false) {
    fetch = stubFetch(({ method, path, body }) => {
      if (method === "POST" && path === "/api/projects/p1/agents") {
        if (refuse) return apiError(409, "agent_exists", "Agent id is already taken: method_b.");
        const req = body as { agentId: string; name?: string };
        return json({ agent: created(req.agentId, req.name ?? "Baseline") }, 201);
      }
      return apiError(404, "not_found");
    });
    const onClose = vi.fn();
    const onCopied = vi.fn(async () => {});
    await mount(
      withPrompt(
        h(CopyAgentDialog, {
          open: true,
          projectId: "p1",
          sourceId: "baseline",
          sourceName: "Baseline",
          machineId,
          onClose,
          onCopied,
        }),
      ),
    );
    return { onClose, onCopied };
  }
  const creates = () =>
    fetch.requests.filter((r) => r.method === "POST" && r.path === "/api/projects/p1/agents");

  it("opens with the copy's name and no id, and waits for a valid id", async () => {
    await openCopy();
    expect(field(en.common.name).value).toBe(a.copyNameOf("Baseline"));
    expect(field(a.id).value).toBe("");
    expect(button(a.copyConfirm).disabled).toBe(true);
    await type(field(a.id), "Not An Id!");
    expect(button(a.copyConfirm).disabled).toBe(true);
    await type(field(a.id), "method_b");
    expect(button(a.copyConfirm).disabled).toBe(false);
  });

  it("copies the source on the server it lives on, and hands the new id on", async () => {
    const { onCopied } = await openCopy("M7kQ2vT9cRb2LmN0");
    await type(field(en.common.name), "Method B");
    await type(field(a.id), "method_b");
    await click(button(a.copyConfirm));
    await waitFor(() => onCopied.mock.calls.length > 0);

    expect(creates().map((r) => [r.machine, r.body])).toEqual([
      ["M7kQ2vT9cRb2LmN0", { agentId: "method_b", name: "Method B", copyFrom: "baseline" }],
    ]);
    expect(onCopied).toHaveBeenCalledWith("method_b");
  });

  it("keeps the dialog open with the reason under the id when the copy is refused", async () => {
    const { onCopied, onClose } = await openCopy(null, true);
    await type(field(a.id), "method_b");
    await click(button(a.copyConfirm));
    await waitFor(() => document.body.textContent?.includes("already taken") ?? false);

    expect(onCopied).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(field(a.id).value).toBe("method_b");
  });

  it("closes untouched at once, and asks once something was typed", async () => {
    const untouched = await openCopy();
    await click(button(en.common.cancel));
    expect(promptOpen()).toBe(false);
    expect(untouched.onClose).toHaveBeenCalledTimes(1);
    await unmountAll();

    const edited = await openCopy();
    await type(field(a.id), "method_b");
    await click(button(en.common.cancel));
    expect(promptOpen()).toBe(true);
    expect(edited.onClose).not.toHaveBeenCalled();
  });
});
