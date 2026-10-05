/**
 * How the plugin puts a line into a room session (an employee's session cloned for a room):
 * the one primitive both the room relay (service.ts) and the built-in session notices
 * (notice-delivery.ts) use.
 */
import { userText } from "@prismshadow/penguin-core/omnimessage";
import type { MessagingTaskRunner } from "@prismshadow/penguin-server/plugin";

export type SessionRunner = Pick<MessagingTaskRunner, "statusOf" | "steer" | "startTask">;

/**
 * One line into a room session. A session that is running a Task takes it into that Task,
 * between its steps: a queued line would wait for the Task to end, and a room session that
 * works one long Task (waiting on the room in a loop of its own) then hears nothing. One that
 * is not running — or whose Task ends before the line lands — gets it as its next Task.
 * A server older than `MessagingTaskRunner.steer` has none to offer: every line is started,
 * as before, rather than lost to the call that is not there.
 */
export async function tellSession(
  runner: SessionRunner,
  sessionId: string,
  text: string,
): Promise<void> {
  const input = [userText(text, "server")];
  if (typeof runner.steer === "function" && runner.statusOf(sessionId) === "running") {
    try {
      runner.steer(sessionId, input, { text, images: [], files: [] });
      return;
    } catch {
      // Not running any more: the line starts its next Task instead.
    }
  }
  await runner.startTask(sessionId, input, { queueIfBusy: true });
}
