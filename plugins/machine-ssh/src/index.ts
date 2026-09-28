/**
 * @prismshadow/penguin-plugin-machine-ssh — the ssh machine KIND: every alias of the server
 * account's `~/.ssh/config` is a machine, `ssh:<alias>`, reached through ONE `ssh -T -D` session
 * the host holds for it.
 *
 * A PLUGIN PACKAGE, not part of the platform: it compiles against the
 * `@prismshadow/penguin-server/plugin` surface (types only) and contributes to
 * `MachinesModule.kinds`. It is RESIDENT — loaded on every server whatever the Projects list
 * (packages/server/src/plugin/loader.ts RESIDENT_PLUGINS) — because machines were ssh before
 * kinds were plugins.
 *
 * What it hands the host (mechanisms/machines.ts), and nothing more:
 *
 *   launch   `ssh -T -D 127.0.0.1:<port> [-M -S <control>] [<forwards>] <alias> sh` — the host
 *            spawns it and frames its commands; the SOCKS port and the control socket ride in
 *            `carry`
 *   dial     a SOCKS5 CONNECT through that port: every TCP connection to the machine is a
 *            channel inside the one session (socks.ts) — what VS Code Remote-SSH does, and for
 *            the same reason: Win32 OpenSSH has no ControlMaster, so "one connection" means
 *            never starting a second process
 *   oneShot  `ssh <alias> <command>` / scp, for a Windows remote alone (cmd.exe has no `sh`)
 *   discover the config's aliases; define/read = its Host blocks (config.ts)
 *   forwards `-L` / `-R` — this kind's own extension (below)
 *
 * Two rules the argv encodes:
 * - **BatchMode.** A GUI app has no terminal: an ssh that decides to ask for a password or a
 *   key passphrase would hang forever with nothing to type into. BatchMode turns that into an
 *   immediate, readable failure — key or agent authentication only, and `diagnose` says so.
 * - **The user override rides the command line, never the config.** `-o User=…` selects the
 *   account for this connection.
 *
 * PORT FORWARDS ride the session. On POSIX the session is the master of a control socket
 * (`-M -S`), and a forward is added to or taken off the LIVE session with `ssh -O forward` /
 * `-O cancel` — no second connection, no restart, and a port that will not bind fails that one
 * ask rather than the session (the session's own ExitOnForwardFailure guards only what it was
 * started with: the SOCKS listener). Win32 OpenSSH has no multiplexing, so a session there
 * carries its forwards in its START arguments: a change of the wanted set reopens the session
 * with the new set, and what ssh says of a forward it could not bind is read off its stderr.
 * The wanted set and ssh's answers are kept in the session's memo, which the host delivers
 * with the session across a hot push.
 */
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import type {
  ExecResult,
  ForwardFact,
  ForwardSpec,
  Machine,
  MachineDefinition,
  MachineDial,
  MachineForm,
  MachineForwards,
  MachineKind,
  MachineSession,
  ShellLaunch,
} from "@prismshadow/penguin-server/plugin";
import {
  appendHostBlock,
  findHostBlock,
  listHostAliases,
  readSshConfig,
  renderHostBlock,
  replaceHostBlock,
  validateHostEntry,
  writeSshConfig,
} from "./config.js";
import type { SshHostEntry } from "./config.js";
import { dialThroughSocks } from "./socks.js";

export {
  appendHostBlock,
  findHostBlock,
  listHostAliases,
  parseHostAliases,
  readSshConfig,
  renderHostBlock,
  replaceHostBlock,
  useSshDir,
  validateHostEntry,
  writeSshConfig,
} from "./config.js";
export type { HostBlockFound, SshHostEntry, SshHostProblem } from "./config.js";
export { dialThroughSocks } from "./socks.js";

// --- running ssh ------------------------------------------------------------------------------

/** Enough for a payload transfer over a slow link, short enough to not hang a menu forever. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** A program, its argv straight to execFile (no shell on this side), its failure returned. */
export function run(
  file: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === "number"
            ? ((error as NodeJS.ErrnoException & { code: number }).code as number)
            : error
              ? 1
              : 0;
        // execFile signals a timeout by killing the child: `killed` is set and there is no
        // numeric exit code of its own.
        const killed = (error as (Error & { killed?: boolean }) | null)?.killed === true;
        resolve({
          code,
          stdout: String(stdout),
          stderr: String(stderr),
          timedOut: killed && error !== null,
        });
      },
    );
  });
}

/** One command with `input` on its stdin — the Windows installer's store, a tarball. */
export function runWithInput(
  file: string,
  args: string[],
  opts: { input: Buffer; timeoutMs?: number },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // Decoding is the stream's, not each chunk's: a multibyte character whose bytes land in
    // two `data` events would otherwise become two replacement characters.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text: string) => (stdout += text));
    child.stderr.on("data", (text: string) => (stderr += text));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}${err.message}\n`, timedOut });
    });
    // A remote that never reads stdin (a refused connection) closes the pipe under us.
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input);
  });
}

/** True when the failure is "ssh could not authenticate without asking" — the BatchMode wall. */
export function looksLikeAuthFailure(result: ExecResult): boolean {
  return /permission denied|no supported authentication|host key verification failed/i.test(
    result.stderr,
  );
}

// --- the argv ---------------------------------------------------------------------------------

export interface SshTarget {
  /** Alias as written in ~/.ssh/config — what the person picked. */
  alias: string;
  /** Login account. Empty means "whatever ssh resolves", i.e. no -o User override. */
  user: string;
}

function connectionOptions(target: SshTarget): string[] {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    ...(target.user === "" ? [] : ["-o", `User=${target.user}`]),
  ];
}

/** `ssh <options> <alias> <remote command>`. */
export function sshArgs(target: SshTarget, remoteCommand: string): string[] {
  return [...connectionOptions(target), target.alias, remoteCommand];
}

/**
 * `scp <options> <files…> <alias>:<dir>`. The remote path is NOT quoted: current OpenSSH
 * transfers over SFTP, where the path is taken literally and quotes would become part of the
 * name. Scratch directories are chosen without quotes or shell metacharacters for that reason.
 */
export function scpArgs(target: SshTarget, localFiles: string[], remoteDir: string): string[] {
  return [...connectionOptions(target), ...localFiles, `${target.alias}:${remoteDir}`];
}

/**
 * `ssh -T -D 127.0.0.1:<port> <alias> sh` — the ONE connection to a machine. `-T` because it is
 * a command channel, not a terminal; `sh` rather than a login shell, so a profile's banner
 * cannot land in the first command's output; `-D` so the session doubles as a SOCKS server on
 * a loopback port of ours, through which every TCP connection to the machine is a channel
 * inside this same session. ExitOnForwardFailure turns "local port taken" into an exit instead
 * of a session that silently cannot dial, and the keepalives surface a dead link within a
 * minute.
 */
export function sessionArgs(
  target: SshTarget,
  socksPort: number,
  /** The control socket this session is master of (POSIX; Win32 OpenSSH has no multiplexing). */
  controlPath: string | null = null,
  /**
   * Forwards carried from the start — the way a session without a control socket carries
   * them (Win32 OpenSSH): the set changes, the session is reopened with the new set.
   */
  forwards: readonly ForwardSpec[] = [],
): string[] {
  if (!Number.isInteger(socksPort) || socksPort < 1 || socksPort > 65535) {
    throw new Error(`bad port ${socksPort}`);
  }
  return [
    ...connectionOptions(target),
    "-T",
    // With forwards in the start args, a port that will not bind must NOT end the session —
    // it is reported (ssh says so on stderr) and the session goes on carrying the rest. The
    // SOCKS port is chosen free moments before the spawn, which is what the exit guarded.
    "-o",
    `ExitOnForwardFailure=${forwards.length === 0 ? "yes" : "no"}`,
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    // The master of a control socket, so a port forward can be added to or taken off THIS
    // session later (`-O forward` / `-O cancel`, forwardControlArgs) instead of a second
    // connection or a restart of this one. ControlPersist stays off: the session lives as
    // long as the host holds it, and dies with it.
    ...(controlPath === null ? [] : ["-M", "-S", controlPath]),
    ...forwards.flatMap((spec) => forwardFlag(spec)),
    "-D",
    `127.0.0.1:${socksPort}`,
    target.alias,
    "sh",
  ];
}

/**
 * The forward as ssh spells it: `-L` listens HERE and delivers to the machine's port, `-R`
 * listens on the MACHINE and delivers to ours. Both ends are the loopback by name — a
 * forward is never an open door on either network.
 */
export function forwardFlag(spec: ForwardSpec): [flag: "-L" | "-R", value: string] {
  for (const port of [spec.localPort, spec.remotePort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`bad port ${port}`);
  }
  return spec.direction === "in"
    ? ["-L", `127.0.0.1:${spec.localPort}:127.0.0.1:${spec.remotePort}`]
    : ["-R", `127.0.0.1:${spec.remotePort}:127.0.0.1:${spec.localPort}`];
}

/**
 * `ssh -S <control> -O forward|cancel -L|-R <spec> <alias>`: asks the master holding the
 * session to add or drop one forward. Answered by the master over the socket — no new
 * connection, and a forward that cannot bind fails THIS command, not the session.
 */
export function forwardControlArgs(
  target: SshTarget,
  controlPath: string,
  op: "forward" | "cancel",
  spec: ForwardSpec,
): string[] {
  return [
    ...connectionOptions(target),
    "-S",
    controlPath,
    "-O",
    op,
    ...forwardFlag(spec),
    target.alias,
  ];
}

/**
 * The ports ssh could not forward, read off a session's stderr. `-R`: "Warning: remote port
 * forwarding failed for listen port 5432". `-L`: "bind [127.0.0.1]:3000: Address already in
 * use" followed by "channel_setup_fwd_listener_tcpip: cannot listen to port: 3000".
 */
export function forwardFailures(stderr: string): Map<number, string> {
  const failed = new Map<number, string>();
  for (const line of stderr.split(/\r?\n/)) {
    const remote = /remote port forwarding failed for listen port (\d+)/.exec(line);
    if (remote) failed.set(Number(remote[1]), line.trim());
    const local = /cannot listen to port: (\d+)/.exec(line);
    if (local) failed.set(Number(local[1]), line.trim());
  }
  return failed;
}

// --- the session ------------------------------------------------------------------------------

/** Whether sessions master a control socket at all; a test turns it off to walk the Windows path on POSIX. */
let controlSockets = true;
export function useControlSockets(enabled: boolean): void {
  controlSockets = enabled;
}

/**
 * Where the control socket goes: the temp directory, under a short name — a unix socket path
 * has about a hundred characters to spend, and macOS's temp directory takes half of them.
 */
function controlPathFor(alias: string): string | null {
  if (process.platform === "win32" || !controlSockets) return null;
  const short = createHash("sha256").update(`ssh:${alias}`).digest("base64url").slice(0, 12);
  return path.join(os.tmpdir(), `penguin-ssh-${short}.sock`);
}

/** A local port nothing is on: the kernel's answer, bound and released rather than guessed. */
function freeLocalPort(): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(null));
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : null;
      probe.close(() => resolve(port));
    });
  });
}

/** What this kind carries on a child (ShellLaunch.carry). */
interface SshCarry {
  socksPort: number;
  controlPath: string | null;
  /** The forwards in this child's start arguments (no control socket). */
  forwards: ForwardSpec[];
}

const carryOf = (session: MachineSession): SshCarry | null => session.carry() as SshCarry | null;

/** A stable key for a forward: what the wanted set and the facts are indexed by. */
export function forwardKey(spec: ForwardSpec): string {
  return `${spec.direction}:${spec.localPort}:${spec.remotePort}`;
}

/**
 * What this kind keeps in a session's memo: the forwards wanted on it, and what ssh last said
 * of each — for the child whose pid is `factsPid`, since a fact dies with its child.
 */
interface ForwardMemo {
  wanted: Map<string, ForwardSpec>;
  facts: Map<string, ForwardFact>;
  factsPid: number | null;
  /** The child the wanted set has been asked of (control socket), or null. */
  appliedPid: number | null;
}

const MEMO_KEY = "ssh.forwards.v1";

function memoOf(session: MachineSession): ForwardMemo {
  const memo = session.memo();
  let entry = memo.get(MEMO_KEY) as ForwardMemo | undefined;
  if (entry === undefined) {
    entry = { wanted: new Map(), facts: new Map(), factsPid: null, appliedPid: null };
    memo.set(MEMO_KEY, entry);
  }
  return entry;
}

/** Asking the master over the control socket is local: a slow answer is a wedged master. */
const CONTROL_TIMEOUT_MS = 15_000;

const sameSet = (a: readonly ForwardSpec[], b: ReadonlyMap<string, ForwardSpec>) =>
  a.length === b.size && a.every((spec) => b.has(forwardKey(spec)));

/** The ssh kind's port forwards: `-L` / `-R` on the one session, however it can carry them. */
class SshForwards implements MachineForwards {
  constructor(private readonly target: SshTarget) {}

  async set(session: MachineSession, specs: readonly ForwardSpec[]): Promise<void> {
    const memo = memoOf(session);
    const wanted = new Map(specs.map((spec) => [forwardKey(spec), spec]));
    const dropped = [...memo.wanted.keys()].filter((key) => !wanted.has(key));
    const added = [...wanted.keys()].filter((key) => !memo.wanted.has(key));
    const carry = carryOf(session);
    const pid = session.session()?.pid ?? null;
    if (carry === null || carry.controlPath === null) {
      // Start arguments: the set is what the next start carries. A live child started with
      // another set is reopened now, not on the backoff — someone just asked for this.
      memo.wanted = wanted;
      if (dropped.length > 0 || added.length > 0) memo.facts.clear();
      if (carry !== null && !sameSet(carry.forwards, wanted)) await session.reopen();
      return;
    }
    const live = pid !== null && memo.appliedPid === pid;
    for (const key of dropped) {
      const spec = memo.wanted.get(key)!;
      memo.wanted.delete(key);
      memo.facts.delete(key);
      if (live) await this.#control(carry.controlPath, "cancel", spec);
    }
    for (const key of added) memo.wanted.set(key, wanted.get(key)!);
    if (live) for (const key of added) await this.#ask(memo, carry.controlPath, pid, key);
  }

  facts(session: MachineSession): { spec: ForwardSpec; fact: ForwardFact }[] {
    const memo = memoOf(session);
    const pid = session.session()?.pid ?? null;
    if (pid === null || memo.factsPid !== pid) return [];
    return [...memo.facts].flatMap(([key, fact]) => {
      const spec = memo.wanted.get(key);
      return spec === undefined ? [] : [{ spec, fact }];
    });
  }

  /**
   * Every wanted forward, asked of the master that just came up — or, for a session that
   * carried them in its arguments, read off what ssh said while connecting.
   */
  async up(session: MachineSession): Promise<void> {
    const memo = memoOf(session);
    const carry = carryOf(session);
    const pid = session.session()?.pid ?? null;
    if (carry === null || pid === null) return;
    memo.appliedPid = pid;
    if (memo.factsPid !== pid) {
      memo.facts.clear();
      memo.factsPid = pid;
    }
    if (carry.controlPath === null) {
      const failed = forwardFailures(session.said());
      for (const spec of carry.forwards) {
        const port = spec.direction === "in" ? spec.localPort : spec.remotePort;
        const said = failed.get(port);
        memo.facts.set(
          forwardKey(spec),
          said === undefined ? { ok: true } : { ok: false, detail: said },
        );
      }
      return;
    }
    for (const key of memo.wanted.keys()) await this.#ask(memo, carry.controlPath, pid, key);
  }

  async #ask(memo: ForwardMemo, controlPath: string, pid: number, key: string): Promise<void> {
    const spec = memo.wanted.get(key);
    if (spec === undefined) return;
    const result = await this.#control(controlPath, "forward", spec);
    if (!memo.wanted.has(key)) return; // dropped while the master was answering
    if (memo.factsPid !== pid) {
      memo.facts.clear();
      memo.factsPid = pid;
    }
    memo.facts.set(key, result);
  }

  /** One `-O forward` / `-O cancel` at the master. Never throws; ssh's own words are the detail. */
  async #control(
    controlPath: string,
    op: "forward" | "cancel",
    spec: ForwardSpec,
  ): Promise<ForwardFact> {
    const result = await run("ssh", forwardControlArgs(this.target, controlPath, op, spec), {
      timeoutMs: CONTROL_TIMEOUT_MS,
    });
    if (result.code === 0) return { ok: true };
    const said = (result.stderr + result.stdout).trim().split("\n").pop() ?? "";
    return { ok: false, detail: said === "" ? `ssh -O ${op} exited ${result.code}` : said };
  }
}

/** One ssh machine: its alias, and nothing else — ssh resolves the rest every time. */
export class SshMachine implements Machine {
  readonly #forwards: SshForwards;

  constructor(readonly target: SshTarget) {
    this.#forwards = new SshForwards(target);
  }

  async launch(session: MachineSession): Promise<ShellLaunch> {
    const port = await freeLocalPort();
    if (port === null)
      throw new Error("could not start ssh: no free local port for its SOCKS listener");
    const controlPath = controlPathFor(this.target.alias);
    const forwards = controlPath === null ? [...memoOf(session).wanted.values()] : [];
    const carry: SshCarry = { socksPort: port, controlPath, forwards };
    return {
      program: "ssh",
      args: sessionArgs(this.target, port, controlPath, forwards),
      carry: carry as unknown as Record<string, unknown>,
    };
  }

  up(session: MachineSession): Promise<void> {
    return this.#forwards.up(session);
  }

  /** Nothing to bring up: an ssh host is there or it is not, and the session says which. */
  async ready(): Promise<{ ok: true }> {
    return { ok: true };
  }

  async dial(port: number, via: MachineDial): Promise<net.Socket> {
    const carry = carryOf(via.session);
    if (carry === null) throw new Error("the ssh session is not up");
    return dialThroughSocks(carry.socksPort, "127.0.0.1", port);
  }

  oneShot(command: string, opts: { timeoutMs?: number; input?: Buffer }): Promise<ExecResult> {
    const args = sshArgs(this.target, command);
    return opts.input !== undefined
      ? runWithInput("ssh", args, {
          input: opts.input,
          ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
        })
      : run("ssh", args, opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs });
  }

  copyTo(localFiles: string[], remoteDir: string): Promise<ExecResult> {
    return run("scp", scpArgs(this.target, localFiles, remoteDir));
  }

  diagnose(result: ExecResult): string | null {
    return looksLikeAuthFailure(result)
      ? "Connections use BatchMode: set up key or agent authentication for that host first."
      : null;
  }

  forwards(): MachineForwards {
    return this.#forwards;
  }
}

/** The page's form: a Host block's alias and the options this app writes. */
const FORM: MachineForm = {
  name: {
    type: "string",
    title: "Alias (Host)",
    titleZh: "别名（Host）",
    description: "One word; `ssh <alias>` and this page both call the machine by it.",
    descriptionZh: "一个词，之后 `ssh <别名>` 和这里都用它称呼这台机器。",
    placeholder: "build-box",
    required: true,
  },
  fields: {
    hostName: {
      type: "string",
      title: "Address (HostName)",
      titleZh: "地址（HostName）",
      description: "An IP address or a domain name.",
      descriptionZh: "IP 或域名。",
      placeholder: "192.168.1.20",
      required: true,
    },
    user: {
      type: "string",
      title: "User",
      titleZh: "用户（User）",
      description: "Empty: the server account's own user name.",
      descriptionZh: "留空则用本服务端账户的用户名。",
      placeholder: "deploy",
    },
    port: {
      type: "number",
      title: "Port",
      titleZh: "端口（Port）",
      description: "Empty: 22.",
      descriptionZh: "留空为 22。",
      placeholder: "22",
      minimum: 1,
      maximum: 65535,
    },
    identityFile: {
      type: "string",
      title: "Key file (IdentityFile)",
      titleZh: "密钥文件（IdentityFile）",
      description: "Empty: ssh's default keys.",
      descriptionZh: "留空则用 ssh 的默认密钥。",
      placeholder: "~/.ssh/id_ed25519",
    },
  },
};

/** A form's values as a host entry; a port may arrive as a string from a form. */
function entryOf(name: string, values: Record<string, unknown>): SshHostEntry {
  const str = (key: string) =>
    typeof values[key] === "string" && values[key] !== "" ? (values[key] as string) : undefined;
  const raw = values.port;
  const port =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : undefined;
  return {
    alias: name,
    hostName: str("hostName") ?? "",
    ...(str("user") === undefined ? {} : { user: str("user")! }),
    ...(port === undefined ? {} : { port }),
    ...(str("identityFile") === undefined ? {} : { identityFile: str("identityFile")! }),
  };
}

const PROBLEM_WORDS = { required: "required", invalid: "must be one word, with no space or #" };

/** The ssh kind: the config's aliases are the machines; a new one is a Host block appended. */
export class SshKind implements MachineKind {
  constructor(private readonly now: () => Date = () => new Date()) {}

  /** The config's aliases, read afresh each time: one file read, no process, no network. */
  discover(): string[] {
    return listHostAliases();
  }

  form(): MachineForm {
    return FORM;
  }

  async define(
    name: string,
    values: Record<string, unknown>,
    existing: boolean,
  ): Promise<MachineDefinition> {
    const entry = entryOf(name, values);
    const problem = validateHostEntry(entry);
    if (problem !== null) {
      return {
        ok: false,
        field: problem.field === "alias" ? "name" : problem.field,
        message: PROBLEM_WORDS[problem.why],
      };
    }
    if (!existing) {
      // ssh takes the first block that matches, so a second one would be silently ignored.
      if (listHostAliases().includes(entry.alias.trim())) {
        return { ok: false, field: "name", message: "that alias is already in the ssh config" };
      }
      appendHostBlock(renderHostBlock(entry, this.now()));
      return { ok: true, spec: null };
    }
    const text = readSshConfig();
    const found = text === null ? null : findHostBlock(text, name);
    if (text === null || found === null) {
      return { ok: false, field: null, message: "no Host block for that alias in ~/.ssh/config" };
    }
    if (!found.ours) {
      return {
        ok: false,
        field: null,
        message: "that block was written by hand; edit it in ~/.ssh/config",
      };
    }
    writeSshConfig(replaceHostBlock(text, found, renderHostBlock(entry, this.now())));
    return { ok: true, spec: null };
  }

  /**
   * A host's block as the page can show it back: what it says, and whether this app wrote it
   * — only then may it be rewritten. A hand-written block may carry options this app does not
   * know (a jump host, a key agent setting), and rewriting it would drop them.
   */
  read(name: string): { values: Record<string, unknown>; editable: boolean } | null {
    const text = readSshConfig();
    const found = text === null ? null : findHostBlock(text, name);
    if (found === null) return null;
    const { alias: _alias, ...values } = found.entry;
    return { values, editable: found.ours };
  }

  connect(name: string): Machine {
    return new SshMachine({ alias: name, user: "" });
  }
}

/** The contribution: the ssh kind, under the address prefix `ssh`. */
@Component({
  contributes: {
    "WebModule.quickStarts": [
      {
        id: "machine-ssh.quick-start",
        prompt:
          "Check which hosts in this server's ~/.ssh/config it can reach as a machine. For each Host alias (skip patterns with * or ?), run `ssh -o BatchMode=yes -o ConnectTimeout=5 <alias> 'uname -sm'` as its own command, then report a table: alias, whether it answered, and what it printed or the error. Explain that a host failing with 'Permission denied' needs key or agent authentication set up before the Machines page can use it.",
        promptZh:
          "检查本服务端 ~/.ssh/config 里哪些主机能作为机器连上。对每个 Host 别名（跳过带 * 或 ? 的模式），单独执行一条 `ssh -o BatchMode=yes -o ConnectTimeout=5 <别名> 'uname -sm'`，然后用表格报告：别名、是否有应答、输出或报错。说明报 'Permission denied' 的主机要先配好密钥或 agent 认证，机器页才能使用它。",
      },
    ],
    "MachinesModule.kinds": [{ id: "machine-ssh.kind", kind: "ssh", title: "SSH" }],
  },
})
export class MachineSsh {
  @Bind("machine-ssh.kind") kind!: MachineKind;

  setup() {
    this.kind = new SshKind();
  }
}

const plugin: Plugin = { modules: [MachineSsh] };
export default plugin;
