/**
 * Skill authoring: the one-sentence path from "实现计数器功能" to a live tool.
 *
 * The loop closes over the pieces that already exist: prompt an LLM with the
 * hot-script spec + the user's request, extract the script, dry-validate it
 * (eval + arktype — the same gate the install API enforces), and on failure
 * feed the exact contract error back to the model and retry. Only a script
 * that passes the gate reaches installation, so the model can never degrade
 * safety — it just gets more chances to conform.
 *
 * The LLM is pluggable (an async prompt→completion function). The default is
 * env-configured DeepSeek (DEEPSEEK_API_KEY / _BASE_URL / _MODEL); production
 * wiring through the project's model config can replace it later without
 * touching the loop.
 */
import { validateSkillScript } from "./script.js";

export type AuthorLlm = (prompt: string) => Promise<string>;

/** The spec half of the prompt — shared with the agent benchmark. */
export const HOT_SKILL_SPEC = `You are writing a "hot skill script" for the PenguinHarness hot platform.

The script is the BODY of a strict-mode JavaScript function receiving one
argument named \`context\` (where \`context.state\` is your previously saved
state, or null). It must RETURN an object with exactly this contract:

- name: non-empty string
- version: number
- setup: function(ctx) — call ctx.registerTool({ name, description, run })
  for each tool; \`run\` is a function receiving one JSON input argument and
  returning a JSON result.
- park (optional): function() returning your serializable state.

No import/require/await. No code outside the function body. Reply with ONLY
the script inside a single \`\`\`js code block.`;

export function buildAuthorPrompt(request: string, previousError?: string): string {
  const feedback =
    previousError === undefined
      ? ""
      : `\n\nYour previous attempt was rejected by the platform's validator:\n${previousError}\nFix the script and reply again with ONLY the corrected script in a single \`\`\`js code block.`;
  return `${HOT_SKILL_SPEC}\n\nTask: ${request}${feedback}`;
}

export function extractScript(content: string): string {
  const fenced = /```(?:js|javascript)?\s*\n([\s\S]*?)```/.exec(content);
  return (fenced?.[1] ?? content).trim();
}

export interface AuthoredScript {
  script: string;
  attempts: number;
}

export class AuthoringFailed extends Error {
  constructor(
    message: string,
    readonly lastScript: string | null,
  ) {
    super(message);
    this.name = "AuthoringFailed";
  }
}

/**
 * Ask → validate → feed the error back, up to maxAttempts. Returns a script
 * that PASSES the contract gate; throws AuthoringFailed with the last error
 * and script otherwise.
 */
export async function authorSkillScript(
  llm: AuthorLlm,
  request: string,
  maxAttempts = 3,
): Promise<AuthoredScript> {
  let lastError: string | undefined;
  let lastScript: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const script = extractScript(await llm(buildAuthorPrompt(request, lastError)));
    lastScript = script;
    try {
      validateSkillScript(script);
      return { script, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new AuthoringFailed(
    `model did not produce a conformant script in ${maxAttempts} attempts (last error: ${lastError})`,
    lastScript,
  );
}

/** Env-configured DeepSeek caller; null when no key is present. */
export function envAuthorLlm(
  env: Record<string, string | undefined> = process.env,
): AuthorLlm | null {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (apiKey === undefined) return null;
  const baseUrl = env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  return async (prompt) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`authoring model ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    return body.choices[0]!.message.content;
  };
}
