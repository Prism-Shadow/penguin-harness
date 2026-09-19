import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { AcpClient } from "./acp-client.mjs";

export async function createCodexClient({ projectDir, cwd }) {
  if (!path.isAbsolute(projectDir) || !path.isAbsolute(cwd))
    throw new Error("Absolute project and workspace paths are required");
  const home = path.join(projectDir, "coding-agents", "codex");
  await mkdir(home, { recursive: true, mode: 0o700 });
  return new AcpClient({
    command: process.execPath,
    args: [createRequire(import.meta.url).resolve("@agentclientprotocol/codex-acp")],
    env: codexEnvironment(home),
    cwd,
  });
}

export function codexEnvironment(home, inherited = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(inherited))
    if (
      /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|LANG|LC_ALL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|SSL_CERT_FILE|CODEX_CA_CERTIFICATE)$/i.test(
        key,
      )
    )
      env[key] = value;
  return {
    ...env,
    CODEX_HOME: home,
    NO_BROWSER: "1",
    // In adapter 1.12.0, this legacy ID means workspace-write + on-request
    // approvals reviewed by a human. Never present it as a read-only sandbox.
    INITIAL_AGENT_MODE: "read-only",
    CODEX_CONFIG: JSON.stringify({
      forced_login_method: "chatgpt",
      cli_auth_credentials_store: "file",
      model_provider: "openai",
    }),
  };
}

export const CODEX_MODE = "read-only";
export const EXECUTION_POLICY = {
  sandbox: "workspace-write",
  approval_policy: "on-request",
  approvals_reviewer: "user",
};

// This is the only Codex-specific ACP extension used by the bridge. It is
// supported by the pinned adapter; authentication itself uses standard ACP.
export async function accountStatus(client) {
  const result = await client.request("authentication/status", {});
  return { type: result.type }; // Deliberately omit email and arbitrary metadata.
}
