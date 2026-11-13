/** The self-evolution round delivered over the app's normal stream, at a readable demo pace. */
import { rsiAnswer, rsiTranscript } from "./rsi-transcript";
import { scriptDuration, streamScript } from "./stream-script";
import { assistantText, partial } from "./transcripts";
import type { ModelRef, ScriptStep } from "./transcripts";
import { payloadOf } from "./types";
import type { Lang } from "./types";

export function evolutionReply(lang: Lang, now: number, model: ModelRef): ScriptStep[] {
  const history = rsiTranscript(lang, now, model).history;
  const answerIndex = history.findLastIndex((msg) => {
    const payload = payloadOf(msg);
    return !msg.origin && payload?.type === "text" && payload.role === "assistant";
  });
  const answer = history[answerIndex]!;
  const startedAt = Date.parse(history[0]!.timestamp);
  const scale = 13_500 / (Date.parse(answer.timestamp) - startedAt);
  // The app already echoed the person's prompt; the new Session owns its own metadata.
  const steps: ScriptStep[] = history.slice(2, answerIndex).map((msg) => ({
    at: Math.max(250, (Date.parse(msg.timestamp) - startedAt) * scale),
    msg,
  }));
  let at = 13_500;
  const text = (event_type: "start" | "delta" | "stop", value: string) =>
    partial(0, { type: "partial_text", role: "assistant", event_type, text: value });
  steps.push({ at, msg: text("start", "") });
  // Keep the summary focused on its score comparison; the tools carry the detailed audit.
  const summary = rsiAnswer(lang).split("\n\n- ")[0]!;
  const chunks = streamScript(summary, 15);
  const pace = 3600 / scriptDuration(chunks);
  for (const chunk of chunks) {
    at += chunk.gap * pace;
    steps.push({ at, msg: text("delta", chunk.text) });
  }
  steps.push({ at: at + 50, msg: text("stop", "") });
  for (const msg of [assistantText(0, summary), ...history.slice(answerIndex + 1)]) {
    at += 100;
    steps.push({ at, msg });
  }
  return steps;
}
