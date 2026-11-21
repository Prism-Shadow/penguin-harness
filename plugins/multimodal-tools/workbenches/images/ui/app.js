import { lang, S } from "./strings.js";
const $ = (id) => document.getElementById(id);
document.documentElement.lang = lang;
document.title = S.title;
for (const el of document.querySelectorAll("[data-label]")) el.textContent = S[el.dataset.label];
$("prompt").placeholder = S.placeholder;
for (const [title, prompt] of S.ideas) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = title;
  button.onclick = () => {
    $("prompt").value = prompt;
    $("prompt").focus();
  };
  $("ideas").append(button);
}
// The page SDK the server serves beside this workbench: `apiBase` is the API of the server this
// page came from ("/api", "/server/<machine>/api", or whatever a proxy put in front), and
// `abortSession` stops the driving Session. Imported by a name in a variable, so that no tool
// tries to resolve the served file ahead of time.
const SDK = "../sdk/workbench.js";
const PLUGIN = "@penguinharness/multimodal-tools";
let sdk = null,
  tools = "",
  bindingsUrl = "";
/** Loads the page SDK and names this Project's routes under its API. */
async function connect() {
  if (sdk) return;
  const loaded = await import(SDK);
  // The page is served at <apiBase>/projects/<project>/agents/…: the Project is the segment
  // after the runtime's API base.
  const prefix = loaded.apiBase + "/projects/";
  if (!location.pathname.startsWith(prefix)) throw new Error(S.unavailable);
  const project = location.pathname.slice(prefix.length).split("/")[0];
  tools = prefix + project + "/multimodal-tools";
  bindingsUrl = prefix + project + "/models/tool-bindings";
  sdk = loaded;
}
const sessionPath = (sessionId) => tools + "/sessions/" + encodeURIComponent(sessionId);
const placeholder = $("stage").firstElementChild;
let jobs = [],
  current = null,
  binding = null,
  generation = 0,
  timer,
  stopping = false,
  submitting = false,
  retry = null;
async function request(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error?.message || S.requestFailed);
  }
  return res.status === 204 ? null : res.json();
}
function problem(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function stage(message, detail = "") {
  $("stage").replaceChildren(placeholder);
  $("status").textContent = message;
  $("downloads").replaceChildren();
  $("detail").textContent = detail;
  $("detail").hidden = !detail;
}
function showHistory() {
  $("jobs").replaceChildren(
    new Option(S.new, ""),
    ...jobs.map((job) => new Option(job.prompt, job.id)),
  );
  $("jobs").value = current?.id || "";
}
function choose(job) {
  current = job;
  const serial = ++generation;
  clearTimeout(timer);
  stopping = false;
  $("stop").hidden = true;
  problem("");
  showHistory();
  if (!job) {
    $("prompt").value = "";
    $("ratio").value = "1:1";
    stage(S.idle);
    return;
  }
  $("prompt").value = job.prompt;
  $("ratio").value = job.ratio;
  stage(S.running);
  void refresh(job, serial);
}
/** Where an image the Session's runs generated is downloaded; null for any other file. */
function linkedImage(file, sessionId) {
  if (file.operation !== "t2i" || !/^image\/(?:png|jpe?g|webp|gif|avif)$/i.test(file.mimeType))
    return null;
  return sessionPath(sessionId) + "/files/" + encodeURIComponent(file.name);
}
function renderImages(images, job) {
  const elements = [],
    links = [];
  for (const [index, { file, url }] of images.entries()) {
    const img = new Image();
    img.src = url;
    img.alt = job.prompt;
    if (index > 0) img.loading = "lazy";
    const link = document.createElement("a");
    link.className = "download";
    link.href = url;
    link.download = file.name;
    link.textContent = S.download + " · " + file.name;
    elements.push(img);
    links.push(link);
  }
  $("stage").replaceChildren(...elements);
  $("downloads").replaceChildren(...links);
  $("detail").hidden = true;
}
async function refresh(job, serial) {
  clearTimeout(timer);
  try {
    await connect();
    const [{ session, job: serverJob }, { runs }, { files }] = await Promise.all([
      request("../api/jobs/" + job.id),
      request(sessionPath(job.sessionId) + "/runs"),
      request(sessionPath(job.sessionId) + "/files"),
    ]);
    if (serial !== generation) return;
    const imageRuns = runs.filter((r) => r.operation === "t2i");
    const active = imageRuns.some((r) => r.status === "running");
    const working = session.status === "running" || active;
    const images = files
      .map((file) => ({ file, url: linkedImage(file, job.sessionId) }))
      .filter((x) => x.url);
    const cancelled =
      imageRuns.some((r) => r.status === "cancelled") || (serverJob.stopRequested && !working);
    const failed = imageRuns.find((r) => r.status === "failed");
    $("stop").hidden = !working;
    $("stop").disabled = stopping || serverJob.stopRequested;
    if (images.length) renderImages(images, job);
    else if (working) stage(stopping || serverJob.stopRequested ? S.stopping : S.running);
    else if (cancelled) stage(S.cancelled);
    else stage(S.failed, failed?.error || session.error || session.text || "");
    if (working) timer = setTimeout(() => void refresh(job, serial), 1400);
  } catch (e) {
    if (serial !== generation) return;
    stage(S.retrieval, e.message);
    timer = setTimeout(() => void refresh(job, serial), 4000);
  }
}
$("jobs").onchange = () => choose(jobs.find((j) => j.id === $("jobs").value) || null);
$("brief").onsubmit = async (event) => {
  event.preventDefault();
  const prompt = $("prompt").value.trim(),
    ratio = $("ratio").value;
  if (submitting || !binding || !prompt) return;
  const signature = JSON.stringify([prompt, ratio]);
  if (retry?.signature !== signature) retry = { signature, id: crypto.randomUUID() };
  submitting = true;
  $("generate").disabled = true;
  problem("");
  try {
    await refreshModel();
    if (!binding) return;
    const { job } = await request("../api/jobs", "POST", { id: retry.id, prompt, ratio, lang });
    jobs = [job, ...jobs.filter((j) => j.id !== job.id)];
    retry = null;
    choose(job);
    if (matchMedia("(max-width:720px)").matches)
      document.querySelector(".preview").scrollIntoView({ block: "start" });
  } catch (e) {
    problem(e.message);
  } finally {
    submitting = false;
    $("generate").disabled = !binding;
  }
};
$("stop").onclick = async () => {
  const job = current,
    serial = generation;
  if (!job || stopping) return;
  stopping = true;
  $("stop").disabled = true;
  problem("");
  try {
    await connect();
    // Stop the driving Session first so it cannot start another run while existing ones are cancelled.
    const interrupted = await sdk.abortSession(job.sessionId).catch(() => {
      throw new Error(S.requestFailed);
    });
    const { runs } = await request(sessionPath(job.sessionId) + "/runs");
    const active = runs.filter((r) => r.operation === "t2i" && r.status === "running");
    await Promise.all(
      active.map((r) => request(tools + "/runs/" + encodeURIComponent(r.id), "DELETE")),
    );
    if (interrupted || active.length)
      await request("../api/jobs/" + job.id + "/stop-requested", "POST", {});
    if (serial === generation) await refresh(job, serial);
  } catch (e) {
    if (serial === generation) {
      problem(e.message);
      $("stop").disabled = false;
    }
  } finally {
    if (serial === generation) stopping = false;
  }
};
async function refreshModel() {
  try {
    await connect();
    const { bindings } = await request(bindingsUrl);
    // Listed only while the multimodal tools plugin is on in this Project.
    const declared = bindings.find((b) => b.key === "t2i" && b.package === PLUGIN);
    const active = declared !== undefined;
    binding = declared?.model ?? null;
    $("model").textContent = binding
      ? binding.provider + " / " + binding.modelId
      : active
        ? S.unconfigured
        : S.disabled;
  } catch {
    binding = null;
    $("model").textContent = S.unavailable;
  }
  $("generate").disabled = submitting || !binding;
}

async function start() {
  $("generate").disabled = true;
  stage(S.idle);
  const [, history] = await Promise.allSettled([refreshModel(), request("../api/jobs")]);
  if (history.status === "fulfilled") {
    jobs = history.value.jobs;
    choose(jobs[0] || null);
  } else {
    showHistory();
    problem(history.reason.message);
  }
}
window.addEventListener("focus", () => void refreshModel());
void start();
