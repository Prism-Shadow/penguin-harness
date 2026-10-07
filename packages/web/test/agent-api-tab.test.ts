/**
 * An Agent's public API in the Web App: the Agent page's API tab (features/agents/api-tab.tsx),
 * the Agents list's mark (agents-page.tsx) and the admin's server-wide switch
 * (features/settings/agent-api-section.tsx). The views render to static markup and the
 * confirmations are driven through their handlers against the fetch fake (node env, no DOM).
 *
 * - An Agent whose API is off shows the switch alone: no approval mode, no address, no keys, no
 *   examples.
 * - Enabled, the tab shows the approval mode select on the stored mode, the Base URL and the
 *   Agent ID each with its copy button, and every key by its prefix with when it was created and
 *   last used (or that it never was).
 * - A created key's secret is on screen in its own panel, whose copy button copies exactly the
 *   secret and whose Done hands back; with no secret pending there is no panel.
 * - The examples call the real Base URL and Agent ID, with the key left as $PENGUIN_AGENT_KEY.
 * - With the admin's server-wide switch off, the tab's switch is disabled and says why, to every
 *   member and not only an admin (the tab's own read carries the switch); a member who is not the
 *   owner finds every control disabled, no key actions, and is told why.
 * - Turning the API off asks first, in the danger tone. Answered yes, it writes the switch off
 *   and hands on what the server stored; a failed write is handed on as the failure.
 * - Deleting a key asks first, naming it. Answered yes, it deletes that key and hands on its id;
 *   a refused delete says why and hands on nothing.
 * - The Agents list carries the plug mark, named for screen readers, only on an Agent whose API
 *   is on.
 * - Turning the Agent API off server-wide asks first, in the danger tone; answered yes, it writes
 *   the switch off and hands on what the server stored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  AgentApiKeyInfo,
  AgentApiResponse,
  AgentApiSettings,
} from "@prismshadow/penguin-server/api";
import { Button, CopyButton, Select, ToggleRow } from "@prismshadow/penguin-ui";
import {
  AgentApiOffConfirm,
  ApiTabView,
  DeleteKeyConfirm,
  OneTimeKey,
  agentApiBaseUrl,
  agentApiExamples,
} from "../src/features/agents/api-tab";
import type { ApiTabViewProps } from "../src/features/agents/api-tab";
import { AgentApiMark } from "../src/features/agents/agents-page";
import { AgentApiServerOffConfirm } from "../src/features/settings/agent-api-section";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";

const toasts = vi.hoisted(() => [] as string[]);

vi.mock("@prismshadow/penguin-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prismshadow/penguin-ui")>();
  return {
    ...actual,
    toastSuccess: (text: string) => toasts.push(`success: ${text}`),
    toastError: (text: string) => toasts.push(`error: ${text}`),
  };
});

const USED: AgentApiKeyInfo = {
  keyId: "kq3VtX9cRb2LmN0a",
  name: "docs-site search",
  prefix: "penguin_Zr8kQ2vT",
  createdBy: "admin",
  createdAt: "2026-10-01T08:00:00.000Z",
  lastUsedAt: "2026-10-07T09:30:00.000Z",
};
const FRESH: AgentApiKeyInfo = {
  ...USED,
  keyId: "Hc7pW2sYd4EfJ6uB",
  name: "weekly report",
  prefix: "penguin_4mGxL7pA",
  lastUsedAt: null,
};
const ON: AgentApiSettings = {
  enabled: true,
  open: false,
  approvalMode: "read-only",
  keys: [USED, FRESH],
};
const BASE = agentApiBaseUrl("http://127.0.0.1:7369");
/** Obviously fake and short: no key-shaped literal lives in the tests. */
const SECRET = "penguin_fake-secret";

const noop = () => {};
function props(over: Partial<ApiTabViewProps> = {}): ApiTabViewProps {
  return {
    settings: ON,
    serverEnabled: true,
    isOwner: true,
    busy: false,
    baseUrl: BASE,
    agentRef: "demo/coder",
    draftName: null,
    secret: null,
    onToggleEnabled: noop,
    onApprovalMode: noop,
    onToggleOpen: noop,
    onStartKey: noop,
    onDraftName: noop,
    onCreateKey: noop,
    onCancelKey: noop,
    onSecretDone: noop,
    onDeleteKey: noop,
    ...over,
  };
}
const render = (over: Partial<ApiTabViewProps> = {}) =>
  renderToStaticMarkup(createElement(ApiTabView, props(over)));

/** The props a ConfirmModal element was given. */
type Confirm = ReactElement<{
  open: boolean;
  tone?: string;
  title: string;
  confirmLabel: string;
  children: ReactNode;
  onConfirm: () => void;
}>;

/** Every element of `type` in a tree of plain elements, its children followed. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  return ([] as ReactNode[])
    .concat(node)
    .filter(isValidElement)
    .flatMap((el) => {
      const element = el as ReactElement<{ children?: ReactNode }>;
      const own = element.type === type ? [element as ReactElement<Record<string, unknown>>] : [];
      return [...own, ...find(element.props.children, type)];
    });
}

beforeEach(() => {
  toasts.length = 0;
});

describe("the API tab", () => {
  it("shows the switch alone while the API is off", () => {
    const html = render({ settings: { ...ON, enabled: false } });
    expect(html).toContain(`aria-label="${S.agent.apiEnable}"`);
    expect(html).not.toContain(S.agent.apiApprovalMode);
    expect(html).not.toContain(BASE);
    expect(html).not.toContain(USED.prefix);
    expect(html).not.toContain("PENGUIN_AGENT_KEY");
  });

  it("shows the approval mode, the address with copy buttons and every key by its prefix once on", () => {
    const html = render();
    expect(html).toContain(S.agent.apiApprovalMode);
    expect(html).toContain(S.chat.approvalModeNames["read-only"]);
    expect(html).toContain(BASE);
    expect(html).toContain(`aria-label="${S.agent.apiCopy(S.agent.apiBaseUrl)}"`);
    expect(html).toContain("demo/coder");
    expect(html).toContain(`aria-label="${S.agent.apiCopy(S.agent.apiAgentId)}"`);
    expect(html.split('data-testid="api-key"').length - 1).toBe(2);
    expect(html).toContain(`${USED.prefix}…`);
    expect(html).toContain(`${FRESH.prefix}…`);
    expect(html).toContain(S.agent.apiKeyNever);
  });

  it("puts a created key's secret in its own panel, whose copy button copies exactly it", () => {
    expect(render({ secret: SECRET })).toContain(SECRET);
    expect(find(ApiTabView(props()), OneTimeKey)).toEqual([]);

    const onDone = vi.fn();
    const panel = OneTimeKey({ secret: SECRET, onDone });
    const [copy] = find(panel, CopyButton);
    expect(copy!.props.text).toBe(SECRET);
    const [done] = find(panel, Button);
    (done!.props.onClick as () => void)();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("calls the real Base URL and Agent ID in its examples, the key left to the environment", () => {
    const { curl, sdk } = agentApiExamples(BASE, "demo/coder");
    expect(curl).toContain(`curl -N ${BASE}/agents/demo/coder/runs`);
    expect(curl).toContain("Bearer $PENGUIN_AGENT_KEY");
    expect(sdk).toContain(`baseUrl: "${BASE}"`);
    expect(sdk).toContain(`agent: "demo/coder"`);
    expect(sdk).toContain("process.env.PENGUIN_AGENT_KEY");
    expect(render()).toContain(`${BASE}/agents/demo/coder/runs`);
  });

  it("disables the switch and tells any member why when the admin has the API off server-wide", () => {
    const [toggle] = find(ApiTabView(props({ serverEnabled: false })), ToggleRow);
    expect(toggle!.props.disabled).toBe(true);
    expect(render({ serverEnabled: false })).toContain(S.agent.apiAdminOff);
    expect(render({ serverEnabled: false, isOwner: false })).toContain(S.agent.apiAdminOff);
    expect(render()).not.toContain(S.agent.apiAdminOff);
  });

  it("leaves a member who is not the owner every control disabled and no key action", () => {
    const tree = ApiTabView(props({ isOwner: false }));
    const toggles = find(tree, ToggleRow);
    expect(toggles).toHaveLength(2);
    expect(toggles.every((t) => t.props.disabled === true)).toBe(true);
    expect(find(tree, Select)[0]!.props.disabled).toBe(true);
    const html = render({ isOwner: false });
    expect(html).toContain(S.agent.apiOwnerOnly);
    expect(html).not.toContain(S.agent.apiNewKey);
    expect(html).not.toContain(`aria-label="${S.agent.apiDeleteKey} ${USED.name}"`);
    expect(render()).toContain(`aria-label="${S.agent.apiDeleteKey} ${USED.name}"`);
  });
});

describe("turning an Agent's API off", () => {
  const confirm = (onSettled: (o: unknown) => void, onWriting = noop) =>
    AgentApiOffConfirm({
      open: true,
      projectId: "demo",
      agentId: "coder",
      onClose: noop,
      onWriting,
      onSettled,
    }) as Confirm;

  it("asks first in the danger tone; answered yes, writes it off and hands on what was stored", async () => {
    const stored: AgentApiResponse = { api: { ...ON, enabled: false }, serverEnabled: true };
    const fetch = stubFetch(() => json(stored));
    const onWriting = vi.fn();
    const onSettled = vi.fn();
    const question = confirm(onSettled, onWriting);
    expect(question.props.tone).toBeUndefined();
    expect(question.props.title).toBe(S.agent.apiOffTitle);
    expect(fetch.requests).toEqual([]);
    question.props.onConfirm();
    expect(onWriting).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledExactlyOnceWith(stored));
    expect(fetch.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["PUT", "/api/projects/demo/agents/coder/api", { enabled: false }],
    ]);
  });

  it("hands on a failed write as the failure", async () => {
    stubFetch(() => apiError(403, "forbidden"));
    const onSettled = vi.fn();
    confirm(onSettled).props.onConfirm();
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
    expect(onSettled.mock.calls[0]![0]).toHaveProperty("error");
  });
});

describe("deleting a key", () => {
  it("asks first, naming the key; answered yes, deletes it and hands on its id", async () => {
    const fetch = stubFetch(() => new Response(null, { status: 204 }));
    const onDeleted = vi.fn();
    const question = DeleteKeyConfirm({
      record: USED,
      projectId: "demo",
      agentId: "coder",
      onClose: noop,
      onDeleted,
    }) as Confirm;
    expect(question.props.open).toBe(true);
    expect(question.props.tone).toBeUndefined();
    expect(renderToStaticMarkup(question.props.children as ReactElement)).toContain(
      S.agent.apiDeleteKeyBody(USED.name),
    );
    expect(fetch.requests).toEqual([]);
    question.props.onConfirm();
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledExactlyOnceWith(USED.keyId));
    expect(fetch.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `DELETE /api/projects/demo/agents/coder/api/keys/${USED.keyId}`,
    ]);
  });

  it("says why a refused delete failed, and hands on nothing", async () => {
    stubFetch(() => apiError(404, "key_not_found", "No such key."));
    const onDeleted = vi.fn();
    (
      DeleteKeyConfirm({
        record: USED,
        projectId: "demo",
        agentId: "coder",
        onClose: noop,
        onDeleted,
      }) as Confirm
    ).props.onConfirm();
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0]).toMatch(/^error: /);
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe("the Agents list", () => {
  it("marks an Agent whose API is on with the plug, named for screen readers, and no other", () => {
    const on = renderToStaticMarkup(createElement(AgentApiMark, { enabled: true }));
    expect(on).toContain(`data-tooltip="${S.agent.apiOn}"`);
    expect(on).toContain(`<span class="sr-only">${S.agent.apiOn}</span>`);
    expect(renderToStaticMarkup(createElement(AgentApiMark, { enabled: false }))).toBe("");
  });
});

describe("the server-wide switch", () => {
  it("asks first in the danger tone; answered yes, writes it off and hands on what was stored", async () => {
    const fetch = stubFetch(() => json({ settings: { agentApiEnabled: false } }));
    const onSettled = vi.fn();
    const question = AgentApiServerOffConfirm({
      open: true,
      onClose: noop,
      onWriting: noop,
      onSettled,
    }) as Confirm;
    expect(question.props.tone).toBeUndefined();
    expect(fetch.requests).toEqual([]);
    question.props.onConfirm();
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledExactlyOnceWith({ enabled: false }));
    expect(fetch.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["PUT", "/api/admin/settings", { agentApiEnabled: false }],
    ]);
  });
});
