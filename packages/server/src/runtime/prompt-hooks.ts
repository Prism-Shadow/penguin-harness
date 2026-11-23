/**
 * The composer's switches (`TaskCreateRequest.promptHooks`): for each hook package the user has
 * switched on, the Session runs the package's `trigger: "host"` `user_prompt` command on the
 * user's own words (hooks run in core and nowhere else — `Session.runUserPromptHook`), and its
 * `context` is sent right behind the user's message, stamped `sender: "harness"`, the way a goal
 * start sends its round-1 protocol. The server knows no package by name: the names come from the
 * request, and what each adds is the package's own answer.
 *
 * Called under the Session lock once the request is known to start, queue or interrupt, so a
 * refusal (a package that is not there, a command that fails) starts nothing and queues nothing.
 */
import { stripLeadingMarkerBlocks, userText } from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import type { RuntimeSession } from "./session-manager.js";

/** The user's own text in an input: what core's per-Prompt consult and a goal start read too. */
function promptOf(input: readonly AmspRecord[]): string {
  const text = input
    .filter((msg) => {
      const p = msg.payload as { type?: string; role?: string; sender?: string };
      return (
        msg.type === "model_msg" &&
        p.type === "text" &&
        p.role === "user" &&
        (p.sender === undefined || p.sender === "user")
      );
    })
    .map((msg) => (msg.payload as { text: string }).text)
    .join("\n");
  return stripLeadingMarkerBlocks(text).trim() || text;
}

/** `input` followed by each named package's context, in the order named. */
export async function withPromptHooks(
  session: Pick<RuntimeSession, "runUserPromptHook">,
  input: AmspRecord[],
  names: readonly string[],
): Promise<AmspRecord[]> {
  const prompt = promptOf(input);
  const contexts: AmspRecord[] = [];
  for (const name of names) {
    const answer = await Promise.resolve(session.runUserPromptHook?.(name, prompt)).catch(
      (err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        throw new HttpError(
          409,
          "prompt_hook_failed",
          `The ${name} hook package's user_prompt command failed (${reason}).`,
        );
      },
    );
    if (!answer) {
      throw new HttpError(
        409,
        "prompt_hook_not_installed",
        `The ${name} hook package is not installed on this agent, declares no trigger: "host" user_prompt command, or hooks are switched off.`,
      );
    }
    if (answer.context) contexts.push(userText(answer.context, "harness"));
  }
  return [...input, ...contexts];
}
