import { copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

// Workbenches are installed as standalone source trees; pack the shared files beside each app.
const source = fileURLToPath(new URL("./", import.meta.url));
const target = join("workbenches", basename(process.cwd()));
for (const file of ["desk-kit.ts", "ui/desk-kit.js", "ui/desk-kit.css"]) {
  copyFileSync(join(source, basename(file)), join(target, file));
}
