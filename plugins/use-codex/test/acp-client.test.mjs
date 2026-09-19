import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AcpClient } from "../src/acp-client.mjs";
import { CodexBridge } from "../src/bridge.mjs";
import { createCodexClient, accountStatus } from "../src/codex-profile.mjs";

test("real SDK stdio peer streams progress and waits for the human response", async (t) => {
  const client = new AcpClient({
    command: process.execPath,
    args: [fileURLToPath(new URL("./fixtures/agent.mjs", import.meta.url))],
    cwd: process.cwd(),
    env: { ...process.env },
  });
  const bridge = new CodexBridge({ client, cwd: process.cwd() });
  t.after(() => bridge.close());
  const task = await bridge.call("codex_run", { prompt: "edit" });
  let poll;
  for (let i = 0; i < 100; i++) {
    poll = await bridge.call("codex_poll", { task_id: task.task_id });
    if (poll.requests.length) break;
    await sleep(10);
  }
  assert.equal(poll.events[0].data.content.text, "Working");
  assert.equal(poll.status, "running");
  await bridge.call("codex_respond", {
    task_id: task.task_id,
    request_id: poll.requests[0].request_id,
    decision: "accept",
  });
  for (let i = 0; i < 100; i++) {
    poll = await bridge.call("codex_poll", { task_id: task.task_id });
    if (poll.status !== "running") break;
    await sleep(10);
  }
  assert.equal(poll.status, "completed");
});
test(
  "published Codex adapter initializes with isolated credentials without inference",
  { skip: process.env.PENGUIN_TEST_CODEX_ACP !== "1" },
  async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "penguin-acp-test-"));
    const client = await createCodexClient({ projectDir, cwd: projectDir });
    try {
      const info = await client.start();
      assert.equal(info.agentInfo.version, "1.12.0");
      assert.ok(info.authMethods.some((m) => m.id === "chat-gpt-device-code"));
      assert.deepEqual(await accountStatus(client), { type: "unauthenticated" });
    } finally {
      client.close();
      if (client.proc.exitCode === null)
        await new Promise((resolve) => client.proc.once("exit", resolve));
      assert.equal(path.dirname(projectDir), path.resolve(tmpdir()));
      assert.ok(path.basename(projectDir).startsWith("penguin-acp-test-"));
      await rm(projectDir, { recursive: true, force: true });
    }
  },
);
