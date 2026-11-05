/**
 * The checks an archive's `agent_state/` passes before it can become an Agent's, beyond what
 * the zip's names already passed: every skill directory is a Skill (a `SKILL.md` whose
 * frontmatter names it, read with the same tolerant reader the Skills list uses), every hook
 * package directory carries a `hooks.json` the hook runner can follow (script paths inside the
 * package, positive timeouts), and every workbench folder is named as a workbench id. A dot
 * directory is none of these (the listings skip it), and a loose file beside the directories is
 * left as it is.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PLUGIN_NAME_PATTERN, parseSkillFrontmatter } from "@prismshadow/penguin-core";
import { badRequest } from "../http/errors.js";
import { assertSafeEntryPath } from "../services/skill-import-limits.js";
import { isWorkbenchId } from "../workbenches/store.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The directories directly under `dir` that are not dot-named; [] when there is no `dir`. */
async function packageDirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/** One hook point's script list: each a relative path inside the package, run with Node. */
function checkCommands(raw: unknown, label: string): void {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) throw badRequest(`${label} must be an array.`);
  raw.forEach((entry, i) => {
    const command = asRecord(entry);
    if (command === null || typeof command.command !== "string" || command.command === "") {
      throw badRequest(`${label}[${i}] must be an object with a command.`);
    }
    assertSafeEntryPath(command.command);
    const timeout = command.timeout;
    if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) {
      throw badRequest(`${label}[${i}].timeout must be a positive number.`);
    }
    if (
      command.trigger !== undefined &&
      command.trigger !== "prompt" &&
      command.trigger !== "host"
    ) {
      throw badRequest(`${label}[${i}].trigger must be "prompt" or "host".`);
    }
  });
}

/** A hook package's `hooks.json`: a JSON object whose script lists the runner can follow. */
function checkHookManifest(name: string, text: string): void {
  const label = `hooks/${name}/hooks.json`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw badRequest(`${label} is not valid JSON.`);
  }
  const manifest = asRecord(parsed);
  if (manifest === null) throw badRequest(`${label} must be a JSON object.`);
  for (const point of ["stop", "pre_tool_use", "user_prompt"] as const) {
    checkCommands(manifest[point], `${label} ${point}`);
  }
}

/** Counts of what a State holds, for the import's report. */
export interface StateCounts {
  skills: number;
  hooks: number;
  workbenches: number;
}

/** How many skill, hook package and workbench directories a State holds; nothing is checked. */
export async function stateCounts(stateDir: string): Promise<StateCounts> {
  const [skills, hooks, workbenches] = await Promise.all(
    ["skills", "hooks", "workbenches"].map((dir) => packageDirs(path.join(stateDir, dir))),
  );
  return { skills: skills!.length, hooks: hooks!.length, workbenches: workbenches!.length };
}

/** Checks the skills, hook packages and workbench folders of an extracted `agent_state/`. */
export async function checkIncomingState(stateDir: string): Promise<void> {
  const skills = await packageDirs(path.join(stateDir, "skills"));
  for (const name of skills) {
    if (!PLUGIN_NAME_PATTERN.test(name))
      throw badRequest(`Invalid skill name in the archive: ${name}`);
    const text = await fs
      .readFile(path.join(stateDir, "skills", name, "SKILL.md"), "utf8")
      .catch(() => null);
    if (text === null || parseSkillFrontmatter(text) === null) {
      throw badRequest(
        `skills/${name}/ must contain a SKILL.md that starts with a frontmatter block setting \`name\`.`,
      );
    }
  }
  const hooks = await packageDirs(path.join(stateDir, "hooks"));
  for (const name of hooks) {
    if (!PLUGIN_NAME_PATTERN.test(name)) {
      throw badRequest(`Invalid hook package name in the archive: ${name}`);
    }
    const text = await fs
      .readFile(path.join(stateDir, "hooks", name, "hooks.json"), "utf8")
      .catch(() => null);
    if (text === null) throw badRequest(`hooks/${name}/ must contain a hooks.json.`);
    checkHookManifest(name, text);
  }
  const workbenches = await packageDirs(path.join(stateDir, "workbenches"));
  for (const id of workbenches) {
    if (!isWorkbenchId(id)) throw badRequest(`Invalid workbench id in the archive: ${id}`);
  }
}
