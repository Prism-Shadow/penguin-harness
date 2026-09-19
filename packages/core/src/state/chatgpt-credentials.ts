import fs from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import { refreshChatGPTCredentials, ChatGPTAuthorizationError } from "@prismshadow/agenthub";
import type { ChatGPTCredentials, ChatGPTCredentialProvider } from "@prismshadow/agenthub";
import { atomicWriteFile } from "../internal/atomic-write.js";
import { fileLockKey, withFileLock } from "../internal/file-lock.js";
import { projectConfigPath } from "./paths.js";
import { renderProjectConfigToml } from "./project-config.js";

type Table = Record<string, unknown>;
export async function withProjectCredentialLock<T>(
  root: string,
  projectId: string,
  action: () => Promise<T>,
): Promise<T> {
  return withFileLock(await fileLockKey(projectConfigPath(root, projectId)), action);
}
function parseCredentials(value: unknown): ChatGPTCredentials {
  const c = value as Partial<ChatGPTCredentials> | undefined;
  if (
    !c ||
    typeof c.accessToken !== "string" ||
    !c.accessToken ||
    typeof c.refreshToken !== "string" ||
    !c.refreshToken ||
    typeof c.accountId !== "string" ||
    !c.accountId ||
    typeof c.expiresAt !== "number" ||
    !Number.isFinite(c.expiresAt)
  )
    throw new ChatGPTAuthorizationError("Connect a ChatGPT subscription in Models first.");
  return c as ChatGPTCredentials;
}

/** Reloads on every request so disconnects and refresh rotations reach existing sessions.
 * Refreshes are serialized within this Penguin process. Separate processes must not share
 * a subscription credential while refreshing it (the same single-server project convention).
 */
export function projectChatGPTCredentials(
  root: string,
  projectId: string,
  modelId: string,
): ChatGPTCredentialProvider {
  const file = projectConfigPath(root, projectId);
  return async (signal) =>
    withFileLock(
      await fileLockKey(file),
      async () => {
        const read = async (): Promise<Table> => {
          try {
            return parseToml(await fs.readFile(file, "utf8")) as Table;
          } catch {
            throw new Error(
              "The project's ChatGPT credentials could not be read. Reconnect in Models.",
            );
          }
        };
        const rows = (raw: Table): Table[] =>
          Array.isArray(raw.models) ? (raw.models as Table[]) : [];
        const find = (raw: Table) =>
          rows(raw).find(
            (m) =>
              m.provider === "chatgpt-codex" &&
              m.model_id === modelId &&
              m.client_type === "chatgpt-codex",
          );
        const initial = await read();
        const current = parseCredentials(find(initial)?.chatgpt_oauth);
        signal?.throwIfAborted();
        if (current.expiresAt > Date.now() + 60_000) return current;
        // Finish persisting a rotation even if the request is cancelled during refresh.
        const next = await refreshChatGPTCredentials(current);
        const latest = await read();
        const stillConnected = parseCredentials(find(latest)?.chatgpt_oauth);
        if (stillConnected.refreshToken !== current.refreshToken)
          throw new Error("The ChatGPT connection changed. Retry the request.");
        latest.models = rows(latest).map((m) =>
          m.provider === "chatgpt-codex" &&
          (m.chatgpt_oauth as ChatGPTCredentials | undefined)?.refreshToken === current.refreshToken
            ? { ...m, chatgpt_oauth: next }
            : m,
        );
        await atomicWriteFile(file, renderProjectConfigToml(latest), {
          mode: 0o600,
          followSymlinks: true,
        });
        signal?.throwIfAborted();
        return next;
      },
      signal,
    );
}
