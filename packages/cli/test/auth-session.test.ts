/**
 * `penguin auth login`'s moving parts (src/auth-session.ts).
 *
 * The command itself is thin; what is easy to get wrong lives here, and each of these has a
 * failure that only shows up on somebody's machine:
 *
 * - The Host header. The API refuses a request arriving as the preview host, so a login that
 *   connects to 127.0.0.1 must still SAY `localhost:<port>` — and `fetch` cannot, which is
 *   why this is hand-rolled at all.
 * - The stored token's file mode. It is a credential; 0600 has to survive an overwrite, where
 *   the `mode` write option silently does not apply.
 * - Picking the session cookie out of Set-Cookie, which arrives beside others.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  call,
  clearSession,
  readSession,
  tokenFromSetCookie,
  writeSession,
} from "../src/auth-session.js";

describe("tokenFromSetCookie", () => {
  it("takes the session cookie and not its neighbours", () => {
    expect(
      tokenFromSetCookie(
        ["other=1; Path=/", "penguin_session=abc.def; Path=/; HttpOnly", "last=2"],
        "penguin_session",
      ),
    ).toBe("abc.def");
    expect(tokenFromSetCookie(["other=1"], "penguin_session")).toBeNull();
    expect(tokenFromSetCookie(undefined, "penguin_session")).toBeNull();
  });
});

describe("the session file", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-auth-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("stays 0600 even when it is overwritten", () => {
    writeSession(root, { server: "http://localhost:1", userId: "admin", token: "t1" });
    fs.chmodSync(path.join(root, "cli-session.json"), 0o644); // As a careless editor might.
    writeSession(root, { server: "http://localhost:1", userId: "admin", token: "t2" });
    // The write option only applies at creation, so without the explicit chmod this is 644 —
    // a token readable by everyone on the machine.
    expect(fs.statSync(path.join(root, "cli-session.json")).mode & 0o777).toBe(0o600);
    expect(readSession(root)?.token).toBe("t2");
  });

  it("refuses to write the token through a symlink parked at its path", () => {
    const outside = path.join(root, "attacker-readable");
    fs.writeFileSync(outside, "");
    fs.symlinkSync(outside, path.join(root, "cli-session.json"));
    // A local attacker who can write the root but not read the session file could otherwise
    // redirect the token into a file they can read. The write unlinks and creates exclusively,
    // so the parked link is gone and the outside file never receives the token.
    writeSession(root, { server: "http://localhost:1", userId: "admin", token: "secret-token" });
    expect(fs.readFileSync(outside, "utf8")).toBe("");
    expect(fs.lstatSync(path.join(root, "cli-session.json")).isSymbolicLink()).toBe(false);
    expect(readSession(root)?.token).toBe("secret-token");
  });

  it("reads nothing from a missing, damaged or shapeless file", () => {
    expect(readSession(root)).toBeNull();
    fs.writeFileSync(path.join(root, "cli-session.json"), "{ not json");
    expect(readSession(root)).toBeNull();
    fs.writeFileSync(path.join(root, "cli-session.json"), JSON.stringify({ server: "x" }));
    expect(readSession(root)).toBeNull();
    writeSession(root, { server: "http://localhost:1", userId: "admin", token: "t" });
    expect(clearSession(root)).toBe(true);
    expect(readSession(root)).toBeNull();
  });

  it("says the canonical app host while connecting to the address", async () => {
    // The whole reason this is node:http and not fetch. A server that only answers under its
    // app host would 401 every request otherwise, and the message would blame the password.
    const seen: { host?: string; body?: string } = {};
    const server = http.createServer((req, res) => {
      seen.host = req.headers.host;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen.body = Buffer.concat(chunks).toString("utf8");
        res.setHeader("set-cookie", "penguin_session=tok; Path=/; HttpOnly");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ user: { userId: "admin" } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const answer = await call(
        `http://localhost:${port}`,
        { method: "POST", path: "/api/auth/login" },
        { userId: "admin", password: "pw" },
      );
      expect(answer.status).toBe(200);
      expect(seen.host).toBe(`localhost:${port}`);
      expect(seen.body).toBe(JSON.stringify({ userId: "admin", password: "pw" }));
      const setCookie = answer.headers["set-cookie"];
      expect(tokenFromSetCookie(setCookie as string[], "penguin_session")).toBe("tok");
    } finally {
      server.close();
    }
  });
});
