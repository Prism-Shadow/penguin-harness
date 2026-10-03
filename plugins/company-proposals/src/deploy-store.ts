/**
 * The deployment registry's storage: one append-only JSON-lines file per organization,
 * `<root>/<projectId>/organizations/<orgId>/deployments.jsonl`, each line a `deployment` line —
 * `{ seq, at, kind: "deployment", id, url?, installId?, by }`, `url` and `installId` together
 * for a penguin server deployment only. It is kept apart from the proposals' relational store
 * on purpose: deployments are not proposal data, and the file starts empty.
 *
 * Appends go through one promise chain per file, and a checked append runs its check inside
 * the chain — after every earlier append has landed — so no concurrent registration slips
 * between the uniqueness check (deployments.ts) and the write.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { RegisteredDeployment } from "./domain.js";

/** The file's name inside the organization directory. */
export const DEPLOYMENTS_FILE = "deployments.jsonl";

export function deploymentsPath(root: string, projectId: string, orgId: string): string {
  return path.join(root, projectId, "organizations", orgId, DEPLOYMENTS_FILE);
}

/** One line of the file. */
export interface DeploymentLine {
  seq: number;
  at: string;
  kind: "deployment";
  id: string;
  url?: string;
  installId?: string;
  by: string;
}

/** The lines of the file's text; a line that is not a deployment line is skipped. */
export function parseDeployments(text: string): RegisteredDeployment[] {
  const out: RegisteredDeployment[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      continue;
    }
    const l = v as Partial<DeploymentLine> | null;
    if (l === null || typeof l !== "object" || l.kind !== "deployment") continue;
    if (typeof l.id !== "string" || typeof l.at !== "string" || typeof l.by !== "string") continue;
    out.push({
      id: l.id,
      url: typeof l.url === "string" ? l.url : null,
      installId: typeof l.installId === "string" ? l.installId : null,
      at: l.at,
      by: l.by,
    });
  }
  return out;
}

/** One organization's registry over its file. */
export class DeploymentStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly file: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Every registered deployment, in the order they were registered. */
  async list(): Promise<RegisteredDeployment[]> {
    return parseDeployments(await this.text());
  }

  private async text(): Promise<string> {
    try {
      return await fs.readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw err;
    }
  }

  /**
   * Appends a registration once `check` — run inside the chain with the registry as it stands —
   * does not throw.
   */
  append(
    entry: { id: string; url: string | null; installId: string | null; by: string },
    check: (registered: RegisteredDeployment[]) => void,
  ): Promise<RegisteredDeployment[]> {
    const run = this.chain.then(async () => {
      const text = await this.text();
      const registered = parseDeployments(text);
      check(registered);
      const lines = text.split("\n").filter((l) => l.trim() !== "").length;
      const line: DeploymentLine = {
        seq: lines + 1,
        at: new Date(this.now()).toISOString(),
        kind: "deployment",
        id: entry.id,
        ...(entry.url !== null && entry.installId !== null
          ? { url: entry.url, installId: entry.installId }
          : {}),
        by: entry.by,
      };
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.appendFile(this.file, `${JSON.stringify(line)}\n`, "utf8");
      return parseDeployments(`${text}\n${JSON.stringify(line)}`);
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}
