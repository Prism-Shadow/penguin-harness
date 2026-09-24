/**
 * Chromium cookie import (builtin-browser/import): synthetic `Cookies` stores whose values are
 * encrypted with known keys on each platform's scheme — the macOS Keychain and the Linux
 * v10/v11 CBC paths, the Windows GCM path behind a fake DPAPI — plus the version-24 host
 * digest, the v20 (app-bound) skip, the domain filter, and the shape each cookie takes for the
 * shell. No warning may ever carry a cookie value.
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listImportSources,
  readCookies,
  type CookieReadResult,
} from "../src/builtin-browser/import/index.js";
import {
  DAY,
  FakeMachine,
  cbcKey,
  chromeTime,
  encryptCbc,
  encryptGcm,
  fakeDpapi,
  nowSeconds,
  wrappedKey,
  writeChromiumCookies,
  writeLocalState,
  type ChromiumCookieFixture,
} from "./builtin-browser-import-fixtures.js";

let machine: FakeMachine;
afterEach(() => machine.cleanup());

const MAC_PASSWORD = "mac-keychain-password";
const macKey = () => cbcKey(MAC_PASSWORD, 1003);
const SECRETS = ["secret-session-value", "secret-token-value", "secret-plain-value"];

/** A Chrome profile on macOS with these cookies; `security` answers with the password. */
function macChrome(cookies: ChromiumCookieFixture[], version = 24): FakeMachine {
  machine = new FakeMachine("darwin");
  const profile = machine.path("Library", "Application Support", "Google", "Chrome", "Default");
  writeChromiumCookies(path.join(profile, "Network", "Cookies"), cookies, { version });
  machine.helpers.set("security", () => `${MAC_PASSWORD}\n`);
  return machine;
}

async function importAll(domains?: string[]): Promise<CookieReadResult> {
  const env = machine.env();
  const [source] = listImportSources(env);
  return readCookies(source!, domains === undefined ? {} : { domains }, env);
}

function expectNoValues(result: CookieReadResult): void {
  for (const warning of result.warnings) {
    for (const secret of SECRETS) expect(warning).not.toContain(secret);
  }
}

describe("macOS (Keychain, AES-128-CBC, 1003 iterations)", () => {
  it("decrypts v10 values with the Keychain password and strips the version-24 host digest", async () => {
    const future = nowSeconds() + 30 * DAY;
    macChrome([
      {
        host: ".amazon.com",
        name: "session-id",
        encrypted: encryptCbc("v10", SECRETS[0]!, macKey(), ".amazon.com"),
        expiresUtc: chromeTime(future),
        httpOnly: true,
        sameSite: 1,
      },
      {
        host: "www.amazon.com",
        name: "csrf",
        encrypted: encryptCbc("v10", SECRETS[1]!, macKey(), "www.amazon.com"),
        path: "/gp",
        expiresUtc: 0n,
        secure: false,
        sameSite: 2,
      },
    ]);
    const result = await importAll();
    expect(result).toMatchObject({ found: 2, skipped: 0, warnings: [] });
    expect(result.cookies).toEqual([
      {
        url: "https://amazon.com/",
        name: "session-id",
        value: SECRETS[0],
        domain: ".amazon.com",
        path: "/",
        secure: true,
        httpOnly: true,
        expirationDate: future,
        sameSite: "lax",
      },
      {
        // Host-only: no domain. Session: no expirationDate. Not secure: http.
        url: "http://www.amazon.com/gp",
        name: "csrf",
        value: SECRETS[1],
        path: "/gp",
        secure: false,
        httpOnly: false,
        sameSite: "strict",
      },
    ]);
    expect(machine.calls).toEqual([
      { file: "security", args: ["find-generic-password", "-w", "-s", "Chrome Safe Storage"] },
    ]);
  });

  it("reads a store older than version 24 without a digest", async () => {
    macChrome(
      [{ host: ".a.com", name: "n", encrypted: encryptCbc("v10", SECRETS[0]!, macKey()) }],
      23,
    );
    const result = await importAll();
    expect(result.cookies.map((c) => c.value)).toEqual([SECRETS[0]]);
  });

  it("uses a plaintext value as-is and never asks the Keychain when nothing is encrypted", async () => {
    macChrome([{ host: ".a.com", name: "n", value: SECRETS[2] }]);
    const result = await importAll();
    expect(result.cookies.map((c) => c.value)).toEqual([SECRETS[2]]);
    expect(machine.calls).toEqual([]);
  });

  it("skips expired cookies and maps SameSite, downgrading an insecure None", async () => {
    macChrome([
      { host: ".a.com", name: "old", value: "x", expiresUtc: chromeTime(nowSeconds() - DAY) },
      { host: ".a.com", name: "none-secure", value: "x", sameSite: 0 },
      { host: ".a.com", name: "none-insecure", value: "x", sameSite: 0, secure: false },
      { host: ".a.com", name: "unspecified", value: "x", sameSite: -1 },
    ]);
    const result = await importAll();
    expect(result).toMatchObject({ found: 4, skipped: 1 });
    expect(result.cookies.map((c) => [c.name, c.sameSite])).toEqual([
      ["none-secure", "no_restriction"],
      ["none-insecure", "unspecified"],
      ["unspecified", "unspecified"],
    ]);
  });

  it("skips the encrypted cookies with one warning when the Keychain refuses", async () => {
    macChrome([
      { host: ".a.com", name: "e1", encrypted: encryptCbc("v10", SECRETS[0]!, macKey(), ".a.com") },
      { host: ".a.com", name: "e2", encrypted: encryptCbc("v10", SECRETS[1]!, macKey(), ".a.com") },
      { host: ".a.com", name: "p", value: SECRETS[2] },
    ]);
    machine.helpers.set("security", () => {
      throw new Error("security exited with code 51");
    });
    const result = await importAll();
    expect(result).toMatchObject({ found: 3, skipped: 2 });
    expect(result.cookies.map((c) => c.name)).toEqual(["p"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Chrome Safe Storage");
    expect(result.warnings[0]).toContain("2 cookies");
    expectNoValues(result);
  });

  it("counts a value whose host digest does not match as undecryptable", async () => {
    macChrome([
      // Encrypted for another host: the digest check refuses it.
      {
        host: ".a.com",
        name: "moved",
        encrypted: encryptCbc("v10", SECRETS[0]!, macKey(), ".b.com"),
      },
      // Encrypted under another password.
      {
        host: ".a.com",
        name: "foreign",
        encrypted: encryptCbc("v10", SECRETS[1]!, cbcKey("other", 1003), ".a.com"),
      },
    ]);
    const result = await importAll();
    expect(result).toMatchObject({ found: 2, skipped: 2, cookies: [] });
    expect(result.warnings).toEqual(["Skipped 2 cookies that could not be decrypted."]);
    expectNoValues(result);
  });
});

describe("the domains filter", () => {
  const hosts = [
    ".amazon.com",
    "www.amazon.com",
    "smile.amazon.com",
    "notamazon.com",
    ".google.com",
  ];
  const setup = () => macChrome(hosts.map((host, i) => ({ host, name: `c${i}`, value: "v" })));

  it("keeps a domain and its subdomains, and counts only what it keeps as found", async () => {
    setup();
    const result = await importAll(["amazon.com"]);
    expect(result.found).toBe(3);
    expect(result.cookies.map((c) => c.domain ?? new URL(c.url).hostname)).toEqual([
      ".amazon.com",
      "www.amazon.com",
      "smile.amazon.com",
    ]);
  });

  it("brings the parent domain's cookies along for a subdomain, and accepts pasted URLs", async () => {
    setup();
    const result = await importAll(["https://WWW.Amazon.com/your-orders", " ", ".google.com."]);
    expect(result.cookies.map((c) => c.domain ?? new URL(c.url).hostname)).toEqual([
      ".amazon.com",
      "www.amazon.com",
      ".google.com",
    ]);
  });

  it("an empty list keeps everything", async () => {
    setup();
    expect((await importAll([])).found).toBe(hosts.length);
  });
});

describe("Linux (v10 peanuts, v11 keyring, one iteration)", () => {
  const KEYRING_PASSWORD = "keyring-password";
  function linuxChrome(cookies: ChromiumCookieFixture[], version = 24): FakeMachine {
    machine = new FakeMachine("linux");
    const profile = machine.path(".config", "google-chrome", "Default");
    writeChromiumCookies(path.join(profile, "Cookies"), cookies, { version });
    return machine;
  }

  it("decrypts v10 with the fixed password and never asks the keyring for it", async () => {
    linuxChrome([
      {
        host: ".a.com",
        name: "n",
        encrypted: encryptCbc("v10", SECRETS[0]!, cbcKey("peanuts", 1), ".a.com"),
      },
    ]);
    const result = await importAll();
    expect(result.cookies.map((c) => c.value)).toEqual([SECRETS[0]]);
    expect(machine.calls).toEqual([]);
  });

  it("decrypts v11 with the password secret-tool returns", async () => {
    linuxChrome(
      [
        {
          host: ".a.com",
          name: "n",
          encrypted: encryptCbc("v11", SECRETS[1]!, cbcKey(KEYRING_PASSWORD, 1)),
        },
      ],
      20,
    );
    machine.helpers.set("secret-tool", (args) => {
      expect(args).toEqual(["lookup", "application", "chrome"]);
      return KEYRING_PASSWORD;
    });
    const result = await importAll();
    expect(result.cookies.map((c) => c.value)).toEqual([SECRETS[1]]);
  });

  it("falls back to the empty password, as Chromium does without a keyring answer", async () => {
    linuxChrome([
      {
        host: ".a.com",
        name: "n",
        encrypted: encryptCbc("v11", SECRETS[1]!, cbcKey("", 1), ".a.com"),
      },
    ]);
    const result = await importAll();
    expect(result).toMatchObject({ skipped: 0, warnings: [] });
    expect(result.cookies.map((c) => c.value)).toEqual([SECRETS[1]]);
  });

  it("skips v11 values with a warning when secret-tool cannot provide the key", async () => {
    linuxChrome([
      {
        host: ".a.com",
        name: "v11",
        encrypted: encryptCbc("v11", SECRETS[1]!, cbcKey(KEYRING_PASSWORD, 1), ".a.com"),
      },
      {
        host: ".a.com",
        name: "v10",
        encrypted: encryptCbc("v10", SECRETS[0]!, cbcKey("peanuts", 1), ".a.com"),
      },
    ]);
    const result = await importAll();
    expect(result.cookies.map((c) => c.name)).toEqual(["v10"]);
    expect(result.skipped).toBe(1);
    expect(result.warnings).toEqual([
      "Skipped 1 cookie encrypted with a key from the desktop keyring, which secret-tool could not provide.",
    ]);
    expectNoValues(result);
  });

  it("reads the pre-2019 column names", async () => {
    machine = new FakeMachine("linux");
    writeChromiumCookies(
      machine.path(".config", "chromium", "Default", "Cookies"),
      [{ host: "a.com", name: "n", value: "v", secure: false, httpOnly: true }],
      { legacy: true },
    );
    const result = await importAll();
    expect(result.cookies).toEqual([
      {
        url: "http://a.com/",
        name: "n",
        value: "v",
        path: "/",
        secure: false,
        httpOnly: true,
        expirationDate: expect.any(Number),
        sameSite: "unspecified",
      },
    ]);
  });
});

describe("Windows (DPAPI-wrapped key, AES-256-GCM)", () => {
  const AES_KEY = Buffer.alloc(32, 7);
  function windowsChrome(cookies: ChromiumCookieFixture[], version = 24): FakeMachine {
    machine = new FakeMachine("win32");
    const userData = path.join(machine.vars.LOCALAPPDATA!, "Google", "Chrome", "User Data");
    writeLocalState(userData, { names: { Default: "Me" }, encryptedKey: wrappedKey(AES_KEY) });
    writeChromiumCookies(path.join(userData, "Default", "Network", "Cookies"), cookies, {
      version,
    });
    // The fake DPAPI: base64 in on stdin, base64 out.
    machine.helpers.set("powershell", (_args, input) =>
      fakeDpapi(Buffer.from(input ?? "", "base64")).toString("base64"),
    );
    return machine;
  }

  it("unwraps the key through PowerShell with the blob on stdin, and decrypts v10 and v11", async () => {
    windowsChrome([
      { host: ".a.com", name: "v10", encrypted: encryptGcm("v10", SECRETS[0]!, AES_KEY, ".a.com") },
      { host: ".a.com", name: "v11", encrypted: encryptGcm("v11", SECRETS[1]!, AES_KEY, ".a.com") },
    ]);
    const result = await importAll();
    expect(result.cookies.map((c) => [c.name, c.value])).toEqual([
      ["v10", SECRETS[0]],
      ["v11", SECRETS[1]],
    ]);
    // One unwrap for the whole import; the blob (without "DPAPI") travels on stdin only.
    expect(machine.calls).toHaveLength(1);
    const [call] = machine.calls;
    expect(call!.file).toBe("powershell");
    expect(call!.input).toBe(fakeDpapi(AES_KEY).toString("base64"));
    expect(call!.args.join(" ")).not.toContain(call!.input!);
    expect(call!.args.join(" ")).toContain("ProtectedData]::Unprotect");
  });

  it("skips app-bound (v20) values with one warning naming the count", async () => {
    windowsChrome([
      { host: ".a.com", name: "b1", encrypted: encryptGcm("v20", SECRETS[0]!, AES_KEY, ".a.com") },
      { host: ".a.com", name: "b2", encrypted: encryptGcm("v20", SECRETS[1]!, AES_KEY, ".a.com") },
      { host: ".a.com", name: "ok", encrypted: encryptGcm("v10", SECRETS[2]!, AES_KEY, ".a.com") },
    ]);
    const result = await importAll();
    expect(result).toMatchObject({ found: 3, skipped: 2 });
    expect(result.cookies.map((c) => c.name)).toEqual(["ok"]);
    expect(result.warnings).toEqual([
      "Skipped 2 cookies protected by Chrome's app-bound encryption, which can't be imported on Windows; sign in inside the Browser panel instead.",
    ]);
    expectNoValues(result);
  });

  it("never runs PowerShell when every value is app-bound", async () => {
    windowsChrome([
      { host: ".a.com", name: "b1", encrypted: encryptGcm("v20", SECRETS[0]!, AES_KEY) },
    ]);
    await importAll();
    expect(machine.calls).toEqual([]);
  });

  it("skips with a warning when DPAPI refuses the key", async () => {
    windowsChrome([
      { host: ".a.com", name: "v10", encrypted: encryptGcm("v10", SECRETS[0]!, AES_KEY, ".a.com") },
    ]);
    machine.helpers.set("powershell", () => {
      throw new Error("powershell exited with code 1");
    });
    const result = await importAll();
    expect(result).toMatchObject({ skipped: 1, cookies: [] });
    expect(result.warnings).toEqual([
      "Skipped 1 cookie: Windows could not unlock Chrome's cookie key.",
    ]);
  });
});
