/**
 * Which machine owns a Session, and the path rule that routes every call about it there.
 *
 * A Session lives on the server whose filesystem its workspace is on — that server runs the
 * agent, holds the messages, writes the trace. There are two dozen Session-scoped endpoints,
 * so the routing is a rule over the PATH rather than an argument threaded through all of
 * them. These cases pin what that rule does and, more importantly, what it must not.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  forgetSessionMachines,
  machineForPath,
  machineForSession,
  rememberSessionMachine,
  sessionIdInPath,
} from "../src/lib/session-machines";

const REMOTE = "kUkIyqU-1GOfXgKD";

afterEach(() => forgetSessionMachines());

describe("remembering where a Session lives", () => {
  it("is this machine until something says otherwise", () => {
    expect(machineForSession("s1")).toBeNull();
  });

  it("routes a Session to the machine it was seen on", () => {
    rememberSessionMachine("s1", REMOTE);
    expect(machineForSession("s1")).toBe(REMOTE);
  });

  it("stores 'this machine' as absence, so local never becomes a value to route to", () => {
    rememberSessionMachine("s1", REMOTE);
    rememberSessionMachine("s1", null);
    expect(machineForSession("s1")).toBeNull();
  });

  it("keeps Sessions apart", () => {
    rememberSessionMachine("s1", REMOTE);
    expect(machineForSession("s2")).toBeNull();
  });
});

describe("sessionIdInPath", () => {
  it("finds the id on a Session path and everything beneath it", () => {
    expect(sessionIdInPath("/api/sessions/abc")).toBe("abc");
    expect(sessionIdInPath("/api/sessions/abc/messages")).toBe("abc");
    expect(sessionIdInPath("/api/sessions/abc/approvals/t1")).toBe("abc");
    expect(sessionIdInPath("/api/sessions/abc/messages?limit=20")).toBe("abc");
  });

  it("decodes it, since ids reach the path encoded", () => {
    expect(sessionIdInPath(`/api/sessions/${encodeURIComponent("a/b")}/messages`)).toBe("a/b");
  });

  it("does NOT claim the project-scoped listing", () => {
    // `/api/projects/:p/agents/:a/sessions` asks a server which Sessions IT has. Routing
    // that to another machine would be one machine answering a question about another.
    expect(sessionIdInPath("/api/projects/p/agents/a/sessions")).toBeNull();
    expect(sessionIdInPath("/api/projects/p/agents/a/sessions?limit=11")).toBeNull();
  });

  it("claims nothing else", () => {
    for (const path of ["/api/me", "/api/machines", "/api/sessions", "/assets/app.js", "/"]) {
      expect(sessionIdInPath(path)).toBeNull();
    }
  });
});

describe("machineForPath", () => {
  it("is the whole routing rule: a known Session's path goes to its machine", () => {
    rememberSessionMachine("abc", REMOTE);
    expect(machineForPath("/api/sessions/abc/messages")).toBe(REMOTE);
  });

  it("leaves an unknown Session here rather than guessing", () => {
    expect(machineForPath("/api/sessions/never-seen/messages")).toBeNull();
  });

  it("never re-routes a call that is not about a Session", () => {
    rememberSessionMachine("abc", REMOTE);
    expect(machineForPath("/api/me")).toBeNull();
    expect(machineForPath("/api/machines")).toBeNull();
    expect(machineForPath("/api/projects/p/agents/a/sessions")).toBeNull();
  });
});
