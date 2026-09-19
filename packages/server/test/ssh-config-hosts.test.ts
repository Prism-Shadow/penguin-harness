/**
 * The host block the Machines page appends to `~/.ssh/config`: what is refused before any
 * write, and the exact lines that are written. Strictness is the point — the block joins a
 * file a person edits by hand, so a glob in the alias or a `#` in a value would quietly
 * change what ssh reads.
 */
import { describe, expect, it } from "vitest";
import {
  findHostBlock,
  renderHostBlock,
  replaceHostBlock,
  validateHostEntry,
} from "../src/machines/ssh-config.js";

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
