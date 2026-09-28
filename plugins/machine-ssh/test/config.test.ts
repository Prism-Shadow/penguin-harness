/**
 * `~/.ssh/config` as the ssh kind reads and writes it — moved here from the main tree with the
 * kind, cases and all. The host block the Machines page appends: what is refused before any
 * write, and the exact lines that are written. Strictness is the point — the block joins a
 * file a person edits by hand, so a glob in the alias or a `#` in a value would quietly
 * change what ssh reads.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findHostBlock,
  renderHostBlock,
  replaceHostBlock,
  validateHostEntry,
  parseHostAliases,
  useSshDir,
} from "../src/config.js";
import { SshKind } from "../src/index.js";

const AT = new Date("2026-09-05T12:00:00.000Z");

describe("validateHostEntry", () => {
  it("wants an alias and an address", () => {
    expect(validateHostEntry({ alias: "", hostName: "10.0.0.2" })).toEqual({
      field: "alias",
      why: "required",
    });
    expect(validateHostEntry({ alias: "nas", hostName: " " })).toEqual({
      field: "hostName",
      why: "required",
    });
  });

  it("refuses an alias that would be a pattern or would not survive as one word", () => {
    expect(validateHostEntry({ alias: "gpu-*", hostName: "h" })).toEqual({
      field: "alias",
      why: "invalid",
    });
    expect(validateHostEntry({ alias: "build box", hostName: "h" })).toEqual({
      field: "alias",
      why: "invalid",
    });
    expect(validateHostEntry({ alias: "nas#1", hostName: "h" })).toEqual({
      field: "alias",
      why: "invalid",
    });
  });

  it("checks the optional fields only when given", () => {
    expect(
      validateHostEntry({ alias: "nas", hostName: "h", user: "", identityFile: "" }),
    ).toBeNull();
    expect(validateHostEntry({ alias: "nas", hostName: "h", user: "a b" })).toEqual({
      field: "user",
      why: "invalid",
    });
    expect(validateHostEntry({ alias: "nas", hostName: "h", port: 0 })).toEqual({
      field: "port",
      why: "invalid",
    });
    expect(validateHostEntry({ alias: "nas", hostName: "h", port: 22.5 })).toEqual({
      field: "port",
      why: "invalid",
    });
    expect(validateHostEntry({ alias: "nas", hostName: "h", port: 65535 })).toBeNull();
    expect(validateHostEntry({ alias: "nas", hostName: "h", identityFile: "~/my key" })).toEqual({
      field: "identityFile",
      why: "invalid",
    });
  });
});

describe("renderHostBlock", () => {
  it("writes the lines ssh reads, led by who wrote them and when, and nothing blank", () => {
    expect(renderHostBlock({ alias: "nas", hostName: "10.0.0.2" }, AT)).toBe(
      [
        "# Added by PenguinHarness on 2026-09-05T12:00:00.000Z",
        "Host nas",
        "  HostName 10.0.0.2",
        "",
      ].join("\n"),
    );
  });

  it("carries every option that was given, trimmed", () => {
    expect(
      renderHostBlock(
        {
          alias: " build-box ",
          hostName: "box.example.net",
          user: "deploy",
          port: 2222,
          identityFile: "~/.ssh/id_ed25519",
        },
        AT,
      ),
    ).toBe(
      [
        "# Added by PenguinHarness on 2026-09-05T12:00:00.000Z",
        "Host build-box",
        "  HostName box.example.net",
        "  User deploy",
        "  Port 2222",
        "  IdentityFile ~/.ssh/id_ed25519",
        "",
      ].join("\n"),
    );
  });
});

const CONFIG = [
  "Host *",
  "  ServerAliveInterval 30",
  "",
  "Host nas gpu-1",
  "  HostName 10.0.0.2",
  "",
  "# Added by PenguinHarness on 2026-09-05T12:00:00.000Z",
  "Host orchid-2",
  "  HostName 10.0.0.9",
  "  User k",
  "  Port 2222",
  "",
  "",
  "Host lab",
  "  HostName lab.example.net",
  "  ProxyJump bastion",
].join("\n");

describe("findHostBlock", () => {
  it("reads back a block this app wrote, marker included, trailing blanks excluded", () => {
    expect(findHostBlock(CONFIG, "orchid-2")).toEqual({
      start: 6,
      end: 11,
      ours: true,
      entry: { alias: "orchid-2", hostName: "10.0.0.9", user: "k", port: 2222 },
    });
  });

  it("finds a hand-written block but says it is not ours", () => {
    expect(findHostBlock(CONFIG, "lab")).toEqual({
      start: 13,
      end: 16,
      ours: false,
      entry: { alias: "lab", hostName: "lab.example.net" },
    });
  });

  it("does not match a line declaring several aliases, or an alias that is not there", () => {
    expect(findHostBlock(CONFIG, "nas")).toBeNull();
    expect(findHostBlock(CONFIG, "nope")).toBeNull();
  });
});

describe("replaceHostBlock", () => {
  it("swaps the block's lines for the new ones and leaves the rest of the file alone", () => {
    const found = findHostBlock(CONFIG, "orchid-2")!;
    const block = renderHostBlock(
      { alias: "orchid-2", hostName: "10.0.0.10", port: 22 },
      new Date("2026-09-06T00:00:00.000Z"),
    );
    const next = replaceHostBlock(CONFIG, found, block);
    expect(next.split("\n").slice(6, 11)).toEqual([
      "# Added by PenguinHarness on 2026-09-06T00:00:00.000Z",
      "Host orchid-2",
      "  HostName 10.0.0.10",
      "  Port 22",
      "",
    ]);
    expect(next.split("\n").slice(0, 6)).toEqual(CONFIG.split("\n").slice(0, 6));
    expect(next.endsWith("  ProxyJump bastion")).toBe(true);
    expect(findHostBlock(next, "orchid-2")?.entry).toEqual({
      alias: "orchid-2",
      hostName: "10.0.0.10",
      port: 22,
    });
  });
});

describe("parseHostAliases", () => {
  const noIncludes = () => [];

  it("lists declared aliases in file order, expanding multi-alias blocks", () => {
    const aliases = parseHostAliases(
      ["Host build-box", "  HostName 10.0.0.4", "", "Host gpu-1 gpu-1.lan", "  User root"].join(
        "\n",
      ),
      noIncludes,
    );
    expect(aliases).toEqual(["build-box", "gpu-1", "gpu-1.lan"]);
  });

  it("skips pattern entries — they configure other hosts rather than naming one", () => {
    const aliases = parseHostAliases(
      ["Host *", "  ServerAliveInterval 30", "Host !prod *.lan", "Host real"].join("\n"),
      noIncludes,
    );
    expect(aliases).toEqual(["real"]);
  });

  it("ignores comments and blank lines, and is case-insensitive like ssh", () => {
    expect(parseHostAliases("# Host commented\n\nhost lower\nHOST upper", noIncludes)).toEqual([
      "lower",
      "upper",
    ]);
  });

  it("follows Include through the supplied reader and de-duplicates the result", () => {
    const files: Record<string, string> = {
      "work/*": "Host build-box\nHost shared",
      personal: "Host shared\nHost nas",
    };
    const aliases = parseHostAliases(
      ["Include work/*", "Host laptop", "Include personal"].join("\n"),
      (pattern) => (files[pattern] === undefined ? [] : [files[pattern]]),
    );
    expect(aliases).toEqual(["build-box", "shared", "laptop", "nas"]);
  });

  it("survives an include cycle instead of spinning", () => {
    const aliases = parseHostAliases("Include self\nHost top", () => ["Include self\nHost deep"]);
    expect(aliases).toContain("top");
    expect(aliases).toContain("deep");
  });
});

describe("the kind's discover", () => {
  let dir: string;
  const originalPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = originalPath;
    useSshDir(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is exactly the config scan, Includes followed — and starts no process", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-ssh-dir-"));
    fs.mkdirSync(path.join(dir, "config.d"));
    fs.writeFileSync(path.join(dir, "config"), "Include config.d/*\nHost build-box\nHost *\n");
    fs.writeFileSync(path.join(dir, "config.d", "lab"), "Host nas gpu-1\n");
    useSshDir(dir);
    // No PATH: a discover that tried to start ssh (or anything) could not.
    process.env.PATH = "";
    expect(new SshKind().discover()).toEqual(["nas", "gpu-1", "build-box"]);
  });

  it("a missing config is no machines, not an error", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-ssh-dir-"));
    useSshDir(path.join(dir, "absent"));
    expect(new SshKind().discover()).toEqual([]);
  });
});
