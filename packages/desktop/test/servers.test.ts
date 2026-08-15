/**
 * Server registry: parsing, implicit-local fallback, picker gating, tunnel
 * argv, and the IPC-free picker page.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REMOTE_PORT,
  IMPLICIT_LOCAL,
  loadServers,
  parseServersFile,
  pickerHtml,
  serversFilePath,
  shouldShowPicker,
  sshTunnelArgs,
} from "../src/servers.js";
import type { SshServerEntry } from "../src/servers.js";

describe("servers registry", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-servers-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("parses local and ssh entries; defaults the remote port", () => {
    const entries = parseServersFile(
      JSON.stringify({
        servers: [
          { id: "here", type: "local", label: "This box" },
          { id: "lab", type: "ssh", host: "user@lab", home: "~/.penguin/data" },
          { id: "lab2", type: "ssh", host: "lab2", remotePort: 9000 },
        ],
      }),
    )!;
    expect(entries.map((e) => e.id)).toEqual(["here", "lab", "lab2"]);
    expect((entries[1] as SshServerEntry).remotePort).toBe(DEFAULT_REMOTE_PORT);
    expect((entries[2] as SshServerEntry).remotePort).toBe(9000);
  });

  it("rejects malformed files as a whole (no half-parsed registries)", () => {
    expect(parseServersFile("not json")).toBeNull();
    expect(parseServersFile(JSON.stringify({ servers: [{ type: "local" }] }))).toBeNull();
    expect(parseServersFile(JSON.stringify({ servers: [{ id: "x", type: "ssh" }] }))).toBeNull();
  });

  it("loadServers falls back to the implicit local entry (missing, invalid, empty)", async () => {
    expect(loadServers(path.join(dir, "absent.json"))).toEqual([IMPLICIT_LOCAL]);
    const bad = path.join(dir, "bad.json");
    await fs.writeFile(bad, "{{{");
    expect(loadServers(bad)).toEqual([IMPLICIT_LOCAL]);
    const empty = path.join(dir, "empty.json");
    await fs.writeFile(empty, JSON.stringify({ servers: [] }));
    expect(loadServers(empty)).toEqual([IMPLICIT_LOCAL]);
  });

  it("the picker shows only when there is a real choice (or forced)", () => {
    expect(shouldShowPicker([IMPLICIT_LOCAL], {})).toBe(false);
    expect(shouldShowPicker([{ id: "lab", type: "ssh", host: "user@lab" }], {})).toBe(true);
    expect(shouldShowPicker([IMPLICIT_LOCAL, { id: "b", type: "local" }], {})).toBe(true);
    expect(shouldShowPicker([IMPLICIT_LOCAL], { PENGUIN_DESKTOP_PICKER: "1" })).toBe(true);
  });

  it("tunnel argv forwards loopback to loopback and never exposes a network port", () => {
    const args = sshTunnelArgs({ id: "lab", type: "ssh", host: "user@lab" }, 51234);
    expect(args).toContain("-N");
    expect(args).toContain(`127.0.0.1:51234:127.0.0.1:${DEFAULT_REMOTE_PORT}`);
    expect(args.at(-1)).toBe("user@lab");
  });

  it("PENGUIN_SERVERS_FILE overrides the userData location (shared with the push tool)", () => {
    expect(serversFilePath("/ud", { PENGUIN_SERVERS_FILE: "/shared/servers.json" })).toBe(
      "/shared/servers.json",
    );
    expect(serversFilePath("/ud", {})).toBe(path.join("/ud", "servers.json"));
  });

  it("picker page links carry the entry ids via the intercepted scheme; html is escaped", () => {
    const html = pickerHtml(
      [IMPLICIT_LOCAL, { id: "lab", type: "ssh", host: "user@lab", label: "<Lab>" }],
      "/ud/servers.json",
    );
    expect(html).toContain('href="penguin-pick://local"');
    expect(html).toContain('href="penguin-pick://lab"');
    expect(html).not.toContain("<Lab>");
    expect(html).toContain("&#60;Lab&#62;");
  });
});
