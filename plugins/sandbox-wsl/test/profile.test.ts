/**
 * Unit tests for the WSL backend's pure half: path mapping, the program a Windows argv names,
 * the bubblewrap profile per policy, the launcher's argv and notice filter, and the parsing of
 * Alpine's release list. No wsl.exe is started, so these run on any host.
 */
import { describe, expect, it } from "vitest";
import {
  bwrapArgs,
  chdirRoots,
  linuxProgram,
  parseMinirootfs,
  parseUbuntuSums,
  provisionScript,
  toLinuxPath,
  wslSettingsOf,
} from "../src/index.js";
import { noticeFilter, wslArgs } from "../src/launch.js";
import { cleanOutput, versionOf } from "../src/host.js";
import { lastSegment } from "../src/tasks.js";

const HOST = {
  distro: "penguin-sandbox",
  exposeWindowsDrives: false,
  drives: ["c", "d"],
  kind: (p: string) =>
    p.endsWith("secret") ? ("dir" as const) : p.endsWith(".env") ? ("file" as const) : null,
};
const WS = "C:\\Users\\k\\ws";

describe("toLinuxPath", () => {
  it("maps a drive path under /mnt, lowercasing the drive", () => {
    expect(toLinuxPath("C:\\Users\\k\\ws")).toBe("/mnt/c/Users/k/ws");
    expect(toLinuxPath("d:/data/")).toBe("/mnt/d/data");
    expect(toLinuxPath("E:\\")).toBe("/mnt/e");
  });

  it("maps this distro's own UNC path, and nothing else's", () => {
    expect(toLinuxPath("\\\\wsl.localhost\\penguin-sandbox\\home\\x", "penguin-sandbox")).toBe(
      "/home/x",
    );
    expect(toLinuxPath("\\\\wsl$\\Ubuntu\\home\\x", "penguin-sandbox")).toBeNull();
    expect(toLinuxPath("\\\\server\\share\\x", "penguin-sandbox")).toBeNull();
    expect(toLinuxPath("relative\\x")).toBeNull();
  });
});

describe("linuxProgram", () => {
  it("turns the Windows shell into the distro's", () => {
    expect(linuxProgram("bash")).toBe("/bin/bash");
    expect(linuxProgram("C:\\Program Files\\Git\\bin\\bash.exe")).toBe("/bin/bash");
    expect(linuxProgram("sh.exe")).toBe("/bin/sh");
    expect(linuxProgram("git.exe")).toBe("git");
  });
});

describe("bwrapArgs", () => {
  it("workspace-write: read-only distro, /run and /mnt hidden, the Workspace bound writable", () => {
    const args = bwrapArgs({ mode: "workspace-write", workspaceRoot: WS }, HOST);
    expect(args.slice(0, 3)).toEqual(["--die-with-parent", "--unshare-all", "--share-net"]);
    expect(args.join(" ")).toContain("--ro-bind / /");
    expect(args.join(" ")).toContain("--tmpfs /run");
    const mnt = args.indexOf("/mnt");
    const bind = args.indexOf("/mnt/c/Users/k/ws");
    expect(args[mnt - 1]).toBe("--tmpfs");
    expect(args[bind - 1]).toBe("--bind");
    expect(bind).toBeGreaterThan(mnt);
  });

  it("read-only binds the Workspace read-only; network none drops --share-net", () => {
    const args = bwrapArgs({ mode: "read-only", workspaceRoot: WS, network: "none" }, HOST);
    expect(args).not.toContain("--share-net");
    expect(args[args.indexOf("/mnt/c/Users/k/ws") - 1]).toBe("--ro-bind");
  });

  it("writable temp adds a tmpfs /tmp; exposing drives binds each read-only before the Workspace", () => {
    const args = bwrapArgs(
      { mode: "workspace-write", workspaceRoot: WS, writableTemp: true },
      { ...HOST, exposeWindowsDrives: true },
    );
    expect(args.join(" ")).toContain("--tmpfs /tmp");
    expect(args.join(" ")).toContain(
      "--ro-bind /mnt/c /mnt/c --ro-bind /mnt/d /mnt/d --bind /mnt/c/Users/k/ws",
    );
  });

  it("refuses the local network level rather than reading it as an open network", () => {
    expect(() =>
      bwrapArgs({ mode: "read-only", workspaceRoot: WS, network: "local" }, HOST),
    ).toThrow(/local network/);
  });

  it("full access binds the distro writable and leaves /mnt alone, still cutting the network", () => {
    const args = bwrapArgs(
      { mode: "danger-full-access", workspaceRoot: WS, network: "none" },
      HOST,
    );
    expect(args.join(" ")).toContain("--bind / /");
    expect(args).not.toContain("/mnt");
    expect(args).not.toContain("--share-net");
  });

  it("masks come last: a tmpfs over a directory, /dev/null over a file, nothing for a missing path", () => {
    const args = bwrapArgs(
      {
        mode: "workspace-write",
        workspaceRoot: WS,
        maskPaths: [`${WS}\\secret`, `${WS}\\.env`, `${WS}\\gone`],
      },
      HOST,
    );
    const tail = args.slice(args.indexOf("--remount-ro") + 2);
    expect(tail).toEqual([
      "--tmpfs",
      "/mnt/c/Users/k/ws/secret",
      "--ro-bind",
      "/dev/null",
      "/mnt/c/Users/k/ws/.env",
    ]);
  });

  it("seals the covering mount after the Workspace bind, so a write outside it fails", () => {
    // A writable tmpfs over /mnt reported success for a write that reached nothing, which is a
    // denial disguised as permission. The remount has to come AFTER the bind, which needs a
    // writable tmpfs to create its mountpoint in.
    const args = bwrapArgs({ mode: "workspace-write", workspaceRoot: WS }, HOST);
    const remount = args.indexOf("--remount-ro");
    expect(args[remount + 1]).toBe("/mnt");
    expect(remount).toBeGreaterThan(args.lastIndexOf("/mnt/c/Users/k/ws"));
    // Full access does not cover /mnt at all, so there is nothing to seal.
    expect(bwrapArgs({ mode: "danger-full-access", workspaceRoot: WS }, HOST)).not.toContain(
      "--remount-ro",
    );
  });

  it("binds the generated resolv.conf back through both tmpfs, so names still resolve", () => {
    const args = bwrapArgs({ mode: "workspace-write", workspaceRoot: WS }, HOST).join(" ");
    expect(args).toContain(
      "--tmpfs /run --ro-bind-try /run/resolvconf/resolv.conf /run/resolvconf/resolv.conf",
    );
    expect(args).toContain("--ro-bind-try /mnt/wsl/resolv.conf /mnt/wsl/resolv.conf --remount-ro");
  });

  it("refuses a Workspace with no path in the distro rather than confining nothing", () => {
    expect(() =>
      bwrapArgs({ mode: "workspace-write", workspaceRoot: "\\\\server\\share\\ws" }, HOST),
    ).toThrow(/penguin-wsl: .*no path inside the WSL distro/);
  });
});

describe("the launcher", () => {
  const job = {
    wsl: "C:\\Windows\\System32\\wsl.exe",
    distro: "penguin-sandbox",
    user: "penguin",
    bwrap: ["--ro-bind", "/", "/"],
    chdirRoots: chdirRoots({ mode: "workspace-write", workspaceRoot: WS }, HOST),
    command: ["/bin/bash", "-lc", "pwd"],
  };

  it("runs bwrap as the sandbox user and changes into the cwd when it is inside the Workspace", () => {
    expect(wslArgs(job, `${WS}\\sub`)).toEqual([
      "-d",
      "penguin-sandbox",
      "-u",
      "penguin",
      "--cd",
      "/",
      "--exec",
      "/usr/bin/bwrap",
      "--ro-bind",
      "/",
      "/",
      "--chdir",
      "/mnt/c/Users/k/ws/sub",
      "--",
      "/bin/bash",
      "-lc",
      "pwd",
    ]);
  });

  it("starts in the Workspace when the cwd is outside it", () => {
    expect(wslArgs(job, "C:\\Windows")).toContain("/mnt/c/Users/k/ws");
  });

  it("drops WSL's own proxy notice from the start of stderr, and nothing else", () => {
    const seen: string[] = [];
    const f = noticeFilter((c) => seen.push(c));
    f.push("wsl: A localhost proxy configuration was detected but not mirrored into WSL.\n");
    f.push("bash: line 1: x: Read-only file system\n");
    f.push("wsl: localhost again, but now it is the command's\n");
    f.end();
    expect(seen.join("")).toBe(
      "bash: line 1: x: Read-only file system\nwsl: localhost again, but now it is the command's\n",
    );
  });
});

describe("host output and releases", () => {
  it("cleans NULs and WSL notices out of wsl.exe output", () => {
    expect(
      cleanOutput("wsl: A localhost proxy configuration was detected\r\nU\0b\0u\0n\0t\0u\0\r\n"),
    ).toBe("Ubuntu");
  });

  it("reads the version number whatever the label's language", () => {
    expect(versionOf("WSL version: 2.7.14.0\nKernel version: 6.18")).toBe("2.7.14.0");
    expect(versionOf("WSL 版本： 2.7.14.0")).toBe("2.7.14.0");
  });

  it("reads the last progress segment written with carriage returns", () => {
    expect(lastSegment("Downloading: 10%\rDownloading: 55%\r\n\r\n")).toBe("Downloading: 55%");
  });

  it("finds the minirootfs in latest-releases.yaml", () => {
    const yaml = [
      "---",
      "-",
      '  title: "Netboot"',
      "  flavor: alpine-netboot",
      "  file: alpine-netboot-3.24.1-x86_64.tar.gz",
      "  sha256: aaaa",
      "-",
      '  title: "Mini root filesystem"',
      "  flavor: alpine-minirootfs",
      "  version: 3.24.1",
      "  file: alpine-minirootfs-3.24.1-x86_64.tar.gz",
      "  size: 3712345",
      "  sha256: ABCDEF",
    ].join("\n");
    expect(parseMinirootfs(yaml)).toEqual({
      version: "3.24.1",
      file: "alpine-minirootfs-3.24.1-x86_64.tar.gz",
      sha256: "abcdef",
      size: 3712345,
    });
  });

  it("provisions Ubuntu with apt, interop off, and the packages once each", () => {
    const script = provisionScript("ubuntu", "", ["git", "bubblewrap"]);
    expect(script).toContain("[interop]\nenabled=false");
    expect(script).toContain(
      "apt-get install -y --no-install-recommends bubblewrap ca-certificates git\n",
    );
    expect(script).toContain("useradd -m -s /bin/bash penguin");
    expect(script).not.toContain("sed -i");
  });

  it("points both Ubuntu archives at a mirror when one is set", () => {
    const script = provisionScript("ubuntu", "https://mirror.example/ubuntu", []);
    expect(script).toContain(
      "sed -i 's|http://archive.ubuntu.com/ubuntu/*|https://mirror.example/ubuntu/|; " +
        "s|http://security.ubuntu.com/ubuntu/*|https://mirror.example/ubuntu/|' " +
        "/etc/apt/sources.list.d/ubuntu.sources",
    );
  });

  it("provisions Alpine with apk, its own mirror, and bash", () => {
    const script = provisionScript("alpine", "https://mirror.example/alpine", ["git", "bash"]);
    expect(script).toContain("'https://mirror.example/alpine'");
    expect(script).toContain("apk add --no-progress bubblewrap bash git\n");
    expect(provisionScript("alpine", "", [])).toContain("'https://dl-cdn.alpinelinux.org/alpine'");
  });

  it("takes the newest ubuntu-base tarball for this architecture out of SHA256SUMS", () => {
    const sums = [
      "aaa *ubuntu-base-24.04.3-base-amd64.tar.gz",
      `${"1".repeat(64)} *ubuntu-base-24.04.10-base-amd64.tar.gz`,
      `${"2".repeat(64)} *ubuntu-base-24.04.9-base-amd64.tar.gz`,
      `${"3".repeat(64)} *ubuntu-base-24.04.20-base-arm64.tar.gz`,
    ].join("\n");
    expect(parseUbuntuSums(sums, "amd64")).toEqual({
      sha256: "1".repeat(64),
      file: "ubuntu-base-24.04.10-base-amd64.tar.gz",
      version: "24.04.10",
    });
    expect(parseUbuntuSums(sums, "riscv64")).toBeNull();
  });

  it("settings fall back to defaults for anything unusable, and Ubuntu is the default base", () => {
    expect(
      wslSettingsOf({
        distro: "bad name",
        base: "gentoo",
        mirror: "ftp://x",
        packages: ["ok", "Bad!"],
      }),
    ).toEqual({
      distro: "penguin-sandbox",
      base: "ubuntu",
      exposeWindowsDrives: false,
      mirror: "",
      packages: ["ok"],
    });
    expect(wslSettingsOf({ base: "alpine" }).base).toBe("alpine");
  });
});
