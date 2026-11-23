const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
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
  const desktop = await _electron.launch({ executablePath: path.join(program, "PenguinHarness.exe"), env, timeout: 90000 });
  try {
    const page = await desktop.firstWindow({ timeout: 90000 });
    await page.waitForURL(/^http:\/\/(127\.0\.0\.1|localhost):\d+/, { timeout: 90000 });
    const base = new URL(page.url()).origin;
    const profile = await desktop.evaluate(({ app }) => app.getPath("userData"));
    assert.equal(cut(profile), cut(expectedProfile));
    async function api(method, url, data) {
      const response = await page.request.fetch(base + url, { method, data });
      assert.ok(response.ok(), method + " " + url + " returned " + response.status());
      return response;
    }
    if (mode === "seed") {
      const login = await api("POST", "/api/auth/login", { userId: user, password: phase.password });
      const cookie = (await login.headersArray()).find(({ name, value }) =>
        name.toLowerCase() === "set-cookie" && value.startsWith("penguin_session="));
      assert.ok(cookie, "a real password login established a persistent session");
      phase.loginCookie = cookie.value.split(";")[0];
      phase.profileCookie = crypto.randomUUID();
      await desktop.evaluate(async ({ session }, { url, value }) => {
        await session.defaultSession.cookies.set({
          url, name: "installer_qa_profile", value, httpOnly: true, expirationDate: Date.now() / 1000 + 86400,
        });
      }, { url: base, value: phase.profileCookie });
      const projects = await (await api("GET", "/api/projects")).json();
      phase.project = projects.projects[0].projectId;
      const project = "/api/projects/" + phase.project;
      const model = { provider: "custom", modelId: "installer-fixture" };
      await api("PUT", project + "/models", { defaultModel: model, models: [{ ...model, contextWindow: 32000, baseUrl: "http://127.0.0.1:1", apiKey: "installer-fixture", pricing: { cacheRead: 1, cacheWrite: 1, output: 1 } }] });
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
    const me = await (await api("GET", "/api/me")).json();
    assert.equal(me.user.userId, user, "the original signed-in account is still active");
    const original = await fetch(base + "/api/me", { headers: { Cookie: phase.loginCookie } });
    assert.ok(original.ok && (await original.json()).user.userId === user, "the original login remains valid");
    const profileCookie = await desktop.evaluate(async ({ session }, url) =>
      (await session.defaultSession.cookies.get({ url, name: "installer_qa_profile" }))[0]?.value, base);
    assert.ok(profileCookie === phase.profileCookie, "the original Electron profile cookie survived");
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
    await desktop.close();
    await sleep(1200);
  }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
