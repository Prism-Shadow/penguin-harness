/**
 * Pairing from the options page: an address and a one-time code in, a stored server out.
 *
 * - Given an address as people paste it, the origin to pair with is derived (https for a bare
 *   host, http for a bare loopback host, path dropped); an empty, malformed or non-web address
 *   is refused before anything is sent.
 * - Given a code with stray whitespace, it is cleaned; a code of the wrong shape is refused
 *   before anything is sent.
 * - Given a good code, the extension posts `{ code, name, version }` to the pair route without
 *   cookies, and stores the server with its token, ids, user and version.
 * - Given the same server paired again, the new pairing replaces the old one (one entry, the new
 *   token) and lifts any hold on it.
 * - Given the server refuses the code, its message is shown and nothing is stored.
 * - Given no server answers, or an answer that is not a pairing, nothing is stored.
 * - Given the server runs a newer minor release than the extension, the page says to update.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceName, isUpdateAvailable, normalizeServerUrl, pair } from "../src/pairing.js";
import { readHolds, readServers, setHold } from "../src/storage.js";
import { installChrome, type FakeChrome } from "./helpers/chrome.js";
import { installFetch } from "./helpers/fetch.js";

const CODE = "Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eHF1dXg"; // 43 base64url characters
const PAIRED = {
  extensionId: "bext_7f3a",
  token: "TOKEN_tUaVSu1rOw6Q3VtJm1iEJ0pW8rD5yN2bLk9XcPf",
  installId: "inst_1",
  user: { userId: "u_alice", displayName: "Alice" },
  serverVersion: "0.2.13",
};

let fake: FakeChrome;

function pairWith(serverUrl: string, code = CODE) {
  return pair({
    serverUrl,
    code,
    extensionVersion: "0.2.13",
    name: "Chrome 130 on Linux",
    now: () => new Date("2026-10-02T08:00:00Z"),
  });
}

beforeEach(() => {
  fake = installChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the user typed", () => {
  it.each([
    ["https://ph.example.com/chat/123?x=1#y", "https://ph.example.com"],
    ["ph.example.com", "https://ph.example.com"],
    ["ph.example.com:8443", "https://ph.example.com:8443"],
    ["localhost:7369", "http://localhost:7369"],
    ["127.0.0.1:7369", "http://127.0.0.1:7369"],
    ["http://192.168.1.20:7364/", "http://192.168.1.20:7364"],
    ["  https://ph.example.com  ", "https://ph.example.com"],
  ])("pairs %s with %s", (input, origin) => {
    expect(normalizeServerUrl(input)).toEqual({ origin });
  });

  it.each([
    ["", "url_empty"],
    ["   ", "url_empty"],
    ["ftp://files.example.com", "url_scheme"],
    ["chrome://settings", "url_scheme"],
    ["https://", "url_invalid"],
  ])("refuses %j (%s) without sending anything", async (input, code) => {
    const { requests } = installFetch({ status: 200, body: PAIRED });
    await expect(pairWith(input)).resolves.toEqual({ ok: false, error: { code } });
    expect(requests).toEqual([]);
  });

  it("cleans whitespace out of a pasted code, and refuses one of the wrong shape", async () => {
    const { requests } = installFetch({ status: 200, body: PAIRED });
    await expect(pairWith("ph.example.com", "abc")).resolves.toEqual({
      ok: false,
      error: { code: "code_invalid" },
    });
    await expect(pairWith("ph.example.com", `${CODE}!`)).resolves.toMatchObject({ ok: false });
    expect(requests).toEqual([]);

    await pairWith("ph.example.com", ` ${CODE.slice(0, 20)}\n${CODE.slice(20)} `);
    expect((requests[0]?.body as { code: string }).code).toBe(CODE);
  });
});

describe("pairing with the server", () => {
  it("posts the code without cookies and stores the server with its token", async () => {
    const { requests } = installFetch({ status: 200, body: PAIRED });
    const outcome = await pairWith("https://ph.example.com/");

    expect(requests).toEqual([
      {
        url: "https://ph.example.com/api/builtin-browser/extension/pair",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { code: CODE, name: "Chrome 130 on Linux", version: "0.2.13" },
        credentials: "omit",
      },
    ]);
    expect(outcome.ok).toBe(true);
    expect(fake.local.data.servers).toEqual([
      {
        origin: "https://ph.example.com",
        label: "ph.example.com",
        token: PAIRED.token,
        extensionId: "bext_7f3a",
        installId: "inst_1",
        user: { userId: "u_alice", displayName: "Alice" },
        serverVersion: "0.2.13",
        pairedAt: "2026-10-02T08:00:00.000Z",
      },
    ]);
  });

  it("pairing the same server again replaces the old pairing and lifts its hold", async () => {
    installFetch({ status: 200, body: PAIRED });
    await pairWith("https://ph.example.com");
    await setHold("https://ph.example.com", { reason: "replaced" });

    installFetch({ status: 200, body: { ...PAIRED, token: `${PAIRED.token}2` } });
    await pairWith("ph.example.com");

    const servers = await readServers();
    expect(servers.map((s) => [s.origin, s.token])).toEqual([
      ["https://ph.example.com", `${PAIRED.token}2`],
    ]);
    expect(await readHolds()).toEqual({});
  });

  it("shows the server's refusal and stores nothing", async () => {
    installFetch({
      status: 400,
      body: { error: { code: "invalid_code", message: "The pairing code expired." } },
    });
    await expect(pairWith("ph.example.com")).resolves.toEqual({
      ok: false,
      error: { code: "refused", message: "The pairing code expired." },
    });
    expect(await readServers()).toEqual([]);
  });

  it.each([
    [
      "no server answers",
      "network-error" as const,
      { code: "unreachable", origin: "https://ph.example.com" },
    ],
    [
      "the answer is not JSON",
      { status: 200, body: "<html>proxy login</html>" },
      { code: "bad_response" },
    ],
    ["the answer is not a pairing", { status: 200, body: { ok: true } }, { code: "bad_response" }],
  ])("stores nothing when %s", async (_name, answer, error) => {
    installFetch(answer);
    await expect(pairWith("ph.example.com")).resolves.toEqual({ ok: false, error });
    expect(await readServers()).toEqual([]);
  });
});

describe("how the extension names itself and its version", () => {
  it("names the Chrome version and platform", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.58 Safari/537.36";
    expect(deviceName(ua, "Linux")).toBe("Chrome 130 on Linux");
    expect(deviceName(ua, undefined)).toBe("Chrome 130");
  });

  it.each([
    ["0.2.13", "0.3.0", true],
    ["0.2.13", "1.0.0", true],
    ["0.2.13", "0.2.20", false],
    ["0.3.0", "0.2.13", false],
    ["0.2.13", "nightly", false],
  ])("extension %s against server %s: update available = %s", (own, server, expected) => {
    expect(isUpdateAvailable(own, server)).toBe(expected);
  });
});
