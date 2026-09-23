/**
 * Where a machine's sshd binds an `out` forward, read off one probe connection: sshd's own
 * word first, the listing second, and `unknown` — with why — for everything unreadable. The
 * consent store that overrides the verdict is here too.
 */
import { describe, expect, it } from "vitest";
import { exposureProbeArgs, readExposure } from "../src/machines/commands.js";
import { SettingsExposureConsent } from "../src/port-forwards/exposure.js";

const ok = (
  stdout: string,
  stderr = "debug1: Remote connections from 127.0.0.1:0 forwarded\nAllocated port 45001 for remote forward to 127.0.0.1:1\n",
) => ({ code: 0, stdout, stderr });

describe("the exposure probe", () => {
  it("asks for a listener of sshd's own choosing, bound as every out forward asks, verbosely, and lists the machine's listeners", () => {
    const args = exposureProbeArgs({ alias: "nas", user: "deploy" });
    expect(args).toContain("-v");
    expect(args).toContain("-R");
    expect(args[args.indexOf("-R") + 1]).toBe("127.0.0.1:0:127.0.0.1:1");
    expect(args).toContain("ExitOnForwardFailure=yes");
    expect(args.at(-2)).toBe("nas");
    expect(args.at(-1)).toMatch(/^ss -Hltn .* netstat -an/);
  });

  it("takes sshd's own word that it overrode the address", () => {
    expect(
      readExposure(
        ok(
          "LISTEN 0 128 0.0.0.0:45001 0.0.0.0:*",
          'debug1: Remote: Forwarding listen address "127.0.0.1" overridden by server GatewayPorts\nAllocated port 45001 for remote forward to 127.0.0.1:1\n',
        ),
      ),
    ).toEqual({ mode: "exposes" });
  });

  it("reads the listing in each spelling: ss, Linux netstat, macOS netstat, Windows netstat", () => {
    expect(readExposure(ok("LISTEN 0 128 127.0.0.1:45001 0.0.0.0:*\n"))).toEqual({
      mode: "loopback",
    });
    expect(
      readExposure(ok("LISTEN 0 128 0.0.0.0:45001 0.0.0.0:*\nLISTEN 0 128 [::]:45001 [::]:*\n")),
    ).toEqual({ mode: "exposes" });
    expect(readExposure(ok("LISTEN 0 128 [::1]:45001 [::]:*\n"))).toEqual({ mode: "loopback" });
    expect(
      readExposure(
        ok("tcp        0      0 127.0.0.1:45001         0.0.0.0:*               LISTEN\n"),
      ),
    ).toEqual({ mode: "loopback" });
    expect(
      readExposure(
        ok("tcp6       0      0 :::45001                :::*                    LISTEN\n"),
      ),
    ).toEqual({ mode: "exposes" });
    expect(
      readExposure(
        ok("tcp4       0      0  *.45001                *.*                    LISTEN\n"),
      ),
    ).toEqual({ mode: "exposes" });
    expect(
      readExposure(
        ok("tcp4       0      0  127.0.0.1.45001        *.*                    LISTEN\n"),
      ),
    ).toEqual({ mode: "loopback" });
    expect(
      readExposure(ok("  TCP    0.0.0.0:45001          0.0.0.0:0              LISTENING\n")),
    ).toEqual({ mode: "exposes" });
    expect(
      readExposure(ok("  TCP    127.0.0.1:45001        0.0.0.0:0              LISTENING\n")),
    ).toEqual({ mode: "loopback" });
    // Some other port's wildcard is not this one's.
    expect(
      readExposure(
        ok("LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\nLISTEN 0 128 127.0.0.1:45001 0.0.0.0:*\n"),
      ),
    ).toEqual({ mode: "loopback" });
  });

  it("is unknown — with why — when the connection failed, no port was reported, or the listing has no such port", () => {
    expect(
      readExposure({
        code: 255,
        stdout: "",
        stderr: "debug1: Connecting to nas\nnas: Permission denied (publickey).\n",
      }),
    ).toEqual({
      mode: "unknown",
      detail: "nas: Permission denied (publickey).",
    });
    expect(
      readExposure({ code: 0, stdout: "LISTEN 0 128 127.0.0.1:45001 0.0.0.0:*", stderr: "" }),
    ).toMatchObject({ mode: "unknown" });
    expect(readExposure(ok("penguin-no-listing\n"))).toMatchObject({ mode: "unknown" });
    expect(readExposure(ok("LISTEN 0 128 127.0.0.1:22 0.0.0.0:*\n"))).toMatchObject({
      mode: "unknown",
    });
  });
});

describe("the consent store", () => {
  it("reads absent as nobody, and keeps one list of machine ids", () => {
    const rows = new Map<string, string>();
    const consent = new SettingsExposureConsent({
      get: (key) => rows.get(key) ?? null,
      set: (key, value) => void rows.set(key, value),
    });
    expect(consent.allowed("m1")).toBe(false);
    consent.setAllowed("m1", true);
    consent.setAllowed("m2", true);
    expect(consent.allowed("m1")).toBe(true);
    expect(JSON.parse(rows.get("port_forward_exposure_allowed")!)).toEqual(["m1", "m2"]);
    consent.setAllowed("m1", false);
    expect(consent.allowed("m1")).toBe(false);
    expect(consent.allowed("m2")).toBe(true);
    // A row that is not a list reads as nobody rather than throwing.
    rows.set("port_forward_exposure_allowed", "{oops");
    expect(consent.allowed("m2")).toBe(false);
  });
});
