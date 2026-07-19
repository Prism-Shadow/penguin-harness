/**
 * Workspace validation.
 *
 * When a user explicitly specifies a Workspace: after realpath normalization
 * (resolving `..` and symlinks), it's required to be an **existing directory**
 * (never auto-created). The directory location is not constrained to the
 * Project directory — a Workspace can be any path on the server, with actual
 * reachability governed by the file permissions of the OS account running the
 * service.
 * When no Workspace is specified, this module isn't involved (the SDK creates its
 * own temporary directory).
 */
import fs from "node:fs/promises";
import { HttpError } from "../http/errors.js";

/**
 * Validates and returns the normalized (realpath) Workspace path.
 *
 * @throws 400 workspace_not_found: the path doesn't exist, isn't readable, or isn't a directory.
 */
export async function assertWorkspaceAllowed(args: { workspace: string }): Promise<string> {
  let ws: string;
  try {
    ws = await fs.realpath(args.workspace);
  } catch {
    throw new HttpError(
      400,
      "workspace_not_found",
      `Workspace 不存在或不可访问：${args.workspace}。请指定一个已存在的目录，或留空以使用临时目录。`,
    );
  }
  const stat = await fs.stat(ws);
  if (!stat.isDirectory()) {
    throw new HttpError(400, "workspace_not_found", `Workspace 不是目录：${args.workspace}。`);
  }
  return ws;
}
