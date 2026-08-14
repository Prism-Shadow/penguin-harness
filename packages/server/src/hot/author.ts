/**
 * The hot-skill script spec, as prose for a model.
 *
 * Single source shared by every author-facing surface: the agent benchmark
 * prompts with it, and the `hot-skill-authoring` SKILL.md
 * (packages/skills/skills/hot-skill-authoring) teaches chat agents the same
 * contract. In chat the agent IS the authoring loop — it writes the script,
 * the install API's arktype gate judges it, and the 400 body is the feedback
 * it retries on; no separate authoring model is involved.
 */
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
