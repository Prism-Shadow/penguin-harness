/**
 * The host block the Machines page appends to `~/.ssh/config`: what is refused before any
 * write, and the exact lines that are written. Strictness is the point — the block joins a
 * file a person edits by hand, so a glob in the alias or a `#` in a value would quietly
 * change what ssh reads.
 */
import { describe, expect, it } from "vitest";
import { renderHostBlock, validateHostEntry } from "../src/machines/ssh-config.js";

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
