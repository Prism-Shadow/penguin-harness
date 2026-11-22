/**
 * The agent-desktop release this plugin runs, pinned in source: the npm tarball by the registry's
 * own `dist.integrity`, and inside it each target's program and helper by sha256.
 *
 * agent-desktop is one npm package that bundles the native programs of all six targets, each with
 * a `.sha256` sidecar. This plugin never installs it with npm (the desktop app's server has no npm
 * beside it, and the package's postinstall and Node launcher are what break when install scripts
 * are blocked): it downloads the tarball itself, checks it against `integrity`, and keeps only this
 * machine's program and helper, each checked against the digest below — the same digests the
 * sidecars of 1.3.1 carry, read from the tarball the registry serves.
 *
 * Upstream ships breaking changes in minor versions, so a bump is deliberate: change the version,
 * the integrity and every digest together, run the CI smoke, and check that the envelope's major
 * version is still 2.
 */

/** One file inside the tarball: where it is, what its bytes hash to, what it is called once kept. */
export interface PinnedFile {
  /** Its path inside the tarball (`package/bin/...`). */
  entry: string;
  /** Lowercase hex sha256 of its bytes. */
  sha256: string;
  /** Its name in the install directory. */
  name: string;
}

/** A target's files: the program, and the helper it looks for beside itself (Linux and macOS). */
export interface TargetPin {
  program: PinnedFile;
  helper?: PinnedFile;
}

export interface AgentDesktopPin {
  name: string;
  version: string;
  /** npm's `dist.integrity` of the tarball: `sha512-<base64>`. */
  integrity: string;
  /** The tarball's size in bytes; a download larger than twice this is cut off. */
  size: number;
  /** By `<process.platform>-<process.arch>`. */
  targets: Readonly<Record<string, TargetPin>>;
}

const LINUX_HELPER = "agent-desktop-linux-clipboard-owner";
const MACOS_HELPER = "agent-desktop-macos-helper";

export const AGENT_DESKTOP: AgentDesktopPin = {
  name: "agent-desktop",
  version: "1.3.1",
  integrity:
    "sha512-5pBKkFkdB/VIAWRfqoA8lYp5/fenfxUHI15Pc4k8Nn2LmLxxo1PkAb0WLypknyOCczuIwuzFp/rZHGGawEV+hw==",
  size: 15_781_191,
  targets: {
    "darwin-arm64": {
      program: {
        entry: "package/bin/agent-desktop-darwin-arm64",
        sha256: "9a6b0829736a486da532a9d1ceed1e07192fa8967326c7b27125646adab6baf7",
        name: "agent-desktop",
      },
      helper: {
        entry: "package/bin/agent-desktop-macos-helper-darwin-arm64",
        sha256: "87348178e546974ee0f96b74dd03410f61f4972cae5eb5fbd36bf04d2cb50a42",
        name: MACOS_HELPER,
      },
    },
    "darwin-x64": {
      program: {
        entry: "package/bin/agent-desktop-darwin-x64",
        sha256: "f762f8ed6a14b114f8a50b902205d3ecb6bcf554d8031f67abd7938af88663cb",
        name: "agent-desktop",
      },
      helper: {
        entry: "package/bin/agent-desktop-macos-helper-darwin-x64",
        sha256: "95eb80c7a18119319e3345a0ab6587c508e5999985cb7f1bdf1fb887553ea072",
        name: MACOS_HELPER,
      },
    },
    "linux-arm64": {
      program: {
        entry: "package/bin/agent-desktop-linux-arm64",
        sha256: "60b3898739534bb3106bcd81a2ca0114b76b27b884b30915dbc8755a69802463",
        name: "agent-desktop",
      },
      helper: {
        entry: "package/bin/agent-desktop-linux-clipboard-owner-linux-arm64",
        sha256: "56b132d7e45891fca7f6b67380b47dd01fdd284bf83c26ae3c2a52d5c83ed89a",
        name: LINUX_HELPER,
      },
    },
    "linux-x64": {
      program: {
        entry: "package/bin/agent-desktop-linux-x64",
        sha256: "21cd3a0c28d76a6f5999970b2bd1c11fd843b8b95147832d33e60a1128240452",
        name: "agent-desktop",
      },
      helper: {
        entry: "package/bin/agent-desktop-linux-clipboard-owner-linux-x64",
        sha256: "e55214da7bc28559fb383331dfa4ad6c7e33178c23aea67597a07d883b45ee60",
        name: LINUX_HELPER,
      },
    },
    "win32-arm64": {
      program: {
        entry: "package/bin/agent-desktop-win32-arm64.exe",
        sha256: "d3c93ca08a335b1b3bb1854200e17b639f8c914fabb1f721c8df6814a5cce087",
        name: "agent-desktop.exe",
      },
    },
    "win32-x64": {
      program: {
        entry: "package/bin/agent-desktop-win32-x64.exe",
        sha256: "a7ef5e539fb97287a35eb9ed49d3803b4d6bd705bc4106eb28617229f9be679e",
        name: "agent-desktop.exe",
      },
    },
  },
};

/** The key a pin's `targets` uses for a machine. */
export function targetKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}
