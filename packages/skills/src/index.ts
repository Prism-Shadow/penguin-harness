/**
 * Validates one skill directory: it is valid when the SKILL.md parser vendored from
 * vercel-labs/skills (./vendor/vercel-skills) accepts its SKILL.md. Otherwise the result is one
 * violation `<skill>/SKILL.md: <reason>`, with the reason that parser gives.
 */
import path from "node:path";
import { parseSkillMd } from "./vendor/vercel-skills/skills.js";

export async function validateSkillDir(dir: string): Promise<string[]> {
  const result = await parseSkillMd(path.join(dir, "SKILL.md"));
  return typeof result === "string"
    ? [`${path.basename(path.resolve(dir))}/SKILL.md: ${result}`]
    : [];
}
