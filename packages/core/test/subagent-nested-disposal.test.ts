/**
 * A resumed Agent-created child owns a running Agent-created grandchild. If the grandchild's
 * cancellation Trace write is paused, disposing the root Session must keep waiting.
 * The immediate child may be idle or running. All Session/Environment/handle/pump
 * implementations are real. Private references are used only to arrange the tree;
 * the provider and the completion of a real Trace write are the two I/O boundaries.
 */
import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAgent, GenerativeModel, userText, Writer, tracesDir } from "../src/index.js";
import type { Session } from "../src/session.js";
import {
  ManagedSubagentSession,
  SubagentSessionManager,
} from "../src/environment/tools/subagent/index.js";
import type { SubagentRunner } from "../src/interfaces/index.js";
import { seedProject } from "./seeded-project.js";
import { stubProviderKeys } from "./provider-keys.js";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const internals = (session: Session) =>
  (
    session as unknown as {
      environment: {
        subagentRunner: SubagentRunner;
        subagentSessions: SubagentSessionManager;
      };
    }
  ).environment;

it.each([false, true])(
  "root disposal waits for a resumed child's descendant: childRunning=%s",
  async (childRunning) => {
    const root = await mkdtemp(path.join(tmpdir(), "penguin-nested-disposal-"));
    const restoreKeys = stubProviderKeys();
    const grandStarted = gate();
    const childStarted = gate();
    const writing = gate();
    const releaseWrite = gate();
    let armed = false;
    let grandId = "";
    let rootSettled = false;
    let lateWrites = 0;
    const sessions: Session[] = [];
    const write = Writer.prototype.write;
    const writerSpy = vi.spyOn(Writer.prototype, "write").mockImplementation(async function (
      this: Writer,
      msg,
    ) {
      if (armed && (this as unknown as { sessionId: string }).sessionId === grandId) {
        writing.resolve();
        await releaseWrite.promise;
        if (rootSettled) lateWrites++;
      }
      await write.call(this, msg);
    });
    const streamSpy = vi
      .spyOn(
        GenerativeModel.prototype as unknown as {
          openStream(input: unknown, signal: AbortSignal): AsyncIterable<never>;
        },
        "openStream",
      )
      .mockImplementation(async function* (input, signal) {
        if (JSON.stringify(input).includes("grandchild")) grandStarted.resolve();
        else childStarted.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
      });
    let disposal: Promise<void> | undefined;
    let child: ManagedSubagentSession | undefined;
    let grand: ManagedSubagentSession | undefined;
    try {
      await seedProject(root);
      const agent = await createAgent({ root });
      const create = agent.createSession.bind(agent);
      const createSpy = vi.spyOn(agent, "createSession").mockImplementation(async (...args) => {
        const session = await create(...args);
        sessions.push(session);
        return session;
      });
      const parent = await agent.createSession({ workspaceDir: root });
      const parentEnv = internals(parent);
      const initial = await parentEnv.subagentRunner.spawn({});
      // A freshly spawned child cannot nest. Revival currently resets subagentDepth to zero.
      await expect(internals(sessions[1]!).subagentRunner.spawn({})).rejects.toThrow(
        "depth limit 1",
      );
      await new Writer({
        tracesDir: tracesDir(root, agent.state.projectId, agent.state.agentId),
        sessionId: initial.sessionId,
      }).write(sessions[1]!.metaMessage);
      await initial.dispose();
      const resume = agent.resumeSession.bind(agent);
      const resumeSpy = vi.spyOn(agent, "resumeSession").mockImplementation(async (...args) => {
        const session = await resume(...args);
        sessions.push(session);
        return session;
      });
      child = new ManagedSubagentSession(
        await parentEnv.subagentRunner.resume!({
          agentId: agent.state.agentId,
          sessionId: initial.sessionId,
        }),
      );
      parentEnv.subagentSessions.track(child);
      parentEnv.subagentSessions.register(child);
      const childEnv = internals(sessions.at(-1)!);
      grand = new ManagedSubagentSession(await childEnv.subagentRunner.spawn({}));
      grandId = grand.sessionId;
      childEnv.subagentSessions.track(grand);
      childEnv.subagentSessions.register(grand);
      grand.startRun([userText("grandchild")]);
      await grandStarted.promise;
      if (childRunning) {
        child.startRun([userText("child")]);
        await childStarted.promise;
      }
      armed = true;
      disposal = Promise.resolve(parent.dispose()).then(() => {
        rootSettled = true;
      });
      await writing.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      const snapshot = {
        childRunning,
        rootSettled,
        grandRunning: grand.running,
        live: parent.listBackgroundSubagents(),
      };
      createSpy.mockRestore();
      resumeSpy.mockRestore();
      expect(snapshot.grandRunning).toBe(true);
      expect(snapshot.rootSettled).toBe(false);
    } finally {
      releaseWrite.resolve();
      child?.kill();
      grand?.kill();
      const settled = (session: ManagedSubagentSession | undefined) =>
        new Promise<void>((resolve) => {
          if (!session?.running) resolve();
          else
            session.onStateChange(() => {
              if (!session.running) resolve();
            });
        });
      await Promise.all([disposal, settled(child), settled(grand)]);
      for (const session of sessions) await session.dispose();
      writerSpy.mockRestore();
      streamSpy.mockRestore();
      restoreKeys();
      await rm(root, { recursive: true, force: true });
      expect(lateWrites).toBe(0);
    }
  },
);
