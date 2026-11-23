const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const { once } = require("node:events");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const web = createRequire(path.resolve("packages/web/package.json"));
const { _electron } = createRequire(web.resolve("@playwright/test"))("playwright");
const [mode, program, record, expectedProfile, expectedData] = process.argv.slice(2);
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.PH_DISPOSABLE_WINDOWS, "yes");
assert.ok(path.resolve(record).startsWith(path.resolve(process.env.RUNNER_TEMP) + path.sep));
const key = "installer-profile-check";
const user = "admin";
const asset = Buffer.from("a real attachment from the original account\n");
const phase = mode === "seed" ? { password: crypto.randomBytes(24).toString("hex") } : JSON.parse(fs.readFileSync(record));
const env = { ...process.env, PENGUIN_SEED_ADMIN_PASSWORD: phase.password };
const cut = (p) => path.normalize(p).toLowerCase().replace(/[\\/]+$/, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run() {
  const endpoint = http.createServer((req,res) => {
    req.resume();
    const usage = {prompt_tokens:3,cached_tokens:0,response_tokens:1,thoughts_tokens:0};
    const reply = [{role:"assistant",event_type:"delta",content_items:[{type:"text.done",text:"Saved."}],usage_metadata:null,finish_reason:null},
      {role:"assistant",event_type:"stop",content_items:[],usage_metadata:usage,finish_reason:"stop"}];
    res.writeHead(200,{"content-type":"text/event-stream"});
    res.end(reply.map(x=>"data: "+JSON.stringify(x)+"\n\n").join("")+"data: [DONE]\n\n");
  });
  endpoint.listen(0,"127.0.0.1");
  await once(endpoint,"listening");
  endpoint.unref();
  const desktop = await _electron.launch({ executablePath: path.join(program, "PenguinHarness.exe"), env, timeout: 90000 });
  try {
    const page = await desktop.firstWindow({ timeout: 90000 });
    await page.waitForURL(/^http:\/\/(127\.0\.0\.1|localhost):\d+/, { timeout: 90000 });
    const base = new URL(page.url()).origin;
    const profile = await desktop.evaluate(({ app }) => app.getPath("userData"));
    assert.equal(cut(profile), cut(expectedProfile));
    async function api(method, url, data) {
      const response = await page.request.fetch(base + url, { method, data });
      if (!response.ok()) throw new Error(method + " " + url + " returned " + response.status() + " " + (await response.text()).slice(0,340));
      return response;
    }
    if (mode === "seed") {
      await api("POST", "/api/auth/login", { userId: "admin", password: phase.password });
      await desktop.evaluate(async ({ session }, origin) => {
        await session.defaultSession.cookies.set({url: origin, name: "installed-profile-marker", value: "fixture-session", expirationDate: Date.now()/1000+86400});
      },base);
      const projects = await (await api("GET", "/api/projects")).json();
      phase.project = projects.projects[0].projectId;
      const project = "/api/projects/" + phase.project;
      const model = { provider: "custom", modelId: "installer-fixture" };
      await api("PUT", project + "/models", { defaultModel: model, providers:{custom:{clientType:"mmsp",baseUrl:"http://127.0.0.1:"+endpoint.address().port+"/v1",apiKey:"fixture"}}, models: [{ ...model, contextWindow: 32000, pricing: { cacheRead: 1, cacheWrite: 1, output: 1 } }] });
      const created = await (await api("POST", project + "/agents/default_agent/sessions", model)).json();
      phase.sid = created.session.sessionId;
      const sid = "/api/sessions/" + phase.sid;
      await api("PUT", sid + "/files/content?path=installer-marker.txt", { dataBase64: Buffer.from("original workspace").toString("base64") });
      await api("POST", sid + "/tasks", { input: [{ type: "text", text: "Retain this attachment." }, { type: "file", fileName: "acceptance.txt", dataUrl: "data:text/plain;base64," + asset.toString("base64") }] });
      await page.goto(base + "/chat/" + phase.sid);
      await page.evaluate((k) => localStorage.setItem(k, "existing desktop preference"), key);
      const session = (await (await api("GET", sid)).json()).session;
      phase.workspace = session.workspace;
      assert.ok(phase.workspace && cut(phase.workspace).startsWith(cut(expectedData) + "\\"), "old Session owns a workspace in its data root");
      fs.writeFileSync(record, JSON.stringify(phase), { mode: 0o600 });
      // Flush the actual Electron cookie store before closing this installed app.
      await desktop.evaluate(async ({ session }) => { await session.defaultSession.cookies.flushStore(); });
    }
    const saved = await desktop.evaluate(async ({session},origin) => session.defaultSession.cookies.get({url:origin,name:"installed-profile-marker"}),base);
    assert.equal(saved[0]?.value, "fixture-session", "original persistent Chromium cookie");
    const me = await (await api("GET", "/api/me")).json();
    assert.equal(me.user.userId, user, "the original signed-in account is still active");
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), key), "existing desktop preference");
    const sid = "/api/sessions/" + phase.sid;
    const restored = (await (await api("GET", sid)).json()).session;
    assert.equal(restored.sessionId, phase.sid);
    const attachment = await (await api("GET", sid + "/scratchpad/acceptance.txt")).body();
    assert.deepEqual(attachment, asset);
    const file = await (await api("GET", sid + "/files/content?path=installer-marker.txt")).body();
    assert.ok(file.includes(Buffer.from("original workspace")) || file.includes(Buffer.from("moved workspace")));
    if (mode === "moved") {
      await api("PUT", sid + "/files/content?path=installer-marker.txt", { dataBase64: Buffer.from("moved workspace").toString("base64") });
      const relocated = path.join(expectedData, path.relative(phase.originalData, phase.workspace), "installer-marker.txt");
      assert.equal(fs.readFileSync(relocated, "utf8"), "moved workspace");
      assert.equal(fs.readFileSync(path.join(phase.workspace, "installer-marker.txt"), "utf8"), "original workspace");
    }
    const cli = path.join(program, "resources", "app", "bin", "penguin.cmd");
    const out = spawnSync(process.env.ComSpec, ["/d", "/s", "/c", '""' + cli + '" server status"'], { windowsVerbatimArguments: true, encoding: "utf8" });
    assert.equal(out.status, 0, "the installed CLI can read its data root");
    const status = JSON.parse(out.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(status.running, true);
    assert.equal(status.port, Number(new URL(base).port));
    if (mode === "seed") {
      phase.machineId = status.machineId;
      phase.originalData = expectedData;
      fs.writeFileSync(record, JSON.stringify(phase), { mode: 0o600 });
    } else {
      assert.equal(status.machineId, phase.machineId, "CLI and desktop found the same machine in the migrated database");
    }
    console.log(mode + ": original account, Session, attachment, Electron preference, workspace and installed CLI verified.");
  } finally {
    endpoint.closeAllConnections();endpoint.close();
    await desktop.close();
    await sleep(1200);
  }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
