/**
 * input_command — accesses a long-running command session started by `run_command` (BuiltinTool).
 *
 * Finds the session by `process_id`: if `chars` is non-empty, writes it to stdin first (when it is exactly `\u0003`, special-cased as sending SIGINT to the
 * process group, i.e. Ctrl-C — it must be sent alone; mixing it with other content errors out,
 * since a pipe has no terminal line discipline and a mixed-in ETX byte would just be written
 * into stdin silently with no effect), and if empty, nothing is written and it only polls.
 * It then collects new output within `yield_time_ms` or waits for exit. If the command is still
 * running, returns the same `process_id`; once exited, returns the trailing output and exit
 * status and cleans up the session.
 *
 * Shares the same `CommandSessionManager` injected by Environment with run_command. An
 * interruption only cancels this poll — **it does not kill the background process** (the process
 * was started independently earlier; interrupting one poll shouldn't kill it as a side effect).
 * Docs: /docs/tools § "Command sessions".
 */
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { EnvironmentServices, ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";
import {
  DEFAULT_EMPTY_POLL_YIELD_MS,
  DEFAULT_WRITE_YIELD_MS,
  resultForExit,
} from "./command/index.js";
import { clampYield } from "./background/index.js";

/** Tool name constant. */
export const INPUT_COMMAND_NAME = "input_command";

/** Ctrl-C: the ETX control character (U+0003). Received alone, it sends SIGINT to the process group instead of writing the byte into stdin. */
const INTERRUPT = String.fromCharCode(3); // U+0003 (ETX)

export function createInputCommandTool(
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
): BuiltinTool {
  const manager = services?.commandSessions;
  return {
    name: INPUT_COMMAND_NAME,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const { toolCallId, signal } = ctx;
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId });

      if (!manager) {
        yield delta("[input_command unavailable: no command session manager configured]");
        return { stopReason: "failed" };
      }

      const processId = args["process_id"];
      if (typeof processId !== "string" || processId.length === 0) {
        yield delta('Missing required argument "process_id" for input_command.');
        return { stopReason: "failed" };
      }
      const session = manager.get(processId);
      if (!session) {
        yield delta(
          `[input_command error: unknown process_id ${processId} (the session may have exited and been cleared)]`,
        );
        return { stopReason: "failed" };
      }

      const chars = typeof args["chars"] === "string" ? (args["chars"] as string) : "";
      const empty = chars.length === 0;
      const yieldMs = clampYield(
        args["yield_time_ms"],
        empty ? DEFAULT_EMPTY_POLL_YIELD_MS : DEFAULT_WRITE_YIELD_MS,
        definition.timeoutMs,
      );

      if (signal?.aborted) return { stopReason: "aborted" };

      // Write / interrupt (empty chars just polls). U+0003 mixed with other content errors out
      // rather than being written silently (same as codex): a pipe has no terminal line
      // discipline, so an ETX byte in stdin produces no interruption — the model would just
      // see the command still running.
      if (!empty) {
        if (chars === INTERRUPT) session.interrupt();
        else if (chars.includes(INTERRUPT)) {
          yield delta(
            '[input_command error: chars mixes U+0003 (Ctrl-C) with other content; send "\\u0003" alone to interrupt]',
          );
          return { stopReason: "failed" };
        } else session.write(chars);
      }

      for await (const chunk of session.collect(yieldMs, signal)) yield delta(chunk);

      if (signal?.aborted) return { stopReason: "aborted" };
      if (session.running) {
        return {
          stopReason: "completed",
          note: `[process still running with process_id ${processId}]`,
        };
      }
      // Already exited: clean up the registry and report the exit status.
      manager.remove(processId);
      if (session.error) {
        return { stopReason: "failed", note: `[spawn error: ${session.error.message}]` };
      }
      return resultForExit(session.exit);
    },
  };
}
