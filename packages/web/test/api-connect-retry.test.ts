/**
 * A call about a Session on a machine raises that machine's forward itself (api/client.ts).
 *
 * A forward does not survive a restart, so the FIRST call about a Session that lives
 * elsewhere is answered `not_connected` by the machines proxy. Handing the reader
 * "connect to it first" makes plumbing their problem — every one of the two dozen
 * Session-scoped endpoints would have to offer it, and none of them can do anything with it.
 *
 * What is pinned here: the retry happens, it happens ONCE, it is scoped to that one error
 * from a machine (never this server, never another failure), and a connector that reports
 * the machine did not come up leaves the original error for the caller to show.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, setMachineConnector } from "../src/api/client";
import { rememberSessionMachine, forgetSessionMachines } from "../src/lib/session-machines";

const notConnected = () =>
  new Response(
    JSON.stringify({ error: { code: "not_connected", message: "No live forward to m1" } }),
    { status: 503, headers: { "content-type": "application/json" } },
  );

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const forbidden = () =>
  new Response(JSON.stringify({ error: { code: "forbidden", message: "no" } }), { status: 403 });

/** Responses in order; the returned mock records every call. */
function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn(() => Promise.resolve(responses.shift() ?? ok({})));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  forgetSessionMachines();
  // The routing rule is over the path: a call about s1 goes to the machine that holds it.
  rememberSessionMachine("s1", "m1");
});

afterEach(() => {
  setMachineConnector(null);
  forgetSessionMachines();
  vi.unstubAllGlobals();
});

describe("connect-and-retry", () => {
  it("raises the forward and asks again, which the caller never sees fail", async () => {
    const fetchMock = stubFetch(notConnected(), ok({ ok: true }));
    const connect = vi.fn(() => Promise.resolve(true));
    setMachineConnector(connect);

    await expect(apiFetch("/api/sessions/s1/messages")).resolves.toEqual({ ok: true });
    expect(connect).toHaveBeenCalledWith("m1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a POST too — the proxy answers before forwarding, so nothing was applied", async () => {
    const fetchMock = stubFetch(notConnected(), ok({ id: "t1" }));
    setMachineConnector(() => Promise.resolve(true));

    await expect(
      apiFetch("/api/sessions/s1/tasks", { method: "POST", body: { text: "hi" } }),
    ).resolves.toEqual({ id: "t1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives the caller the error when the machine did not come up", async () => {
    const fetchMock = stubFetch(notConnected());
    const connect = vi.fn(() => Promise.resolve(false));
    setMachineConnector(connect);

    await expect(apiFetch("/api/sessions/s1/messages")).rejects.toMatchObject({
      code: "not_connected",
      status: 503,
    });
    expect(connect).toHaveBeenCalledTimes(1);
    // Not asked again: the connector already ran its whole schedule.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once, not until it works", async () => {
    // A machine that reports connected while its forward is already gone again would
    // otherwise spin here.
    const fetchMock = stubFetch(notConnected(), notConnected());
    setMachineConnector(() => Promise.resolve(true));

    await expect(apiFetch("/api/sessions/s1/messages")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves every other failure alone", async () => {
    const fetchMock = stubFetch(forbidden());
    const connect = vi.fn(() => Promise.resolve(true));
    setMachineConnector(connect);

    await expect(apiFetch("/api/sessions/s1/messages")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(connect).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never tries to connect to this server", async () => {
    // A local path has no machine to raise; `not_connected` from here would be about
    // something else entirely, and connecting to null is not a thing.
    const fetchMock = stubFetch(notConnected());
    const connect = vi.fn(() => Promise.resolve(true));
    setMachineConnector(connect);

    await expect(apiFetch("/api/projects/p1/agents")).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(connect).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("with no connector registered, behaves as it did before there was one", async () => {
    const fetchMock = stubFetch(notConnected());
    setMachineConnector(null);

    await expect(apiFetch("/api/sessions/s1/messages")).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
