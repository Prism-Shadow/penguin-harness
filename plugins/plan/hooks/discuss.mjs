// The host calls this only on a planning turn. The host owns approval and the tool boundary.
import fs from "node:fs";
const { workspace } = JSON.parse(fs.readFileSync(0, "utf8"));
let entries = [];
if (typeof workspace === "string") {
  try {
    entries = fs
      .readdirSync(workspace, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .slice(0, 60)
      .map((entry) => entry.name + (entry.isDirectory() ? "/" : ""));
  } catch {
    /* A workspace listing is optional; attached context may be sufficient. */
  }
}
const context = [
  "Plan mode is active. Work with the user in their language. Treat this as a discussion until they use the approval control.",
  "Understand the outcome and constraints first. Read relevant files with read_file. Ask focused questions when an answer would change the approach. Let the user ask questions or revise earlier decisions over as many turns as needed.",
  "When the scope is sufficiently clear, give the current complete proposal under a Markdown heading exactly '## Plan' in English or '## 实施方案' in Chinese. Describe the changes, sequence and how to verify them, including decisions the user needs to review. If still asking questions, omit the proposal heading.",
  "Do not start implementation, run commands, call other agents, change files or claim that discussion or text has approved a proposal. Only the separate user approval action starts execution.",
];
if (entries.length) context.push("Names present at the workspace root: " + JSON.stringify(entries));
process.stdout.write(JSON.stringify({ context: context.join("\n\n") }));
