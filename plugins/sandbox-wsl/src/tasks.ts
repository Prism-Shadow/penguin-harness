/**
 * What the card's buttons do: install WSL (elevated, once), initialize the sandbox distro, check
 * that it confines, and remove it. Each runs in the background and reports the step it is on;
 * the card shows that as a progress notice and reads it again until the task ends.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SandboxPolicy } from "@prismshadow/penguin-core/plugin";
import {
  localDrives,
  pathKind,
  readHost,
  readState,
  removeState,
  runWsl,
  stateDir,
  wslExe,
  writeState,
} from "./host.js";
import type { HostFacts, WslState } from "./host.js";
import { wslArgs } from "./launch.js";
import type { LaunchJob } from "./launch.js";
import { bwrapArgs, chdirRoots, linuxProgram, toLinuxPath } from "./profile.js";

/** The Linux the distro is built from. */
export type BaseImage = "ubuntu" | "alpine";

/** This backend's settings, as it reads them from its group. */
export interface WslSettings {
  distro: string;
  base: BaseImage;
  exposeWindowsDrives: boolean;
  /** A package mirror for the chosen base, or "" for its official one. */
  mirror: string;
  packages: string[];
}

export const DEFAULT_DISTRO = "penguin-sandbox";
/**
 * Ubuntu by default, not Alpine. Alpine's rootfs is a tenth of the size, but it is musl: a
 * prebuilt native npm module, a pip wheel or a downloaded binary that works everywhere else
 * does not run on it, and what a person finds when they search for the error is glibc advice.
 * The sandbox is where an agent's commands live, so it has to be the ordinary Linux.
 */
export const DEFAULT_BASE: BaseImage = "ubuntu";
/** The Ubuntu LTS series the base rootfs comes from. */
export const UBUNTU_SERIES = "24.04";
/** Where each base's official images and packages come from. */
export const UBUNTU_IMAGES = "https://cdimage.ubuntu.com/ubuntu-base/releases";
export const UBUNTU_ARCHIVE = "http://archive.ubuntu.com/ubuntu";
export const UBUNTU_SECURITY = "http://security.ubuntu.com/ubuntu";
export const ALPINE_MIRROR = "https://dl-cdn.alpinelinux.org/alpine";
export const DEFAULT_PACKAGES = ["git", "curl"];
/** The account commands run as inside the distro: not root, so bwrap is the only way up. */
export const SANDBOX_USER = "penguin";

/** Its group's stored document as settings; anything unusable falls back to the default. */
export function wslSettingsOf(doc: Record<string, unknown>): WslSettings {
  const distro = typeof doc.distro === "string" ? doc.distro.trim() : "";
  const mirror = typeof doc.mirror === "string" ? doc.mirror.trim() : "";
  const packages = Array.isArray(doc.packages)
    ? doc.packages.map((p) => String(p).trim()).filter((p) => /^[a-z0-9][a-z0-9._+-]*$/.test(p))
    : DEFAULT_PACKAGES;
  return {
    distro: /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(distro) ? distro : DEFAULT_DISTRO,
    base: doc.base === "alpine" ? "alpine" : DEFAULT_BASE,
    exposeWindowsDrives: doc.exposeWindowsDrives === true,
    mirror: /^https?:\/\//.test(mirror) ? mirror.replace(/\/+$/, "") : "",
    packages,
  };
}

/** The launcher job for one command under one policy — what the provider and the check share. */
export function launchJob(
  argv: readonly string[],
  policy: SandboxPolicy,
  settings: WslSettings,
  state: WslState,
): LaunchJob {
  const host = {
    distro: state.distro,
    exposeWindowsDrives: settings.exposeWindowsDrives,
    drives: localDrives(),
    kind: pathKind,
  };
  return {
    wsl: wslExe(),
    distro: state.distro,
    user: state.user,
    bwrap: bwrapArgs(policy, host),
    chdirRoots: chdirRoots(policy, host),
    command: [linuxProgram(argv[0] ?? "bash"), ...argv.slice(1)],
  };
}

/** Two languages for everything the card says. */
export interface Text {
  en: string;
  zh: string;
}

export type TaskKind = "install" | "initialize" | "check" | "remove";

export const TASK_TITLES: Record<TaskKind, Text> = {
  install: { en: "Installing WSL", zh: "正在安装 WSL" },
  initialize: { en: "Initializing the sandbox distro", zh: "正在初始化沙盒发行版" },
  check: { en: "Checking confinement", zh: "正在检查隔离效果" },
  remove: { en: "Removing the sandbox distro", zh: "正在移除沙盒发行版" },
};

/** One line of the confinement check. `ok: null` is information, not a verdict. */
export interface CheckLine {
  name: Text;
  ok: boolean | null;
  detail: string;
}

export interface TaskOutcome {
  kind: TaskKind;
  ok: boolean;
  message: Text;
  at: number;
  /** Set by an install whose features only take effect after a restart. */
  restart?: boolean;
}

/** Everything the card reads, kept for the life of the plugin's module. */
export class Tasks {
  running: { kind: TaskKind; step: Text; startedAt: number } | null = null;
  last: TaskOutcome | null = null;
  lastCheck: { at: number; lines: CheckLine[] } | null = null;
  host: HostFacts | null = null;
  private hostRead: Promise<void> | null = null;
  private hostReadAt = 0;

  /** Reads the machine again; concurrent callers share one read. */
  refreshHost(): Promise<void> {
    if (this.hostRead !== null) return this.hostRead;
    this.hostRead = readHost()
      .then((facts) => {
        this.host = facts;
      })
      .finally(() => {
        this.hostRead = null;
        this.hostReadAt = Date.now();
      });
    return this.hostRead;
  }

  /** A stale reading is refreshed in the background; the card shows what it has meanwhile. */
  touchHost(maxAgeMs = 15_000): void {
    if (this.running === null && Date.now() - this.hostReadAt > maxAgeMs) void this.refreshHost();
  }

  /** Starts a task unless one runs; resolves when it ends, having recorded its outcome. */
  start(
    kind: TaskKind,
    body: (report: (step: Text) => void) => Promise<Omit<TaskOutcome, "kind" | "at">>,
  ): Promise<void> | null {
    if (this.running !== null) return null;
    const task = { kind, step: { en: "starting…", zh: "开始…" }, startedAt: Date.now() };
    this.running = task;
    const report = (step: Text) => {
      task.step = step;
    };
    return body(report)
      .catch((err: unknown) => {
        const text = err instanceof Error ? err.message : String(err);
        return { ok: false, message: { en: text, zh: text } };
      })
      .then(async (outcome) => {
        this.last = { kind, at: Date.now(), ...outcome };
        await this.refreshHost();
        this.running = null;
      });
  }
}

// ---------------------------------------------------------------------------------------------
// Install WSL — the one step that needs an administrator.
// ---------------------------------------------------------------------------------------------

function installScript(): string {
  return fileURLToPath(new URL("../setup/install-wsl.ps1", import.meta.url));
}

function powershell(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(
    env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

/** The command that raises the consent prompt for the install script (each argument quoted once). */
export function elevationCommand(script: string, log: string): string {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Log", log]
    .map((arg) => `'${arg.replace(/'/g, "''")}'`)
    .join(",");
  return (
    `$ErrorActionPreference='Stop'; ` +
    `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @(${args})`
  );
}

function readText(file: string): string {
  try {
    return fs
      .readFileSync(file, "utf8")
      .replace(/^\uFEFF/, "")
      .replace(/\0/g, "");
  } catch {
    return "";
  }
}

/** The last thing a progress-writing program printed: its last non-empty line or `\r` segment. */
export function lastSegment(text: string): string {
  const parts = text.split(/[\r\n]+/).map((s) => s.trim());
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i] !== "") return parts[i]!;
  return "";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function installWsl(
  report: (step: Text) => void,
): Promise<Omit<TaskOutcome, "kind" | "at">> {
  const script = installScript();
  if (!fs.existsSync(script)) {
    const text = `the install script is missing from this installation (${script})`;
    return { ok: false, message: { en: text, zh: `本次安装缺少脚本（${script}）` } };
  }
  const log = path.win32.join(stateDir(), "install.log");
  fs.mkdirSync(stateDir(), { recursive: true });
  for (const f of [log, `${log}.out`, `${log}.err`]) fs.rmSync(f, { force: true });
  // Not detached: ShellExecute's RunAs verb raises no prompt from a process without a console
  // (measured on Windows 11 by the account backend). `unref` keeps the server free of it.
  let failure = "";
  const child = spawn(powershell(), ["-NoProfile", "-Command", elevationCommand(script, log)], {
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", (err) => {
    failure = err.message;
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) failure = `the permission request exited ${code}`;
  });
  child.unref();
  report({
    en: "waiting for you to accept the Windows permission prompt on this machine's screen",
    zh: "等待你在这台机器的屏幕上确认 Windows 授权弹窗",
  });
  const started = Date.now();
  let exit: number | null = null;
  while (exit === null) {
    await sleep(1000);
    if (failure !== "") {
      return {
        ok: false,
        message: {
          en: `No prompt was shown: ${failure}. Run ${script} -Log <file> from an administrator PowerShell instead.`,
          zh: `没有弹出授权窗口：${failure}。请改为在管理员 PowerShell 中运行 ${script} -Log <文件>。`,
        },
      };
    }
    const text = readText(log);
    if (text === "") {
      if (Date.now() - started > 5 * 60_000) {
        return {
          ok: false,
          message: {
            en: "Nobody accepted the Windows permission prompt within five minutes, so WSL was not installed.",
            zh: "五分钟内没有人确认 Windows 授权弹窗，WSL 未安装。",
          },
        };
      }
      continue;
    }
    const done = /PENGUIN-EXIT (-?\d+)/.exec(text);
    if (done) {
      exit = Number(done[1]);
      break;
    }
    const tail = lastSegment(readText(`${log}.out`)) || lastSegment(readText(`${log}.err`));
    report({
      en: tail === "" ? "wsl --install is running" : `wsl --install: ${tail}`,
      zh: tail === "" ? "wsl --install 正在运行" : `wsl --install：${tail}`,
    });
    if (Date.now() - started > 60 * 60_000) {
      return {
        ok: false,
        message: {
          en: "wsl --install ran for an hour without finishing.",
          zh: "wsl --install 运行一小时仍未结束。",
        },
      };
    }
  }
  const output = `${readText(`${log}.out`)}\n${readText(`${log}.err`)}`;
  report({ en: "reading what the install left", zh: "读取安装结果" });
  const host = await readHost();
  const restart = exit === 3010 || /restart|reboot|重新启动|重启/i.test(output);
  if (exit === 0 || exit === 3010) {
    if (host.wsl === "installed" && !restart) {
      return {
        ok: true,
        message: {
          en: `WSL is installed (${host.version ?? ""}). Initialize the sandbox distro next.`,
          zh: `WSL 已安装（${host.version ?? ""}）。下一步初始化沙盒发行版。`,
        },
      };
    }
    return {
      ok: true,
      restart: true,
      message: {
        en: "WSL is installed. Restart Windows to finish, then come back and initialize the sandbox distro.",
        zh: "WSL 已安装。重启 Windows 完成安装后，回到这里初始化沙盒发行版。",
      },
    };
  }
  const reason = lastSegment(output) || `exit code ${exit}`;
  return {
    ok: false,
    message: { en: `wsl --install failed: ${reason}`, zh: `wsl --install 失败：${reason}` },
  };
}

// ---------------------------------------------------------------------------------------------
// Initialize — unelevated: download Alpine, import it, provision it.
// ---------------------------------------------------------------------------------------------

/** The rootfs one base offers: where to get it, what it should hash to, and its version. */
export interface BaseRelease {
  version: string;
  file: string;
  url: string;
  sha256: string;
  size: number;
}

/** The minirootfs entry of an Alpine latest-releases.yaml (a list of flat maps). */
export function parseMinirootfs(yaml: string): Omit<BaseRelease, "url"> | null {
  for (const block of yaml.split(/^-\s*$/m)) {
    const field = (key: string) => new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m").exec(block)?.[1];
    if (field("flavor") !== "alpine-minirootfs") continue;
    const file = field("file");
    const sha256 = field("sha256");
    if (file === undefined || sha256 === undefined) continue;
    return {
      version: field("version") ?? "",
      file,
      sha256: sha256.toLowerCase(),
      size: Number(field("size") ?? 0),
    };
  }
  return null;
}

/**
 * The newest ubuntu-base tarball for one architecture, out of the release directory's
 * SHA256SUMS — which is both the listing and the checksum, so one fetch answers both.
 */
export function parseUbuntuSums(
  sums: string,
  arch: string,
): Omit<BaseRelease, "url" | "size"> | null {
  const pattern = new RegExp(
    `^([0-9a-f]{64}) \\*?(ubuntu-base-([0-9.]+)-base-${arch}\\.tar\\.gz)$`,
  );
  let best: Omit<BaseRelease, "url" | "size"> | null = null;
  const order = (v: string) => v.split(".").map(Number);
  for (const line of sums.split(/\r?\n/)) {
    const m = pattern.exec(line.trim());
    if (m === null) continue;
    const candidate = { sha256: m[1]!.toLowerCase(), file: m[2]!, version: m[3]! };
    if (best === null) best = candidate;
    else {
      const [a, b] = [order(candidate.version), order(best.version)];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] ?? 0) === (b[i] ?? 0)) continue;
        if ((a[i] ?? 0) > (b[i] ?? 0)) best = candidate;
        break;
      }
    }
  }
  return best;
}

/** Asks the chosen base where its rootfs is. Rejects with what to tell the person. */
export async function resolveRelease(
  base: BaseImage,
  fetchImpl: typeof fetch,
  arch: string = process.arch,
): Promise<BaseRelease> {
  if (base === "ubuntu") {
    const dir = `${UBUNTU_IMAGES}/${UBUNTU_SERIES}/release`;
    const res = await fetchImpl(`${dir}/SHA256SUMS`);
    if (!res.ok)
      throw new Error(`could not read Ubuntu's checksums (HTTP ${res.status} from ${dir})`);
    const release = parseUbuntuSums(await res.text(), arch === "arm64" ? "arm64" : "amd64");
    if (release === null)
      throw new Error(`Ubuntu ${UBUNTU_SERIES} publishes no base rootfs for this architecture`);
    return { ...release, url: `${dir}/${release.file}`, size: 0 };
  }
  const dir = `${ALPINE_MIRROR}/latest-stable/releases/${arch === "arm64" ? "aarch64" : "x86_64"}`;
  const res = await fetchImpl(`${dir}/latest-releases.yaml`);
  if (!res.ok)
    throw new Error(`could not read Alpine's release list (HTTP ${res.status} from ${dir})`);
  const release = parseMinirootfs(await res.text());
  if (release === null) throw new Error("Alpine's release list names no minirootfs");
  return { ...release, url: `${dir}/${release.file}` };
}

/** How a base is named on the card. */
export const BASE_TITLES: Record<BaseImage, string> = { ubuntu: "Ubuntu", alpine: "Alpine" };

/** The provisioning script, run as root inside the distro with sh reading it from stdin. */
export function provisionScript(
  base: BaseImage,
  mirror: string,
  packages: readonly string[],
): string {
  const wslConf = [
    // Interop off is what makes the sandbox a sandbox: with it on, any Windows program started
    // inside bwrap runs as an ordinary host process, outside every namespace (measured).
    "cat > /etc/wsl.conf <<'EOF'",
    "[interop]",
    "enabled=false",
    "appendWindowsPath=false",
    "[user]",
    `default=${SANDBOX_USER}`,
    "EOF",
  ];
  if (base === "ubuntu") {
    const pkgs = ["bubblewrap", "ca-certificates", ...packages].filter(
      (p, i, all) => all.indexOf(p) === i,
    );
    return [
      "set -e",
      ...wslConf,
      "export DEBIAN_FRONTEND=noninteractive",
      ...(mirror === ""
        ? []
        : [
            // Both archives, since a mirror that carries one carries the other.
            `sed -i 's|${UBUNTU_ARCHIVE}/*|${mirror}/|; s|${UBUNTU_SECURITY}/*|${mirror}/|' /etc/apt/sources.list.d/ubuntu.sources`,
          ]),
      'echo "apt-get update"',
      "apt-get update",
      `echo "apt-get install ${pkgs.join(" ")}"`,
      `apt-get install -y --no-install-recommends ${pkgs.join(" ")}`,
      // Recommends are off, so the account tools are named rather than assumed.
      `id ${SANDBOX_USER} >/dev/null 2>&1 || useradd -m -s /bin/bash ${SANDBOX_USER}`,
      "bwrap --version",
      "echo PENGUIN-PROVISIONED",
      "",
    ].join("\n");
  }
  const pkgs = ["bubblewrap", "bash", ...packages].filter((p, i, all) => all.indexOf(p) === i);
  const repo = mirror === "" ? ALPINE_MIRROR : mirror;
  return [
    "set -e",
    ...wslConf,
    "ver=$(cut -d. -f1,2 /etc/alpine-release)",
    `printf '%s/v%s/main\\n%s/v%s/community\\n' '${repo}' "$ver" '${repo}' "$ver" > /etc/apk/repositories`,
    'echo "apk update"',
    "apk update",
    `echo "apk add ${pkgs.join(" ")}"`,
    `apk add --no-progress ${pkgs.join(" ")}`,
    `id ${SANDBOX_USER} >/dev/null 2>&1 || adduser -D -s /bin/bash ${SANDBOX_USER}`,
    "bwrap --version",
    "echo PENGUIN-PROVISIONED",
    "",
  ].join("\n");
}

export async function initialize(
  settings: WslSettings,
  report: (step: Text) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<Omit<TaskOutcome, "kind" | "at">> {
  const fail = (en: string, zh: string) => ({ ok: false, message: { en, zh } });
  const baseName = BASE_TITLES[settings.base];
  report({ en: "checking WSL", zh: "检查 WSL" });
  const host = await readHost();
  if (host.wsl !== "installed") {
    return fail(
      `WSL does not work on this machine yet (${host.problem ?? "not installed"}): install it first.`,
      `这台机器上的 WSL 还不可用（${host.problem ?? "未安装"}）：请先安装。`,
    );
  }
  const distro = settings.distro;
  const previous = readState();
  let version =
    previous?.distro === distro && previous.base === settings.base ? previous.version : "";
  const exists = host.distros.some((d) => d.toLowerCase() === distro.toLowerCase());
  if (exists) {
    // A distro already there is provisioned in place — with the package manager IT has, which
    // is not necessarily the one the setting now names. Asking it beats running apt in an
    // Alpine and reporting "apt-get: not found".
    report({ en: "reading what the existing distro is", zh: "读取现有发行版的类型" });
    const os = await runWsl(
      [
        "-d",
        distro,
        "-u",
        "root",
        "--cd",
        "/",
        "--exec",
        "/bin/sh",
        "-c",
        ". /etc/os-release; echo id=$ID",
      ],
      { timeoutMs: 60_000 },
    );
    const id = /id=(\w+)/.exec(os.stdout)?.[1] ?? "";
    if (id !== "" && id !== settings.base) {
      return fail(
        `${distro} already exists and is ${BASE_TITLES[id === "alpine" ? "alpine" : "ubuntu"]}, not ${baseName}. Remove it first, or set the base Linux back to what it is.`,
        `${distro} 已存在，且是 ${BASE_TITLES[id === "alpine" ? "alpine" : "ubuntu"]} 而非 ${baseName}。请先移除它，或把「基础 Linux」改回它本来的类型。`,
      );
    }
  }
  if (!exists) {
    report({ en: `asking ${baseName} for its base image`, zh: `查询 ${baseName} 的基础镜像` });
    let release;
    try {
      release = await resolveRelease(settings.base, fetchImpl);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return fail(`${why}.`, `${why}。`);
    }
    version = release.version;
    const rootfsDir = path.win32.join(stateDir(), "rootfs");
    fs.mkdirSync(rootfsDir, { recursive: true });
    const tarball = path.win32.join(rootfsDir, release.file);
    const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (!fs.existsSync(tarball) || sha(tarball) !== release.sha256) {
      const res = await fetchImpl(release.url);
      if (!res.ok || res.body === null) {
        return fail(
          `downloading ${release.file} failed: HTTP ${res.status}`,
          `下载 ${release.file} 失败：HTTP ${res.status}`,
        );
      }
      const total = release.size || Number(res.headers.get("content-length") ?? 0);
      const chunks: Buffer[] = [];
      let got = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
        got += chunk.byteLength;
        const pct = total > 0 ? ` ${Math.floor((got / total) * 100)}%` : "";
        report({
          en: `downloading ${baseName} ${release.version} (${(got / 1048576).toFixed(1)} MB${pct})`,
          zh: `下载 ${baseName} ${release.version}（${(got / 1048576).toFixed(1)} MB${pct}）`,
        });
      }
      fs.writeFileSync(`${tarball}.part`, Buffer.concat(chunks));
      fs.renameSync(`${tarball}.part`, tarball);
      if (sha(tarball) !== release.sha256) {
        fs.rmSync(tarball, { force: true });
        return fail(
          `${release.file} does not match its published sha256`,
          `${release.file} 与发布的 sha256 不符`,
        );
      }
    }
    report({ en: `importing ${distro} into WSL`, zh: `导入 ${distro} 到 WSL` });
    const disk = path.win32.join(stateDir(), "distros", distro);
    fs.mkdirSync(disk, { recursive: true });
    const imported = await runWsl(["--import", distro, disk, tarball, "--version", "2"], {
      timeoutMs: 10 * 60_000,
    });
    if (imported.code !== 0) {
      const why = imported.stdout || imported.stderr || `exit ${imported.code}`;
      return fail(`wsl --import failed: ${why}`, `wsl --import 失败：${why}`);
    }
  }
  report({
    en: "installing bubblewrap and tools inside the distro",
    zh: "在发行版内安装 bubblewrap 与工具",
  });
  let lastLine = "";
  const provisioned = await runWsl(
    ["-d", distro, "-u", "root", "--cd", "/", "--exec", "/bin/sh", "-s"],
    {
      timeoutMs: 20 * 60_000,
      input: provisionScript(settings.base, settings.mirror, settings.packages),
      onLine: (line) => {
        lastLine = line.trim();
        report({ en: `inside the distro: ${lastLine}`, zh: `发行版内：${lastLine}` });
      },
    },
  );
  if (provisioned.code !== 0 || !provisioned.stdout.includes("PENGUIN-PROVISIONED")) {
    const why = provisioned.stderr || lastLine || `exit ${provisioned.code}`;
    return fail(
      `provisioning ${distro} failed: ${why}. If packages could not be downloaded, set a reachable mirror.`,
      `配置 ${distro} 失败：${why}。如果是软件包下载失败，请设置一个可访问的镜像。`,
    );
  }
  report({
    en: "restarting the distro so interop stays off",
    zh: "重启发行版，使 interop 关闭生效",
  });
  await runWsl(["--terminate", distro], { timeoutMs: 60_000 });
  const state: WslState = {
    distro,
    user: SANDBOX_USER,
    base: settings.base,
    version,
    packages: settings.packages,
    initializedAt: new Date().toISOString(),
  };
  writeState(state);
  return {
    ok: true,
    message: {
      en: `The sandbox distro ${distro} (${baseName} ${version}) is ready: agent commands now run inside it under bubblewrap. Run the check to see what it confines.`,
      zh: `沙盒发行版 ${distro}（${baseName} ${version}）已就绪：Agent 的命令现在在其中通过 bubblewrap 执行。运行检查可查看隔离效果。`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Check — runs real commands through the same profile the provider builds.
// ---------------------------------------------------------------------------------------------

export async function check(
  settings: WslSettings,
  report: (step: Text) => void,
): Promise<{ result: Omit<TaskOutcome, "kind" | "at">; lines: CheckLine[] }> {
  const state = readState();
  if (state === null) {
    const text = { en: "The sandbox distro is not initialized yet.", zh: "沙盒发行版尚未初始化。" };
    return { result: { ok: false, message: text }, lines: [] };
  }
  const root = path.win32.join(stateDir(), "check");
  const ws = path.win32.join(root, "workspace");
  const outside = path.win32.join(root, "outside");
  const masked = path.win32.join(ws, "masked");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(masked, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.win32.join(masked, "token.txt"), "secret\n");
  const lx = (p: string) => toLinuxPath(p, state.distro) ?? p;
  const lines: CheckLine[] = [];
  const confined = async (policy: SandboxPolicy, script: string) => {
    const job = launchJob(["bash", "-c", script], policy, settings, state);
    return runWsl(wslArgs(job, ws), { timeoutMs: 60_000 });
  };
  const base: SandboxPolicy = { mode: "workspace-write", workspaceRoot: ws, writableTemp: true };
  const add = (en: string, zh: string, ok: boolean | null, detail: string) => {
    lines.push({ name: { en, zh }, ok, detail });
  };

  report({ en: "Windows interop is off", zh: "Windows interop 已关闭" });
  const interop = await runWsl(
    [
      "-d",
      state.distro,
      "-u",
      "root",
      "--cd",
      "/",
      "--exec",
      "/bin/sh",
      "-c",
      "/mnt/c/Windows/System32/cmd.exe /c exit 0 >/dev/null 2>&1; echo rc=$?",
    ],
    { timeoutMs: 60_000 },
  );
  add(
    "A Windows program cannot start from the distro",
    "发行版内无法启动 Windows 程序",
    !/rc=0\b/.test(interop.stdout),
    interop.stdout || interop.stderr,
  );

  report({ en: "the sandbox runs", zh: "沙盒可以运行" });
  const alive = await confined(base, "uname -sr; id -un");
  add(
    "bubblewrap starts a confined command",
    "bubblewrap 能启动被隔离的命令",
    alive.code === 0,
    alive.stdout || alive.stderr,
  );

  report({ en: "writing the Workspace", zh: "写工作区" });
  await confined(base, "echo ok > probe.txt");
  const wrote = fs.existsSync(path.win32.join(ws, "probe.txt"));
  add(
    "workspace-write: the Workspace is writable",
    "workspace-write：工作区可写",
    wrote,
    wrote ? "probe.txt written" : "no file appeared on Windows",
  );

  report({ en: "writing outside the Workspace", zh: "写工作区外" });
  // The command must FAIL, not merely leave Windows untouched: a write that lands in the
  // covering tmpfs reports success and disappears with the command, which reads to an agent
  // as permission it does not have.
  const out = await confined(base, `echo x > '${lx(outside)}/probe.txt' && echo WROTE`);
  const escaped = fs.existsSync(path.win32.join(outside, "probe.txt"));
  add(
    "workspace-write: a write outside the Workspace is refused, not silently lost",
    "workspace-write：工作区外的写入被拒绝，而不是悄悄丢失",
    !escaped && !out.stdout.includes("WROTE"),
    out.stderr || out.stdout || "the write reported success",
  );

  report({ en: "writing where the drives are covered", zh: "写被遮盖的磁盘路径" });
  const covered = await confined(base, "echo x > /mnt/c/Users/penguin-probe.txt && echo WROTE");
  add(
    "the mount that hides the drives refuses writes too",
    "遮盖磁盘的挂载同样拒绝写入",
    !covered.stdout.includes("WROTE"),
    covered.stderr || covered.stdout || "the write reported success",
  );

  report({ en: "read-only mode", zh: "只读模式" });
  const ro = await confined({ ...base, mode: "read-only" }, "echo x > ro.txt");
  const roWrote = fs.existsSync(path.win32.join(ws, "ro.txt"));
  add(
    "read-only: the Workspace is not writable",
    "read-only：工作区不可写",
    !roWrote,
    ro.stderr || ro.stdout,
  );

  report({ en: "the Windows drives", zh: "Windows 磁盘" });
  const drive = await confined(base, "test -e /mnt/c/Windows && echo visible || echo hidden");
  const visible = drive.stdout.includes("visible");
  add(
    settings.exposeWindowsDrives
      ? "Windows drives are visible read-only (setting on)"
      : "Windows drives outside the Workspace are hidden (setting off)",
    settings.exposeWindowsDrives
      ? "Windows 磁盘以只读方式可见（设置已开）"
      : "工作区以外的 Windows 磁盘不可见（设置已关）",
    visible === settings.exposeWindowsDrives,
    drive.stdout || drive.stderr,
  );

  report({ en: "the network", zh: "网络" });
  // A name rather than a literal address: a machine behind a proxy that rewrites addresses
  // refuses a connection to 1.1.1.1 while the network it actually uses works.
  const netProbe =
    "timeout 8 bash -c 'exec 3<>/dev/tcp/example.com/443' && echo connected || echo blocked";
  // Resolution is its own question: covering /mnt and /run took away the file
  // /etc/resolv.conf points at, so names failed while addresses still worked.
  const dnsProbe = "getent hosts example.com >/dev/null && echo resolved || echo unresolved";
  const none = await confined({ ...base, network: "none" }, netProbe);
  add(
    "network none: no connection",
    "network none：无法连接",
    none.stdout.includes("blocked"),
    none.stdout || none.stderr,
  );
  const open = await confined(base, netProbe);
  add(
    "network allowed: connects (information)",
    "允许网络：可以连接（仅供参考）",
    open.stdout.includes("connected") ? true : null,
    open.stdout || open.stderr,
  );
  const dns = await confined(base, dnsProbe);
  add(
    "network allowed: a host name resolves",
    "允许网络：域名可以解析",
    dns.stdout.includes("resolved") ? true : open.stdout.includes("connected") ? false : null,
    dns.stdout || dns.stderr,
  );

  report({ en: "a masked path", zh: "屏蔽路径" });
  const mask = await confined(
    { ...base, maskPaths: [masked] },
    `cat '${lx(masked)}/token.txt' 2>&1 || true`,
  );
  add(
    "mask-paths: a masked file cannot be read",
    "mask-paths：被屏蔽的文件不可读",
    !mask.stdout.includes("secret"),
    mask.stdout || mask.stderr,
  );

  report({ en: "writable temp", zh: "可写临时目录" });
  const tmp = await confined(base, "echo x > /tmp/probe && echo ok");
  add(
    "the temp directory is writable",
    "临时目录可写",
    tmp.stdout.includes("ok"),
    tmp.stdout || tmp.stderr,
  );

  fs.rmSync(root, { recursive: true, force: true });
  const failed = lines.filter((l) => l.ok === false);
  return {
    lines,
    result:
      failed.length === 0
        ? {
            ok: true,
            message: {
              en: `All ${lines.length} checks passed.`,
              zh: `全部 ${lines.length} 项检查通过。`,
            },
          }
        : {
            ok: false,
            message: {
              en: `${failed.length} of ${lines.length} checks failed: ${failed.map((l) => l.name.en).join("; ")}`,
              zh: `${lines.length} 项检查中有 ${failed.length} 项失败：${failed.map((l) => l.name.zh).join("；")}`,
            },
          },
  };
}

export async function remove(
  settings: WslSettings,
  report: (step: Text) => void,
): Promise<Omit<TaskOutcome, "kind" | "at">> {
  const distro = readState()?.distro ?? settings.distro;
  report({ en: `wsl --unregister ${distro}`, zh: `wsl --unregister ${distro}` });
  const res = await runWsl(["--unregister", distro], { timeoutMs: 5 * 60_000 });
  removeState();
  fs.rmSync(path.win32.join(stateDir(), "distros", distro), { recursive: true, force: true });
  if (
    res.code !== 0 &&
    !/WSL_E_DISTRO_NOT_FOUND|no distribution/i.test(`${res.stdout}${res.stderr}`)
  ) {
    const why = res.stdout || res.stderr;
    return {
      ok: false,
      message: { en: `wsl --unregister failed: ${why}`, zh: `wsl --unregister 失败：${why}` },
    };
  }
  return {
    ok: true,
    message: {
      en: `${distro} is removed with everything inside it. The sandbox backend stays off until you initialize again.`,
      zh: `${distro} 及其中所有内容已移除。在重新初始化之前，沙盒后端保持停用。`,
    },
  };
}
