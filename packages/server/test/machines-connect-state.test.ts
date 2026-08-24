/**
 * Per-machine connect state: the remembered tunnel port and the ssh pid holding it.
 *
 * The port is load-bearing rather than cosmetic — the app origin is
 * `http://localhost:<port>` and a browser buckets cookies and localStorage per origin, so a
 * machine whose port drifts loses everything remembered about it. These cases pin that a
 * remembered port is tried FIRST, and that damage degrades to "nothing remembered" instead
 * of taking the file down with it.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_PORT } from "@prismshadow/penguin-core";
import {
  parseConnectState,
  pickTunnelPort,
  withConnectState,
} from "../src/machines/connect-state.js";

const state = { port: 7364, tunnelPid: 4242, connectedAt: "2026-08-24T12:00:00.000Z" };

describe("parseConnectState", () => {
  it("reads back what withConnectState wrote", () => {
    expect(parseConnectState(withConnectState(null, "ssh:nas", state))).toEqual({
      "ssh:nas": state,
    });
  });

  it("treats absence, emptiness and damage alike", () => {
    for (const raw of [null, "", "  ", "{ not json", "[]", "null", '"str"']) {
      expect(parseConnectState(raw)).toEqual({});
    }
  });

  it("drops entries with no usable port — the port is the whole point of the record", () => {
    const raw = JSON.stringify({
      "ssh:ok": { port: 7364 },
      "ssh:no-port": { tunnelPid: 1 },
      "ssh:zero": { port: 0 },
      "ssh:huge": { port: 70000 },
      "ssh:fractional": { port: 7364.5 },
      "ssh:string": { port: "7364" },
    });
    expect(parseConnectState(raw)).toEqual({ "ssh:ok": { port: 7364 } });
  });

  it("keeps a port while dropping a nonsensical pid — the tunnel is gone, the port is not", () => {
    const raw = JSON.stringify({ "ssh:nas": { port: 7364, tunnelPid: -1 } });
    expect(parseConnectState(raw)).toEqual({ "ssh:nas": { port: 7364 } });
  });

  it("null forgets one machine and leaves the rest", () => {
    let raw = withConnectState(null, "ssh:a", state);
    raw = withConnectState(raw, "ssh:b", { port: 7365 });
    expect(parseConnectState(withConnectState(raw, "ssh:a", null))).toEqual({
      "ssh:b": { port: 7365 },
    });
  });
});

describe("pickTunnelPort", () => {
  const free = async () => false;
  const busy = async () => true;

  it("prefers the remembered port, so a machine keeps its origin across reconnects", async () => {
    expect(await pickTunnelPort({ remembered: 7401, busy: free })).toBe(7401);
  });

  it("falls to the well-known port when nothing is remembered", async () => {
    expect(await pickTunnelPort({ remembered: undefined, busy: free })).toBe(DEFAULT_SERVER_PORT);
  });

  it("shifts forward past whatever is taken locally", async () => {
    const taken = new Set([DEFAULT_SERVER_PORT, DEFAULT_SERVER_PORT + 1]);
    expect(await pickTunnelPort({ remembered: undefined, busy: async (p) => taken.has(p) })).toBe(
      DEFAULT_SERVER_PORT + 2,
    );
  });

  it("shifts off a remembered port that is busy now, rather than failing", async () => {
    expect(await pickTunnelPort({ remembered: 7401, busy: async (p) => p === 7401 })).toBe(
      DEFAULT_SERVER_PORT,
    );
  });

  it("gives up rather than searching forever when everything is taken", async () => {
    expect(await pickTunnelPort({ remembered: 7401, busy })).toBeNull();
  });

  it("never offers the same number twice, even when it is also the remembered one", async () => {
    const seen: number[] = [];
    await pickTunnelPort({
      remembered: DEFAULT_SERVER_PORT,
      busy: async (p) => {
        seen.push(p);
        return true;
      },
    });
    expect(new Set(seen).size).toBe(seen.length);
  });
});
