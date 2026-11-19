/**
 * With Plan enabled, the submitting user can discuss a design, ask for a planning site,
 * and request implementation in normal chat. Existing approvals still decide each tool.
 * On the first unplanned turn no further planning prompt is added.
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
import { openDatabase } from "@prismshadow/penguin-library-db";
import { SessionsRepo } from "@prismshadow/penguin-library-session/repos/sessions";
import { ChannelHub } from "../src/runtime/channel.js";
import { SessionManager, createCoreSessionLoader } from "../src/runtime/session-manager.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import { makeTempRoot, waitFor } from "./helpers.js";
import { MOCK_MODEL_ID, requestText, startMockLLM, type MockReply } from "./live-session.js";

it(
  "discusses, writes a planning site and implements it on the same Session under its own permissions",
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
      const reference = path.join(workspace, "design.html");
      const result = path.join(workspace, "result.txt");
      const write = (n: number, file_path: string, content: string) =>
        call(n, "write_file", { file_path, content });
      const submit = async (prompt: string) => {
        const before = mock.requests.length;
        await manager.startTask(id, [userText(prompt)]);
        await idle();
        return mock.requests.slice(before);
      };
      // Install after opening the context, as the composer's installation action can do.
      sessions.setPlanMode(id, true);
      replies.push("Should the preview work offline?");
      const discussion = await submit("Help me design the preview.");
      const expansion = (discussion[0]!.messages as Array<{ content: unknown }>).at(-1);
      expect(JSON.stringify(expansion)).toContain("RFC");
      replies.push(write(1, reference, "<h1>Offline preview</h1>"), "The design is ready.");
      await submit("Yes. Write a planning page first.");
      expect(await fs.readFile(reference, "utf8")).toBe("<h1>Offline preview</h1>");
      replies.push(write(2, result, "implemented"), "Done.");
      await submit("Use that design and implement it.");
      expect(await fs.readFile(result, "utf8")).toBe("implemented");
      expect(sessions.findById(id)?.planMode).toBe(true);

      sessions.updateApprovalMode(id, "deny-all");
      replies.push(write(3, result, "forbidden"), "The write was denied.");
      const denied = await submit("Revise the implementation.");
      expect(requestText(denied.at(-1)!)).toMatch(/denied/i);
      expect(await fs.readFile(result, "utf8")).toBe("implemented");

      sessions.setPlanMode(id, false);
      replies.push("Ready.");
      const ordinary = await submit("How is the preview?");
      const last = (ordinary[0]!.messages as Array<{ content: unknown }>).at(-1);
      expect(JSON.stringify(last)).not.toContain("RFC");
    } finally {
      await manager.shutdown();
      channels.dispose();
      db.close();
      await mock.close();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);
