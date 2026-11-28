/**
 * A conversation on another machine, for the frames that ask for one (`remote=1`): the connected
 * machine of the demo (gpu-box) holds one Session with a finished evaluation in it, and its link
 * can be moved through the states a conversation on it shows — dropped and reconnecting (an
 * attempt running, or the next one waited for), stopped by a person, given up, its password
 * refused, its server stopped, a job working on it — and back.
 *
 * Each state is written as the server writes it into the machines list (`MachineInfo.reconnect`,
 * `connection`, `status`, the job), so the app reads it through the same account it reads a real
 * server's with. A machine that is not connected answers no Session call (store.ts `sessionsOn`);
 * the hub's cached copy of its conversations stays readable.
 */
import type { MachineInfo, MachinesResponse, SessionInfo } from "@prismshadow/penguin-server/api";
import { IDS } from "./ids";
import {
  assistantText,
  meta,
  requestBegin,
  requestEnd,
  thinking,
  tokenUsage,
  toolCall,
  toolOutput,
  userText,
} from "./transcripts";
import type { ModelRef, Transcript } from "./transcripts";
import type { Lang } from "./types";

/** The states a frame can put the machine's link in. */
export const DEMO_LINKS = [
  "connected",
  /** Dropped; an attempt to bring it back is running. */
  "trying",
  /** Dropped; the next attempt is waited for, with its countdown. */
  "waiting",
  /** A person stopped the retries. */
  "cancelled",
  /** Every attempt of the streak failed. */
  "gaveUp",
  /** The stored password was refused: nothing retries until it changes. */
  "signInRefused",
  /** Its server was stopped and nothing brings it back. */
  "stopped",
  /** A job (an update) is working on it, its connection down meanwhile. */
  "updating",
] as const;
export type DemoLink = (typeof DEMO_LINKS)[number];

export const isDemoLink = (value: unknown): value is DemoLink =>
  (DEMO_LINKS as readonly unknown[]).includes(value);

/** The demo's streak: how many failures in a row stop it, and how long the next wait runs. */
const MAX_ATTEMPTS = 5;
const WAIT_MS = 16_000;

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Puts the machine's entry (and its job) in `link`. Anything another state set is cleared first,
 * so the states can follow each other in any order.
 */
export function applyLink(
  machines: MachinesResponse,
  link: DemoLink,
  now: number,
  /** A Retry begins a new streak: its first attempt runs. */
  fresh = false,
): void {
  const entry = machines.machines.find((m) => m.id === IDS.remote.machine);
  if (entry === undefined) return;
  machines.jobs = machines.jobs.filter((job) => job.machineId !== entry.id);
  if (machines.job?.machineId === entry.id) machines.job = null;
  delete entry.reconnect;
  const since = iso(now - 40_000);
  const lastError = "ssh: connect to host gpu-box port 22: Connection timed out";
  const down = (patch: Partial<MachineInfo>) => {
    entry.connection = null;
    entry.socket = null;
    entry.api = { failedAt: iso(now - 2_000), detail: "connection closed" };
    Object.assign(entry, patch);
  };
  const streak = (attempts: number, rest: Partial<NonNullable<MachineInfo["reconnect"]>>) => ({
    since,
    attempts,
    maxAttempts: MAX_ATTEMPTS,
    nextAt: null,
    lastError: attempts === 0 ? null : lastError,
    diagnosis: null,
    ...rest,
  });
  switch (link) {
    case "connected":
      entry.connection = { pid: 41_226 };
      entry.socket = null;
      entry.api = { answeredAt: iso(now) };
      entry.status = { state: "running", checkedAt: iso(now), port: 7364 };
      return;
    case "trying":
      return down({ reconnect: streak(fresh ? 0 : 1, fresh ? { since: iso(now) } : {}) });
    case "waiting":
      return down({ reconnect: streak(1, { nextAt: iso(now + WAIT_MS) }) });
    case "cancelled":
      return down({ reconnect: streak(2, { gaveUp: "cancelled" }) });
    case "gaveUp":
      return down({ reconnect: streak(MAX_ATTEMPTS, { gaveUp: "attempts" }) });
    case "signInRefused":
      return down({
        reconnect: streak(1, { waitsForPassword: true, sshReason: "password-rejected" }),
      });
    case "stopped":
      return down({ status: { state: "stopped", checkedAt: iso(now) } });
    case "updating": {
      down({});
      const job = {
        kind: "use" as const,
        machineId: entry.id,
        alias: entry.alias,
        queued: false,
        running: true,
        steps: ["check" as const, "install" as const, "restart" as const, "connect" as const],
        phase: "install" as const,
        log: ["install"],
        result: null,
      };
      machines.jobs.push(job);
      machines.job = job;
      return;
    }
  }
}

/** Whether a link reads as the machine being down (a Session call there is refused). */
export const linkDown = (link: DemoLink) => link !== "connected";

const COPY: Record<
  Lang,
  { title: string; turns: { prompt: string; thinking?: string; output?: string; answer: string }[] }
> = {
  en: {
    title: "Evaluate the fine-tuned checkpoint",
    turns: [
      {
        prompt: "Run the docs QA eval against runs/ft-1126 and tell me how it does.",
        thinking:
          "The eval script reads the checkpoint path and the case file; the GPU is free, so one run over the 120 cases is enough to compare with the last checkpoint.",
        output: [
          "Loading runs/ft-1126 … done (7.2 GB)",
          "Cases: 120   batch: 8   device: cuda:0",
          "",
          "category      cases   exact   cited",
          "hooks            30    0.87    0.93",
          "mcp              30    0.80    0.90",
          "memory           30    0.83    0.97",
          "citations        30    0.90    1.00",
          "",
          "overall         120    0.85    0.95",
        ].join("\n"),
        answer:
          "The fine-tuned checkpoint answers **85%** of the 120 cases exactly, and **95%** of its answers cite a real file.\n\nThe weakest category is **mcp** (80% exact): most misses there quote the old `mcpServers` key instead of `[mcp.servers]`.",
      },
      {
        prompt: "How does that compare with the previous checkpoint?",
        answer:
          "Better on every category:\n\n| category | ft-1119 | ft-1126 |\n| --- | --- | --- |\n| hooks | 0.80 | 0.87 |\n| mcp | 0.73 | 0.80 |\n| memory | 0.83 | 0.83 |\n| citations | 0.87 | 0.90 |\n| **overall** | **0.81** | **0.85** |\n\nMemory did not move; the other three gained 3 to 7 points.",
      },
      {
        prompt: "Write the comparison into results/ft-1126.md.",
        output: "Wrote results/ft-1126.md (18 lines).",
        answer:
          "Saved `results/ft-1126.md` with the table, the run's command line and the five mcp cases it still gets wrong.",
      },
    ],
  },
  zh: {
    title: "评估微调后的检查点",
    turns: [
      {
        prompt: "用 runs/ft-1126 跑一遍文档问答评测，看看效果怎么样。",
        thinking:
          "评测脚本读取检查点路径和用例文件；GPU 空闲，跑一遍 120 个用例就够和上一个检查点比较。",
        output: [
          "Loading runs/ft-1126 … done (7.2 GB)",
          "Cases: 120   batch: 8   device: cuda:0",
          "",
          "category      cases   exact   cited",
          "hooks            30    0.87    0.93",
          "mcp              30    0.80    0.90",
          "memory           30    0.83    0.97",
          "citations        30    0.90    1.00",
          "",
          "overall         120    0.85    0.95",
        ].join("\n"),
        answer:
          "微调后的检查点在 120 个用例中答对 **85%**，**95%** 的回答引用了真实存在的文件。\n\n最弱的是 **mcp**（答对 80%）：答错的大多还在引用旧的 `mcpServers` 键，而不是 `[mcp.servers]`。",
      },
      {
        prompt: "和上一个检查点比呢？",
        answer:
          "每一类都更好：\n\n| 类别 | ft-1119 | ft-1126 |\n| --- | --- | --- |\n| hooks | 0.80 | 0.87 |\n| mcp | 0.73 | 0.80 |\n| memory | 0.83 | 0.83 |\n| citations | 0.87 | 0.90 |\n| **总体** | **0.81** | **0.85** |\n\nmemory 没有变化，其余三类提高了 3 到 7 个百分点。",
      },
      {
        prompt: "把对比结果写进 results/ft-1126.md。",
        output: "Wrote results/ft-1126.md (18 lines).",
        answer:
          "已保存 `results/ft-1126.md`：对比表、这次运行的命令行，以及 mcp 里仍然答错的五个用例。",
      },
    ],
  },
};

/** The machine's Session row, as the machine's own list answers it. */
export function remoteSessionRow(lang: Lang, now: number, ref: ModelRef): SessionInfo {
  const at = iso(now - 6 * 60_000);
  return {
    sessionId: IDS.remote.session,
    projectId: IDS.project,
    agentId: IDS.agents.docs,
    provider: ref.provider,
    modelId: ref.modelId,
    workspace: IDS.remote.workspace,
    approvalMode: "allow-all",
    sandbox: { mode: "workspace-write", network: "open" },
    title: COPY[lang].title,
    createdAt: iso(now - 25 * 60_000),
    lastActiveAt: at,
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: false,
    client: "web",
  };
}

/** Three finished Tasks: an eval run, a comparison table, a file written. */
export function remoteTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const t0 = now - 25 * 60_000;
  const s = (sec: number) => t0 + sec * 1000;
  const [run, compare, write] = COPY[lang].turns as [
    (typeof COPY)["en"]["turns"][number],
    (typeof COPY)["en"]["turns"][number],
    (typeof COPY)["en"]["turns"][number],
  ];
  return {
    running: false,
    history: [
      meta(s(0), IDS.remote.session, ref, IDS.remote.workspace),
      userText(s(0), run.prompt),
      requestBegin(s(0.4)),
      thinking(s(4), run.thinking!),
      toolCall(s(5), "call_eval", "exec_command", {
        cmd: "python scripts/eval.py --ckpt runs/ft-1126 --cases eval/docs-qa.jsonl",
        description: lang === "zh" ? "运行文档问答评测" : "Run the docs QA eval",
      }),
      requestEnd(s(5.1)),
      toolOutput(s(96), "call_eval", run.output!),
      requestBegin(s(96.3)),
      assistantText(s(104), run.answer),
      tokenUsage(s(104.2), 21_600, 9_800),
      requestEnd(s(104.2)),
      userText(s(300), compare.prompt),
      requestBegin(s(300.3)),
      assistantText(s(309), compare.answer),
      tokenUsage(s(309.2), 33_900, 12_300),
      requestEnd(s(309.2)),
      userText(s(1100), write.prompt),
      requestBegin(s(1100.3)),
      toolCall(s(1104), "call_write", "write_file", {
        path: "results/ft-1126.md",
        content: "# ft-1126 vs ft-1119\n",
      }),
      requestEnd(s(1104.1)),
      toolOutput(s(1104.4), "call_write", write.output!),
      requestBegin(s(1104.7)),
      assistantText(s(1109), write.answer),
      tokenUsage(s(1109.2), 47_100, 13_200),
      requestEnd(s(1109.2)),
    ],
  };
}
