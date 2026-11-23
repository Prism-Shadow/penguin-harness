/**
 * short-id-lookup.ts: the lookup id a `/chat/<sessionId>` route asks for. A full id is asked
 * for as it stands; an 8-hex short id is resolved first — freshly, over what each server of
 * the Project answers for right now, never over a loaded page or an organization snapshot, so
 * a cold start resolves like a warm one — and it opens only when exactly one readable Session
 * ends in it, on any of the servers asked.
 */
import { describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import {
  SHORT_LOOKUP_PAGE_SIZE,
  createSourceListing,
  resolveRouteLookupId,
} from "../src/features/chat/session/short-id-lookup";

const row = (sessionId: string, overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  sessionId,
  projectId: "project-a",
  agentId: "default_agent",
  provider: "anthropic",
  modelId: "claude-sonnet-4",
  workspace: "/workspace",
  approvalMode: "allow-all",
  sandbox: { mode: "danger-full-access", network: "open" },
  createdAt: "2026-11-10T10:40:17.000Z",
  lastActiveAt: "2026-11-10T10:40:17.000Z",
  status: "idle",
  pendingApprovalCount: 0,
  pendingFollowUpCount: 0,
  hasTrace: true,
  archived: false,
  ...overrides,
});

const FULL = "session-2026-11-10-10-40-17-2556a209";
const SHORT = "2556a209";

describe("resolveRouteLookupId", () => {
  it("asks for a full id as it stands, without enumerating anything", async () => {
    const listing = vi.fn();
    await expect(resolveRouteLookupId(FULL, ["machine-1"], listing)).resolves.toEqual({
      sessionId: FULL,
    });
    expect(listing).not.toHaveBeenCalled();
  });

  it("resolves a short id against a fresh listing on a cold start (nothing else loaded)", async () => {
    // The one source the enumeration reads is the server's own answer; no list, no snapshot.
    const listing = vi.fn(async () => [row("session-2026-11-01-00-00-00-deadbeef"), row(FULL)]);
    await expect(resolveRouteLookupId(SHORT, [], listing)).resolves.toEqual({
      sessionId: FULL,
      machineId: null,
    });
  });

  it("reads every server, keeps this server's row when both name the same Session", async () => {
    const listing = vi.fn(async (machineId: string | null) =>
      machineId === "machine-1" ? [row(FULL)] : [row(FULL, { status: "running" })],
    );
    await expect(resolveRouteLookupId(SHORT, ["machine-1"], listing)).resolves.toEqual({
      sessionId: FULL,
      machineId: null,
    });
  });

  it("hands the machine's row back with its server when only the machine holds it", async () => {
    const listing = vi.fn(async (machineId: string | null) =>
      machineId === null ? [] : [row(FULL)],
    );
    await expect(resolveRouteLookupId(SHORT, ["machine-1"], listing)).resolves.toEqual({
      sessionId: FULL,
      machineId: "machine-1",
    });
  });

  it("refuses a suffix two servers resolve to different Sessions for", async () => {
    const twin = "session-2026-11-11-09-00-00-2556a209";
    const listing = vi.fn(async (machineId: string | null) =>
      machineId === "machine-1" ? [row(twin)] : [row(FULL)],
    );
    await expect(resolveRouteLookupId(SHORT, ["machine-1"], listing)).resolves.toBeNull();
  });

  it("refuses a suffix two rows of one server share, and a suffix nothing ends in", async () => {
    const twin = "session-2026-11-11-09-00-00-2556a209";
    const both = vi.fn(async () => [row(FULL), row(twin)]);
    await expect(resolveRouteLookupId(SHORT, [], both)).resolves.toBeNull();
    const none = vi.fn(async () => [row("session-2026-11-01-00-00-00-deadbeef")]);
    await expect(resolveRouteLookupId(SHORT, [], none)).resolves.toBeNull();
  });

  it("candidates that are not canonical session ids never count", async () => {
    const listing = vi.fn(async () => [row("note-2026-11-10-10-40-17-2556a209"), row("other")]);
    await expect(resolveRouteLookupId(SHORT, [], listing)).resolves.toBeNull();
  });
});

describe("createSourceListing", () => {
  const agent = { agentId: "default_agent" };

  const reader = (pages: SessionInfo[][]) => ({
    listAgents: vi.fn(async () => ({ agents: [agent] })),
    batchSessions: vi.fn(async (
      _projectId: string,
      _requests: { agentId: string; limit: number; offset: number }[],
      _machineId: string | null,
    ) => {
      const index = _requests[0]!.offset / SHORT_LOOKUP_PAGE_SIZE;
      const page = pages[index] ?? [];
      return {
        results: [
          page.length === 0
            ? { agentId: agent.agentId, ok: false, reason: "absent" as const }
            : { agentId: agent.agentId, ok: true as const, sessions: page },
        ],
      };
    }),
  });

  it("pages a source whole until a short page, and skips the Agents it cannot answer for", async () => {
    const full = Array.from({ length: SHORT_LOOKUP_PAGE_SIZE }, (_, i) =>
      row(`session-2026-11-10-10-40-17-${String(i % 16).padStart(8, "0")}`),
    );
    const r = reader([full, [row(FULL)]]);
    const listing = createSourceListing("project-a", r);
    await expect(listing(null)).resolves.toEqual([...full, row(FULL)]);
    expect(r.batchSessions).toHaveBeenCalledTimes(2);
    expect(r.batchSessions.mock.calls[0]![1][0]).toEqual({
      agentId: agent.agentId,
      limit: SHORT_LOOKUP_PAGE_SIZE,
      offset: 0,
    });
    expect(r.batchSessions.mock.calls[1]![1][0]).toEqual({
      agentId: agent.agentId,
      limit: SHORT_LOOKUP_PAGE_SIZE,
      offset: SHORT_LOOKUP_PAGE_SIZE,
    });
  });

  it("asks each source for the Agents it holds, on the source the listing names", async () => {
    const r = reader([[row(FULL)]]);
    await createSourceListing("project-a", r)("machine-1");
    expect(r.listAgents).toHaveBeenCalledWith("project-a", "machine-1");
    expect(r.batchSessions).toHaveBeenCalledWith(
      "project-a",
      [{ agentId: agent.agentId, limit: SHORT_LOOKUP_PAGE_SIZE, offset: 0 }],
      "machine-1",
    );
  });
});
