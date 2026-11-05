#!/usr/bin/env node
// Activate the target Agent's watcher and report this server's actual load result, or, with
// --follow, print a Session's records as a workbench page would receive them.
import http from "node:http";
import https from "node:https";

const args = process.argv.slice(2);
const following = args[0] === "--follow";
const [agentId, workbenchId] = following ? [] : args;
const sessionId = following ? args[1] : undefined;
const {
  PENGUIN_API_URL: base,
  PENGUIN_API_TOKEN: token,
  PENGUIN_PROJECT_ID: project,
} = process.env;
if (!base || !token || (following ? !sessionId : !project || !agentId || !workbenchId)) {
  console.error(
    "Usage: node check.mjs <agent_id> <workbench_id>, or node check.mjs --follow <session_id>, inside a PenguinHarness Session. Requires its injected PENGUIN_API_URL, PENGUIN_API_TOKEN and PENGUIN_PROJECT_ID. Do not search for another server or credentials.",
  );
  process.exit(1);
}
/** How long --follow waits for the main conversation's task_end. */
const FOLLOW_LIMIT_MS = 60_000;
async function readJson(route) {
  const url = new URL(route, base);
  // Direct to the injected server; shell proxies must not redirect loopback requests.
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(
      url,
      {
        headers: { authorization: `Bearer ${token}` },
        timeout: 30000,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200)
            reject(
              new Error(
                `Server returned HTTP ${res.statusCode} for ${url.pathname}. Check this Session's Project access.`,
              ),
            );
          else {
            try {
              resolve(JSON.parse(text));
            } catch {
              reject(new Error("Server returned invalid JSON"));
            }
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Workbench check timed out after 30 seconds")));
    req.on("error", reject);
  });
}
/**
 * Reads the Session's AMSP stream through the signed-in user's door, the one a workbench page
 * reads, and prints each record as one JSON line. Live only: it shows what is written from now.
 * Resolves the exit code: 0 at the main conversation's task_end, or at the time limit once
 * records came; 1 when none came or the stream ended first.
 */
function follow(id) {
  const url = new URL(`/api/sessions/${encodeURIComponent(id)}/amsp`, base);
  return new Promise((resolve, reject) => {
    let records = 0;
    let announced = false;
    let pending = "";
    let settled = false;
    const finish = (code, note) => {
      if (settled) return;
      settled = true;
      clearTimeout(limit);
      if (note) console.error(note);
      req.destroy();
      resolve(code);
    };
    // finish() destroys the request, and the response then reports an "aborted" error: ignored.
    const fail = (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(limit);
      reject(e);
    };
    const frame = (text) => {
      const lines = text.split("\n");
      const event = lines
        .find((l) => l.startsWith("event:"))
        ?.slice(6)
        .trim();
      const data = lines
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (event === "ping" && !announced) {
        announced = true;
        console.error(
          `Following ${id}. Records print as they are written; start a turn if none come.`,
        );
      }
      // A named event is a control frame; only records carry no name.
      if (event !== undefined || data === "") return;
      records++;
      console.log(data);
      let record;
      try {
        record = JSON.parse(data);
      } catch {
        return;
      }
      if (record.type === "event_msg" && record.payload?.type === "task_end" && !record.origin)
        finish(0);
    };
    const req = (url.protocol === "https:" ? https : http).get(
      url,
      { headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" } },
      (res) => {
        res.on("error", fail);
        if (res.statusCode !== 200) {
          res.resume();
          fail(
            new Error(
              `Server returned HTTP ${res.statusCode} for ${url.pathname}. Check the Session id and this Session's Project access.`,
            ),
          );
          return;
        }
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          pending += chunk.replaceAll("\r\n", "\n");
          let end;
          while (!settled && (end = pending.indexOf("\n\n")) !== -1) {
            frame(pending.slice(0, end));
            pending = pending.slice(end + 2);
          }
        });
        res.on("end", () => finish(1, "The stream ended before the main conversation's task_end."));
      },
    );
    const limit = setTimeout(
      () =>
        finish(
          records > 0 ? 0 : 1,
          records > 0
            ? `Stopped after ${FOLLOW_LIMIT_MS / 1000} seconds without the main conversation's task_end; the turn is still running.`
            : `No record in ${FOLLOW_LIMIT_MS / 1000} seconds. The stream is live only: start a turn, then follow it.`,
        ),
      FOLLOW_LIMIT_MS,
    );
    req.on("error", fail);
  });
}
/** Lists the target's workbenches, which loads them, and prints this one's load result. */
async function check() {
  const agentsRoute = `/api/projects/${encodeURIComponent(project)}/agents`;
  // Listing reconciles Agents created through file tools with the server's Session index.
  const discovered = await readJson(agentsRoute);
  if (!discovered.agents?.some((agent) => agent.agentId === agentId)) {
    throw new Error(
      `Agent ${agentId} is not initialized. Check its agent_state/system_config.yaml before loading its workbench.`,
    );
  }
  const body = await readJson(`${agentsRoute}/${encodeURIComponent(agentId)}/workbenches`);
  const workbench = body.workbenches?.find((item) => item.id === workbenchId);
  if (!workbench)
    throw new Error(
      `No workbench ${workbenchId} under Agent ${agentId}. Check the target folder and package.json.`,
    );
  console.log(JSON.stringify(workbench, null, 2));
  return workbench.error || !workbench.tabs?.length || workbench.hints?.length ? 1 : 0;
}
try {
  process.exitCode = following ? await follow(sessionId) : await check();
} catch (e) {
  console.error(
    e instanceof Error ? e.message.replaceAll(token, "[redacted]") : "Workbench check failed",
  );
  process.exitCode = 1;
}
