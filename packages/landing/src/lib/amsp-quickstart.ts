/**
 * The code the /amsp page shows: the player's input snippet per run, and the quickstart's install
 * command, curl request, response excerpt and TypeScript example, against `/api/amsp/v1` and
 * `@prismshadow/amsp` after 0.2.16 (PRFC-0021): `stream()` returns the run to iterate, `run()` its
 * result alone. The single place to adjust when the SDK's surface or the
 * routes settle. Language-neutral: the words around the code are in the dictionaries.
 */
import type { RunStep } from "./amsp-demo";

/** A local server's key door, and the Agent every sample runs (`<projectId>/<agentId>`). */
export const AMSP_BASE_URL = "http://localhost:7364/api/amsp/v1";
export const AMSP_DEMO_AGENT = "demo/coder";

export const SDK_INSTALL = "npm install @prismshadow/amsp";

/**
 * What the player's input block shows for a run: the import, the client and the call that starts
 * it (and stops it). Every line fits the player's column at `lg`.
 */
export function playerCode(scenario: {
  input: string;
  continues?: boolean;
  abortAfterMs?: number;
}): string {
  const options = [
    ...(scenario.continues ? ["sessionId"] : []),
    `input: ${JSON.stringify(scenario.input)}`,
  ];
  const oneLine = `client.stream({ ${options.join(", ")} })`;
  // One line while it fits the player's column, one option per line past that.
  const call =
    `const run = ${oneLine};`.length <= 76
      ? oneLine
      : `client.stream({\n  ${options.join(",\n  ")},\n})`;
  const abort =
    scenario.abortAfterMs === undefined
      ? ""
      : `\nsetTimeout(() => run.abort(), ${scenario.abortAfterMs});`;
  return `import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({ baseUrl, agent: ${JSON.stringify(AMSP_DEMO_AGENT)}, apiKey });
const run = ${call};${abort}
for await (const record of run) console.log(record);`;
}

/** Quickstart step 2: one run over curl. */
export const CURL_RUN = `curl -N ${AMSP_BASE_URL}/agents/${AMSP_DEMO_AGENT}/runs \\
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input":"What time is it now?"}'`;

/** One step of a run as the server writes it on the wire. */
function wireLines(step: RunStep): string[] {
  switch (step.kind) {
    case "control": {
      const { kind, ...data } = step.control;
      return [`event: ${kind}`, `data: ${JSON.stringify(data)}`];
    }
    case "record":
      return [`id: ${step.id}`, `data: ${JSON.stringify(step.record)}`];
    case "done":
      return ["data: [DONE]"];
    default:
      // The approvals resource is a separate request, not part of the stream.
      return [];
  }
}

/**
 * The response body of a run, cut for the page: its first `head` and last `tail` stream events as
 * the SSE lines the server writes, one blank line between events, the rest elided behind a comment.
 */
export function responseExcerpt(
  steps: readonly RunStep[],
  head: number,
  tail: number,
  elided: string,
): string {
  const events = steps.map(wireLines).filter((lines) => lines.length > 0);
  const kept =
    events.length <= head + tail
      ? events
      : [...events.slice(0, head), [`# … ${elided}`], ...events.slice(events.length - tail)];
  return kept.map((lines) => lines.join("\n")).join("\n\n");
}

/** Quickstart step 3: run, read the records as they come, read the result, continue the Session. */
export const SDK_EXAMPLE = `import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: ${JSON.stringify(AMSP_BASE_URL)},
  agent: ${JSON.stringify(AMSP_DEMO_AGENT)},
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.stream({ input: "What time is it now?" });
for await (const record of run) {
  if (record.type === "model_msg" && record.payload.type === "partial_text") {
    process.stdout.write(record.payload.text);
  }
}
const { sessionId, status, text, usage } = await run.result();

// Same Session, same context
await client.run({ sessionId, input: "Now say it in French." });`;
