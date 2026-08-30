/**
 * Asking a MACHINE for a session token, over ssh (machines/remote-token.ts).
 *
 * This exists because the path it replaces has a dead end: reading a machine's SEEDED admin
 * password works only until somebody sets a real one, and then that machine can never be
 * configured from here again. What authorizes a token instead is the ssh account's access to
 * the data root — access that already reads every credential on that machine by hand.
 *
 * What the token IS — that it authenticates, and only as a password session — is pinned in
 * auth-token.test.ts. What matters here is the asking: reading it out of a shell's output
 * without mistaking a login banner for a credential, and telling a machine too OLD to know the
 * command apart from one that failed. The first is "ask another way" and the caller has one;
 * the second is not, and confusing them strands every machine carrying an older build.
 */
import { describe, expect, it } from "vitest";
import { authTokenCommand, mintTokenOnRemote, parseToken } from "../src/machines/remote-token.js";
import { remoteLayoutFor } from "../src/machines/layout.js";
import type { ExecResult } from "../src/machines/exec.js";

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "", timedOut: false });

const RELEASE = remoteLayoutFor("release");

describe("parseToken", () => {
  it("takes the first line after the marker, not a shell banner before it", () => {
    // The command runs through a shell whose profile may print anything; a banner is not a
    // credential, and taking the wrong line would send junk as a cookie.
    expect(parseToken("Welcome to nas!\nMOTD\n---penguin-auth-token---\nabc123\n")).toBe("abc123");
    expect(parseToken("---penguin-auth-token---\n\n  abc123  \n")).toBe("abc123");
    expect(parseToken("command not found: penguin")).toBeNull();
  });

  it("asks for a bounded lifetime, and refuses a nonsensical one", () => {
    expect(authTokenCommand(RELEASE, 60)).toContain("--ttl-seconds 60");
    // The command the CLI actually has, and `--mark` — without it the token comes back bare
    // and parseToken has nothing to anchor on.
    expect(authTokenCommand(RELEASE, 60)).toContain("auth token");
    expect(authTokenCommand(RELEASE, 60)).toContain("--mark");
    expect(authTokenCommand(RELEASE, 60)).not.toContain("server auth-token");
    expect(() => authTokenCommand(RELEASE, 0)).toThrow();
  });
});

describe("mintTokenOnRemote", () => {
  it("reads a machine too old to know the command as 'ask another way'", async () => {
    // Separate from a failure on purpose: the caller still has the seeded-password path, and
    // treating this as fatal would strand every machine carrying an older build.
    const outcome = await mintTokenOnRemote({ alias: "nas", user: "me" }, RELEASE, async () =>
      ok("penguin: unknown command 'auth-token'"),
    );
    expect(outcome.kind).toBe("unsupported");
  });

  it("does not read a timeout as an old build", async () => {
    const outcome = await mintTokenOnRemote({ alias: "nas", user: "me" }, RELEASE, async () => ({
      code: 255,
      stdout: "",
      stderr: "",
      timedOut: true,
    }));
    expect(outcome.kind).toBe("failed");
  });

  it("answers when the connection is gone, rather than throwing through its caller", async () => {
    // The shared ssh connection REJECTS once it is dead. Every other way of not getting a
    // token is a returned outcome, and signInOn reads outcomes to decide whether to fall back
    // to the password path — a throw skips that fallback and surfaces as a 500 on a machine
    // that merely lost its tunnel.
    const outcome = await mintTokenOnRemote({ alias: "nas", user: "me" }, RELEASE, () => {
      throw new Error("write after end");
    });
    expect(outcome).toEqual({ kind: "failed", detail: "write after end" });
  });
});
