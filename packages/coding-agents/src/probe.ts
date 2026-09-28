/**
 * A live probe of one agent command: start it, open a throwaway session in a scratch
 * directory, and read the config options (model choices, toggles) it advertises — the
 * data a launcher needs before any real session exists. Always tears the process down;
 * a timeout reads as an error, not a hang.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AcpConnection, configOptionsFromAcp, type AcpClientInfo } from "./connection.js";
import { AcpAgentError, type AgentSessionConfigOption } from "./types.js";

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

export interface AgentProbeRequest {
  command: string;
  args: string[];
  /** FULL child environment (the caller composes the sandboxed base via `sandboxedAgentEnv`). */
  env: Record<string, string>;
  clientInfo: AcpClientInfo;
  timeoutMs?: number;
}

export async function probeAgentOptions(
  request: AgentProbeRequest,
): Promise<AgentSessionConfigOption[]> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const scratch = await fs
    .mkdtemp(path.join(os.tmpdir(), "coding-agents-probe-"))
    .catch(() => undefined);
  if (scratch === undefined) {
    throw new AcpAgentError("could not create a scratch directory for the agent probe");
  }
  let connection: AcpConnection | undefined;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    connection?.dispose();
  }, timeoutMs);
  timer.unref?.();
  try {
    connection = await AcpConnection.spawn(
      request.command,
      request.args,
      request.env,
      request.clientInfo,
      {
        onEvent: () => undefined,
        onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } }),
      },
    );
    await connection.initialize();
    const response = await connection.newSession(scratch);
    return configOptionsFromAcp(response.configOptions);
  } catch (error) {
    // The agent's own refusal is the useful part ("this client is no longer supported"), so
    // it is kept rather than folded into a generic line.
    const detail = error instanceof Error && error.message !== "" ? `: ${error.message}` : "";
    const message = timedOut
      ? `the agent did not report its session options within ${timeoutMs}ms`
      : `the agent did not report its session options${detail}`;
    throw error instanceof AcpAgentError && !timedOut
      ? error
      : new AcpAgentError(message, { cause: error });
  } finally {
    clearTimeout(timer);
    connection?.dispose();
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}
