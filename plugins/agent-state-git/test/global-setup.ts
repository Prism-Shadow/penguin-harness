// Exercise the same host payload a packed installation uses.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function setup(): void {
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL("../src/pack/stage.mjs", import.meta.url)), "--host"],
    { stdio: "inherit" },
  );
}
