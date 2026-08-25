/**
 * The signing key for session tokens — `<root>/auth-token-secret`, minted by whoever needs
 * it first.
 *
 * "Whoever" is deliberate: the server at boot, or `penguin auth token` on a root whose
 * server is not running. Both sides read the same file, which is the entire coordination —
 * a token minted offline verifies against the running server because the bytes match, with
 * no database in between.
 *
 * This file is the credential of the stateless scheme (see token-codec.ts for the trade),
 * so it is handled like one: 0600 at creation AND re-asserted on every read, since the mode
 * option only applies when the file is new. Rotation is deletion — remove the file, restart
 * the server, and every outstanding token is noise.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const FILE = "auth-token-secret";
const SECRET_BYTES = 32;

/** Reads the root's signing key, creating it (and the root) on first use. */
export function readOrCreateAuthSecret(root: string): Buffer {
  const file = path.join(root, FILE);
  try {
    const secret = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64url");
    if (secret.byteLength >= SECRET_BYTES) {
      fs.chmodSync(file, 0o600);
      return secret;
    }
    // Truncated or hand-damaged: remove it and mint a fresh one below (deleted here, or the
    // exclusive create would see it and re-read the same damage forever). Every outstanding
    // token dies, which is the honest outcome for a key that no longer has its entropy.
    fs.unlinkSync(file);
  } catch {
    // Missing: first use.
  }
  const secret = randomBytes(SECRET_BYTES);
  fs.mkdirSync(root, { recursive: true });
  try {
    // wx: exclusive create. Two first-users racing (server boot + an offline mint) must
    // agree on ONE key — last-write-wins would leave whichever lost minting tokens the
    // server can never verify. The loser here re-reads the winner's file instead.
    fs.writeFileSync(file, secret.toString("base64url") + "\n", { mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return readOrCreateAuthSecret(root);
    throw err;
  }
  fs.chmodSync(file, 0o600);
  return secret;
}
