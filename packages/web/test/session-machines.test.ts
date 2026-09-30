/**
 * The routing rule (lib/session-machines.ts): a call about a Session goes to the machine the
 * Session lives on, read off the PATH, so two dozen call sites need no machine argument.
 * Pinned: which paths the rule reads, which it deliberately does not, and that absence means
 * this server.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  forgetSessionMachines,
  machineForPath,
  machineForSession,
  rememberLinkedMachine,
  rememberSessionMachine,
  sessionIdInPath,
} from "../src/lib/session-machines";

afterEach(() => forgetSessionMachines());

describe("the session id in a path", () => {
  it("reads /api/sessions/<id> and everything beneath it", () => {
    expect(sessionIdInPath("/api/sessions/abc")).toBe("abc");
    expect(sessionIdInPath("/api/sessions/abc/messages?limit=5")).toBe("abc");
    expect(sessionIdInPath("/api/sessions/abc/files/content?path=%2Fx")).toBe("abc");
  });

  it("decodes an escaped id, and keeps a malformed escape rather than losing the id", () => {
    expect(sessionIdInPath("/api/sessions/a%20b/stream")).toBe("a b");
    expect(sessionIdInPath("/api/sessions/%E0%A4%A/stream")).toBe("%E0%A4%A");
  });

  it("is deliberately narrow: the project-scoped listing asks a server which Sessions IT has", () => {
    expect(sessionIdInPath("/api/projects/p/agents/a/sessions")).toBeNull();
    expect(sessionIdInPath("/api/sessions")).toBeNull();
    expect(sessionIdInPath("/api/me")).toBeNull();
  });
});

describe("where a Session lives", () => {
  it("absence means this server, and null is stored as absence", () => {
    expect(machineForSession("s1")).toBeNull();
    rememberSessionMachine("s1", "M1");
    expect(machineForSession("s1")).toBe("M1");
    rememberSessionMachine("s1", null);
    expect(machineForSession("s1")).toBeNull();
  });

  it("routes a Session-scoped path to the owner, and everything else here", () => {
    rememberSessionMachine("s1", "M1");
    expect(machineForPath("/api/sessions/s1/messages")).toBe("M1");
    expect(machineForPath("/api/sessions/other/messages")).toBeNull();
    expect(machineForPath("/api/projects/p/agents/a/sessions")).toBeNull();
  });

  it("forgets everything on a Project switch", () => {
    rememberSessionMachine("s1", "M1");
    forgetSessionMachines();
    expect(machineForSession("s1")).toBeNull();
  });
});

describe("a machine a link names", () => {
  it("routes a Session the app never listed, and never moves one it did", () => {
    // The Claude Code console links `/chat/<id>?machine=<id>`: its runs were fetched by a page
    // in a frame, so without this the lookup asks this server and hears 404.
    rememberLinkedMachine("cc-1", "devbox");
    expect(machineForSession("cc-1")).toBe("devbox");
    expect(machineForPath("/api/sessions/cc-1")).toBe("devbox");
    // The list's answer stands against a link.
    rememberSessionMachine("s1", "gpu");
    rememberLinkedMachine("s1", "devbox");
    expect(machineForSession("s1")).toBe("gpu");
    // No machine, or an empty one, is this server.
    rememberLinkedMachine("s2", null);
    rememberLinkedMachine("s2", "");
    expect(machineForSession("s2")).toBeNull();
  });
});
