/**
 * A real Session under allow-all may read context but cannot execute before the signed-in
 * user approves the current revision. Chat replies revise the proposal, and one approval
 * never carries into the next task. Only the provider's HTTP responses are scripted.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import {
  createAgent,
  installPlugin,
  libraryPlugin,
  saveProjectConfig,
  userText,
} from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import { openDatabase } from "../src/db/database.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import { ChannelHub } from "../src/runtime/channel.js";
import { SessionManager, createCoreSessionLoader } from "../src/runtime/session-manager.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import { makeTempRoot, waitFor } from "./helpers.js";
import { MOCK_MODEL_ID, requestText, startMockLLM, type MockReply } from "./live-session.js";

it(
  "reads, clarifies, revises and executes exactly one approved proposal, then returns to planning",
  { timeout: 45_000 },
  async () => {
    const root = await makeTempRoot();
    const replies: MockReply[] = [];
    const mock = await startMockLLM(() => replies.shift() ?? "What should this task achieve?");
    const db = openDatabase(":memory:");
    const sessions = wire(SessionsRepo, { db });
    const channels = new ChannelHub();
    const manager = new SessionManager({
      sessions,
      channels,
      sources: new SessionSources(),
      loader: createCoreSessionLoader(root),
      recorder: { record: async () => {} },
      log: () => {},
    });
    try {
      const p = "test_project",
        a = "plan_agent";
      const model = { provider: "custom", model_id: MOCK_MODEL_ID };
      await saveProjectConfig(root, p, {
        default_model: model,
        models: [{ ...model, context_window: 200000, api_key: "fixture", base_url: mock.url }],
      });
      const agent = await createAgent({ root, projectId: p, agentId: a });

      const workspace = path.join(root, "workspace");
      await fs.mkdir(workspace);
      const source = path.join(workspace, "brief.txt");
      const output = path.join(workspace, "approved.txt");
      await fs.writeFile(source, "Readers need a bilingual edition.");
      const core = await agent.createSession({ workspaceDir: workspace });
      const id = core.sessionId;
      const now = new Date().toISOString();
      const row = {
        sessionId: id,
        projectId: p,
        agentId: a,
        modelId: MOCK_MODEL_ID,
        provider: "custom",
        workspace,
        approvalMode: "allow-all" as const,
        title: null,
        createdAt: now,
        lastActiveAt: now,
      };
      sessions.insert(row);
      manager.adopt(row, core);
      await installPlugin(root, p, a, libraryPlugin("plan")!);
      const idle = () => waitFor(() => manager.statusOf(id) === "idle", 20000);
      const call = (num: number, name: string, input: Record<string, unknown>): MockReply => ({
        toolUse: { id: "call-" + num, name, input },
      });
      const write = (n: number) =>
        call(n, "write_file", { file_path: output, content: "only after approval" });
      replies.push(
        call(1, "read_file", { file_path: source }),
        write(2),
        "Which languages should the guide cover?",
      );
      await manager.startTask(id, [userText("Prepare a guide from the brief.")], { plan: true });
      await idle();
      expect(sessions.getPlan(id)).toEqual({ proposal: null });
      expect(
        mock.requests.some((r) => requestText(r).includes("Readers need a bilingual edition.")),
      ).toBe(true);
      expect(
        mock.requests.some((r) => requestText(r).includes("Plan mode allows reading files")),
      ).toBe(true);
      await expect(fs.stat(output)).rejects.toThrow();
      replies.push("## Plan\n1. Write the English guide.\n2. Review its examples.");
      await manager.startTask(id, [userText("Start with English.")]);
      await idle();
      const first = sessions.getPlan(id)!.proposal!;
      expect(first.text).toContain("English");
      replies.push("## 实施方案\n1. 制作中英双语指南。\n2. 核对两种语言的示例。");
      await manager.startTask(id, [userText("Please revise it to Chinese and English.")]);
      await idle();
      const revised = sessions.getPlan(id)!.proposal!;
      expect(revised.revision).not.toBe(first.revision);
      await expect(manager.changePlan(id, "approve", first.revision)).rejects.toMatchObject({
        code: "plan_changed",
      });
      await expect(fs.stat(output)).rejects.toThrow();
      replies.push(write(3), "Completed.");
      await manager.changePlan(id, "approve", revised.revision);
      await idle();
      expect(await fs.readFile(output, "utf8")).toBe("only after approval");
      await expect(manager.changePlan(id, "approve", revised.revision)).rejects.toMatchObject({
        code: "plan_changed",
      });
      await fs.unlink(output);
      replies.push(write(4), "## Plan\nDiscuss a separate task.");
      await manager.startTask(id, [userText("Start another task.")]);
      await idle();
      await expect(fs.stat(output)).rejects.toThrow();
      await manager.changePlan(id, "exit");
      expect(sessions.getPlan(id)).toBeNull();
    } finally {
      await manager.shutdown();
      channels.dispose();
      db.close();
      await mock.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);
