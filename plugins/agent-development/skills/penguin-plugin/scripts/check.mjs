#!/usr/bin/env node
// Activate the target Agent's watcher and report this server's actual load result.
import http from "node:http";
import https from "node:https";

const [agentId, workbenchId] = process.argv.slice(2);
const {
  PENGUIN_API_URL: base,
  PENGUIN_API_TOKEN: token,
  PENGUIN_PROJECT_ID: project,
} = process.env;
if (!base || !token || !project || !agentId || !workbenchId) {
  console.error(
    "Usage: node check.mjs <agent_id> <workbench_id> inside a PenguinHarness Session. Requires its injected PENGUIN_API_URL, PENGUIN_API_TOKEN and PENGUIN_PROJECT_ID. Do not search for another server or credentials.",
  );
  process.exit(1);
}
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
try {
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
  if (workbench.error || !workbench.tabs?.length || workbench.hints?.length) process.exitCode = 1;
} catch (e) {
  console.error(
    e instanceof Error ? e.message.replaceAll(token, "[redacted]") : "Workbench check failed",
  );
  process.exitCode = 1;
}
