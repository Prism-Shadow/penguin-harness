/**
 * Which of an Agent's `benchmark-design` and `agent-evaluation` Skills someone edited, for the
 * startup migration to the Self-Evolution Workbench (rsi-workbench-migration.ts): its one-time
 * install of `rsi-workbench` on a default Agent replaces an unedited copy of these Skills with the
 * package's, and keeps an edited one, whose plugin card then offers the update — the same rule as
 * the in-repo workbench copy.
 *
 * Unedited means the folder is a copy this repository published: before `rsi-workbench`, the two
 * Skills shipped in `packages/skills`, then `agent-tuning`, then `agent-evaluation`. Each copy is
 * compared by {@link skillFingerprint}, and {@link PUBLISHED} lists the fingerprint of every state
 * of each Skill's folder in that history (every commit that changed one, 2026.10.09.5 to
 * 2026.11.21.1 and the integer versions before them).
 *
 * BACKWARD COMPATIBILITY. Kept until 1.0 with the migration that calls it; whoever prepares 1.0
 * removes this file with it (changelog/unreleased/2026-11-26-backward-compatibility.md).
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { skillsDir } from "@prismshadow/penguin-core";

/** The fingerprint of every published copy of each Skill, sha256 hex. */
const PUBLISHED: Readonly<Record<string, ReadonlySet<string>>> = {
  "agent-evaluation": new Set([
    "c6ab5ed55f53e8cd8f78ac51f9d1b49a540854c7548218475e60c17b2ca52963",
    "22dadf4461286d8662005e7d71b3fc5faaef5b230bf3d77f42e094a4d6c3f439",
    "4afe277db33eb74357c9572d729517a9674406dc2896516472b3878d0a2a36bc",
    "aea09e09407ceff87a38d514043b1b823e0627e65c6ee0f391ec51caf6af69c8",
    "e66124495a920b2dedbb64f76d6cf4f2f8d6506fdd9c736451287ea03e962b54",
    "dc3987cfae14d8d9ca4e684ea5b4230f3ff8bbdc8375ac63f0c63bcfef174081",
    "48031786bde580ad1b39dbbbd0fd83af9dbd4583ebf7a76c5b5a2740bcb4cf65",
    "4ac9efa9a2f894f6629ffd9cdcdc9bdf9f272b0bd20b6b6f69e15cfa33a1199a",
    "ba1a2716ce028f4e734286021b0b1048652613fd50f5302dda6d7630f8d081fb",
    "5770b4ba45e53f0beb8eaaa6b86b6ee7f9e39703c0a719599485196fc83de088",
    "ae8d71f72cc0f2eedce9970f141860fd0bb531ad563657f39ea9465bd7417aad",
    "5ccd23f41f270d6f782d5f55313ed998d9b8648d6fa65dbeb78905fda19916d8",
    "226d3a4b843be1f242a31a6cfb135889b65c58455f51be754affa007e102dd3b",
    "d7d06e5d776df8e256f6136b73d4785c44b33f912a7301803d0e7bc1b3dbc18c",
    "b48637853a4923329998cc06376be5285ba96a198126ce14df87237d54d63a4f",
    "13eb1cecfca7ac31aff9e4574c659915d0e8e63fe84fea5bb9bdc29572e9a9b8",
    "a439b1fe640bcc89396dbb6911b3267ca939d9e602df93f2db7f34d844da73b7",
  ]),
  "benchmark-design": new Set([
    "66a356c984f990c5cc8d916c657eb98a4a74960923bad0c804d327342bbcd247",
    "efc4397ed99ebcdcf821c163a6f5fd5970b128f0d71e70803c88a2a331ab29c2",
    "5c787a19a2b32a366f73a8c0ee079518aa8eaf29ac2ca00961262ef585b1661d",
    "2f9fd03cc973ce5719ee303d259f34a62bfe738ca8e834f7d340933dddec69e9",
    "791bc386d14dd679651a49c176b2233bcb8cdc34666768f863ae6794358831ae",
    "e103923155ffdeb347987221b58e5cc40099b7e5743f98a2dea192d69cb9263a",
    "06611dc1e45a0cae80b702e27a737296b1f320a6aab97bb97b24d67e3039e772",
    "4cf49879581b0ae35bf7a785466fe6c1dd18210e9d3a23630d856519b19b5c9d",
    "347f7d59ca1d07c2beaebb2fefc400d9b72e143b1b3b40b8d5b0c52eb885621f",
    "42aabf9c70d2b64991b4e0147854b2f2ae5b8a273385fa6fea9e156ebbd2d8a9",
    "0fca2171c73c2f46ce1a3ea02dc4f0f9550bc33809f48bdd5feb425bb6564934",
    "0b0a66e39fca5a57af9cbb8540801185d2f59a2dad7ed466972108f68d031582",
    "71a94e51464eb112b43cc37d4bde57aa3bffb7ed11b9401955bcfa73f5cd0e4f",
    "65b78d133b3ff8b7dbbce1d644433cd531a4f1441e4babe74f63dbf24dc951cd",
    "367844aa33204ede93adcee1c74bd5227e630807da1322a3538d3ae165f67eb5",
    "39dc173e9d9385134ea4d837ea9152617e2dc9e78c41091b91ad968a838e3a45",
    "8fea9e18c1e6e5f009f169238d8f0e0e67ecd424cc9cd655506ce0cd00ae3075",
    "ea7bce7af1cdc21a848bfd4e4300c04c7434ac8a9017edad0a2dcbd3510ca77e",
    "2a82a5cef868be4b4b15cfed782c6a188b799e019eb4da4bd184895d2734adaf",
    "2b9e690b480d8e3a34a3f551bf1c8c4a1b4edcf9155702e7badfdb2000486bdf",
  ]),
};

const sha256 = (data: string): string => createHash("sha256").update(data).digest("hex");
const lf = (text: string): string => text.replace(/^﻿/, "").replace(/\r\n/g, "\n");

/**
 * A Skill folder's content as a published copy is compared: the `version` of its SKILL.md, the
 * SKILL.md body after the frontmatter, and every other file — not the frontmatter's other fields,
 * which the installer regenerates, nor the icon it adds. Null when the folder has no readable
 * SKILL.md with frontmatter.
 */
export async function skillFingerprint(dir: string): Promise<string | null> {
  let text: string;
  try {
    text = lf(await fs.readFile(path.join(dir, "SKILL.md"), "utf8"));
  } catch {
    return null;
  }
  const head = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (head === null) return null;
  const version = /^version:[ \t]*["']?([^"'\n]*?)["']?[ \t]*$/m.exec(head[1] ?? "")?.[1] ?? "";
  const body = text.slice(head[0].length).trim();
  const files: [string, string][] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && child !== "SKILL.md" && !/^icon\.[A-Za-z]+$/.test(child)) {
        files.push([child, sha256(lf(await fs.readFile(path.join(dir, child), "utf8")))]);
      }
    }
  };
  await walk("");
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256(JSON.stringify([version, body, files]));
}

/**
 * Of `names`, the Skills the Agent carries in a copy this repository never published — edited by
 * someone, or written by hand. A name the Agent does not carry, or that this repository never
 * published (no entry in {@link PUBLISHED}), is not among them.
 */
export async function editedSkillCopies(
  root: string,
  projectId: string,
  agentId: string,
  names: readonly string[],
): Promise<Set<string>> {
  const edited = new Set<string>();
  for (const name of names) {
    const published = PUBLISHED[name];
    if (published === undefined) continue;
    const dir = path.join(skillsDir(root, projectId, agentId), name);
    const present = await fs.lstat(dir).then(
      (stat) => stat.isDirectory(),
      () => false,
    );
    if (!present) continue;
    const print = await skillFingerprint(dir);
    if (print === null || !published.has(print)) edited.add(name);
  }
  return edited;
}
