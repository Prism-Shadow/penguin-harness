/**
 * The code the /amsp page shows: the player's input snippet per scenario, and the quickstart's
 * install command, curl request and TypeScript example. The single place to adjust when SDK 1.0's
 * surface or the v2 routes settle (PRFC-0021). Language-neutral: the words around the code are in
 * the dictionaries.
 */
import type { AmspEvent } from "./amsp-protocol";

/** A local server's key door, and the Agent every sample runs (`<projectId>/<agentId>`). */
export const AMSP_BASE_URL = "http://localhost:7364/api/amsp/v2";
export const AMSP_DEMO_AGENT = "demo/coder";

export const SDK_INSTALL = "npm install @prismshadow/amsp";

/** What the player's input block shows for a scenario: the call that starts that run. */
export function playerCode(scenario: {
  input: string;
  decision?: string;
  continues?: boolean;
}): string {
  const options = [
    ...(scenario.continues ? ["sessionId"] : []),
    `input: ${JSON.stringify(scenario.input)}`,
    ...(scenario.decision ? [`onApproval: () => ${JSON.stringify(scenario.decision)}`] : []),
  ];
  // One line while it fits the player's column, one option per line past that.
  const oneLine = `client.stream({ ${options.join(", ")} })`;
  const call =
    `const run = ${oneLine};`.length <= 72
      ? oneLine
      : `client.stream({\n  ${options.join(",\n  ")},\n})`;
  return `import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({ baseUrl, agent: ${JSON.stringify(AMSP_DEMO_AGENT)}, apiKey });
const run = ${call};
for await (const event of run) console.log(event);`;
}

/** Quickstart step 2: one run over curl. */
export const CURL_RUN = `curl -N ${AMSP_BASE_URL}/agents/${AMSP_DEMO_AGENT}/runs \\
  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input":"What time is it now?"}'`;

/**
 * The response body of a run, cut for the page: its first `head` and last `tail` events as the
 * `data:` lines the server writes, the rest elided behind a comment line, then the terminator.
 */
export function responseExcerpt(
  events: readonly AmspEvent[],
  head: number,
  tail: number,
  elided: string,
): string {
  const line = (event: AmspEvent) => `data: ${JSON.stringify(event)}`;
  const lines =
    events.length <= head + tail
      ? events.map(line)
      : [
          ...events.slice(0, head).map(line),
          `# … ${elided}`,
          ...events.slice(events.length - tail).map(line),
        ];
  return [...lines, "data: [DONE]"].join("\n");
}

/** Quickstart step 3: stream a run, read its result, continue its Session. */
export const SDK_EXAMPLE = `import { AgentClient } from "@prismshadow/amsp";

const client = new AgentClient({
  baseUrl: ${JSON.stringify(AMSP_BASE_URL)},
  agent: ${JSON.stringify(AMSP_DEMO_AGENT)},
  apiKey: process.env.PENGUIN_AGENT_KEY,
});

const run = client.stream({ input: "What time is it now?" });
for await (const event of run) {
  if (event.type === "model_msg" && event.payload.type === "partial_text") {
    process.stdout.write(event.payload.text);
  }
}
const { sessionId, text, usage } = await run.result();

// Same Session, same context
await client.run({ sessionId, input: "Now say it in French." });`;
