/**
 * The I/O half of `~/.ssh/config` (transport/targets.ts), against the real file system under
 * a temporary HOME. The route suite hands these four functions to the service as stand-ins,
 * so this file is the only place `Include` expansion, the `~`/absolute resolution, the modes
 * a first write creates and the append's leading newline ever meet a disk.
 *
 * HOME is moved rather than any function injected: `os.homedir()` reads HOME (USERPROFILE on
 * Windows), which is exactly how these functions find the config when the server runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHostBlock } from "../src/machines/ssh-config.js";
import {
  appendHostBlock,
  listHostAliases,
  readSshConfig,
  writeSshConfig,
} from "../src/machines/transport/targets.js";

/** Windows has no POSIX mode bits to assert on; everything else runs there too. */
const posixOnly = it.skipIf(process.platform === "win32");

let root: string;
let home: string;
let saved: { HOME?: string; USERPROFILE?: string };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-ssh-config-"));
  home = path.join(root, "home");
  fs.mkdirSync(home);
  saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

afterEach(() => {
  for (const key of ["HOME", "USERPROFILE"] as const) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const sshDir = () => path.join(home, ".ssh");
const configFile = () => path.join(sshDir(), "config");

/** Writes `text` at `file` under the temporary root, parents included. */
function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const block = renderHostBlock(
  { alias: "build-box", hostName: "10.0.0.2", user: "deploy" },
  new Date("2026-09-28T12:00:00.000Z"),
);

describe("listHostAliases", () => {
  it("follows Include through a glob relative to ~/.ssh, a ~ path and an absolute path", () => {
    const outside = path.join(root, "elsewhere", "absolute.conf");
    put(
      configFile(),
      [
        "Host top",
        "  HostName 10.0.0.1",
        "Include config.d/*.conf",
        `Include ${outside}`,
        "Host last",
        "",
      ].join("\n"),
    );
    // Sorted by name, so 10- comes before 20- whatever order the directory lists them in.
    put(path.join(sshDir(), "config.d", "20-beta.conf"), "Host beta\n  HostName 10.0.0.4\n");
    put(
      path.join(sshDir(), "config.d", "10-alpha.conf"),
      "Host alpha\n  HostName 10.0.0.3\nInclude ~/nested/deep.conf\n",
    );
    // The glob is `*.conf`: a sibling with another extension is not included.
    put(path.join(sshDir(), "config.d", "notes.txt"), "Host not-included\n");
    put(path.join(home, "nested", "deep.conf"), "Host deep\n  HostName 10.0.0.5\n");
    put(outside, "Host absolute\n  HostName 10.0.0.6\n");

    expect(listHostAliases()).toEqual(["top", "alpha", "deep", "beta", "absolute", "last"]);
  });

  it("no usable config is no targets, and an Include that matches nothing is skipped", () => {
    expect(listHostAliases()).toEqual([]);

    put(
      configFile(),
      "Host one\nInclude missing.conf\nInclude nowhere/*\nInclude ~/absent/*.conf\nHost two\n",
    );
    expect(listHostAliases()).toEqual(["one", "two"]);
  });
});

describe("appendHostBlock", () => {
  posixOnly("creates the directory and the file with the modes ssh insists on", () => {
    expect(fs.existsSync(sshDir())).toBe(false);

    appendHostBlock(block);

    expect(fs.statSync(sshDir()).mode & 0o777).toBe(0o700);
    expect(fs.statSync(configFile()).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(configFile(), "utf8")).toBe(block);
  });

  it("appended to a config without a trailing newline, ends that line first", () => {
    const foreign = "Host foreign\n  HostName 10.0.0.9";
    put(configFile(), foreign);

    appendHostBlock(block);

    // The foreign line is terminated, then one blank line, then the block — never
    // `  HostName 10.0.0.9# Added by …`, which would change that host and hide this one.
    expect(fs.readFileSync(configFile(), "utf8")).toBe(`${foreign}\n\n${block}`);
    expect(listHostAliases()).toEqual(["foreign", "build-box"]);
  });

  it("appended to a config that ends in a newline, adds one blank line and no more", () => {
    const foreign = "Host foreign\n  HostName 10.0.0.9\n";
    put(configFile(), foreign);

    appendHostBlock(block);

    expect(fs.readFileSync(configFile(), "utf8")).toBe(`${foreign}\n${block}`);
  });
});

describe("readSshConfig", () => {
  it("reads the config byte for byte, and null when there is none", () => {
    expect(readSshConfig()).toBeNull();

    const text = "# ünïcode — コメント\r\nHost crlf\r\n  HostName 10.0.0.7\r\n";
    put(configFile(), text);

    expect(readSshConfig()).toBe(text);
    expect(Buffer.from(readSshConfig()!, "utf8").equals(fs.readFileSync(configFile()))).toBe(true);
  });
});

describe("writeSshConfig", () => {
  it("writes the config back whole", () => {
    put(configFile(), "Host old\n  HostName 10.0.0.1\nHost gone\n  HostName 10.0.0.2\n");
    const text = `Host old\n  HostName 10.0.0.1\n\n${block}`;

    writeSshConfig(text);

    expect(fs.readFileSync(configFile(), "utf8")).toBe(text);
    expect(readSshConfig()).toBe(text);
  });

  posixOnly("writes the config back whole, creating a missing one at 0600", () => {
    fs.mkdirSync(sshDir(), { mode: 0o700 });

    writeSshConfig(block);

    expect(fs.statSync(configFile()).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(configFile(), "utf8")).toBe(block);
  });
});
