/**
 * rename_session —— renames a Session's title on the host that records Sessions (BuiltinTool).
 *
 * A Session's title is the label its owner sets for finding and telling it apart later (the
 * same field a user types on the Web or with `penguin session rename`). When the model is
 * asked for it — "call this one the billing audit" — this is the first-class way to do it,
 * instead of hoping the generated title survives. The default target is the Session the tool
 * runs in; an explicit `session_id` names another Session the host allows this one to reach
 * (the hosting server confines it to its own Project — a cross-Project id is refused as not
 * found, not as an access error).
 *
 * Outcomes: a bad `title` (missing or not a string) ends the call as fatal, through the
 * standard argument error; a host refusal (unknown id, title out of range) is reported back
 * as plain output with the call COMPLETED, so the model can read which id it tried and pick
 * a different one — retrying the identical call would be refused the same way. Absent host
 * control (SDK/CLI standalone use, where no Sessions are recorded at all) ends the call as
 * fatal, because there is nothing to rename here.
 * Docs: /docs/tools § "Sessions".
 */
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type {
  EnvironmentServices,
  SessionRenameResult,
  ToolDefinitionConfig,
} from "../../interfaces/index.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";
import { describeArgumentError } from "./tool-arguments.js";

/** Tool name constant. */
export const RENAME_SESSION_NAME = "rename_session";

/** One refusal as model-readable output: the code, plus the host's detail when it has one. */
function refusalText(result: { code: string; message?: string }): string {
  return (
    `[rename_session refused: ${result.code}` +
    (result.message !== undefined ? ` — ${result.message}` : "") +
    `]`
  );
}

export function createRenameSessionTool(
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
): BuiltinTool {
  const control = services?.sessionControl;
  return {
    name: RENAME_SESSION_NAME,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const { toolCallId } = ctx;
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId });

      if (!control) {
        yield delta("[rename_session unavailable: no Session control configured on this host]");
        return { stopReason: "fatal" };
      }

      const title = args["title"];
      if (typeof title !== "string" || title.trim().length === 0) {
        yield delta(
          describeArgumentError(definition, args, { argument: "title", kind: "missing" }),
        );
        return { stopReason: "fatal" };
      }
      const sessionId =
        typeof args["session_id"] === "string" && args["session_id"].length > 0
          ? args["session_id"]
          : undefined;

      let result: SessionRenameResult;
      try {
        result = await control.rename({
          title,
          ...(sessionId !== undefined ? { sessionId } : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield delta(`[rename_session error: ${message}]`);
        return { stopReason: "fatal" };
      }
      if (result.ok) {
        yield delta(`Session ${result.sessionId} titled "${result.title}".`);
        return;
      }
      // A refusal is an answer, not a fault: completed, so the model can weigh the code
      // (e.g. try another session_id for an unknown one) instead of a retry that would hit
      // the same wall.
      yield delta(refusalText(result));
    },
  };
}
