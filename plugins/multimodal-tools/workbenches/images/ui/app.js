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
const path = location.pathname.match(
  /^(.*?)\/api\/projects\/([^/]+)\/agents\/[^/]+\/workbenches\//,
);
const relay = path?.[1] || "";
const cap = relay + "/api/projects/" + path?.[2] + "/capabilities";
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
function linkedImage(file, sessionId) {
  if (file.sessionId !== sessionId || !/^image\/(?:png|jpe?g|webp|gif|avif)$/i.test(file.mimeType))
    return null;
  const expected = cap + "/artifacts/" + encodeURIComponent(file.id);
  const source = new URL(file.url, location.origin);
  if (source.origin !== location.origin || relay + source.pathname !== expected) return null;
  return expected;
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
  const query = "?sessionId=" + encodeURIComponent(job.sessionId);
  try {
    const [{ session, job: serverJob }, { runs }, { artifacts }] = await Promise.all([
      request("../api/jobs/" + job.id),
      request(cap + "/usage" + query),
      request(cap + "/artifacts" + query),
    ]);
    if (serial !== generation) return;
    const imageRuns = runs.filter((r) => r.sessionId === job.sessionId && r.capability === "image");
    const active = imageRuns.some((r) => r.status === "running");
    const working = session.status === "running" || active;
    const images = artifacts
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
    // Stop the driving Session first so it cannot start another run while existing ones are cancelled.
    const response = await fetch(
      relay + "/api/sessions/" + encodeURIComponent(job.sessionId) + "/abort",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    if (!response.ok && response.status !== 409) throw new Error(S.requestFailed);
    const { runs } = await request(cap + "/usage?sessionId=" + encodeURIComponent(job.sessionId));
    const active = runs.filter(
      (r) => r.sessionId === job.sessionId && r.capability === "image" && r.status === "running",
    );
    await Promise.all(
      active.map((r) => request(cap + "/runs/" + encodeURIComponent(r.id), "DELETE")),
    );
    if (response.ok || active.length)
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
async function start() {
  $("generate").disabled = true;
  stage(S.idle);
  const [settings, history] = await Promise.allSettled([request(cap), request("../api/jobs")]);
  if (settings.status === "fulfilled") {
    binding = settings.value.bindings.image;
    $("model").textContent = binding ? binding.provider + " / " + binding.modelId : S.unconfigured;
  } else $("model").textContent = S.unavailable;
  $("generate").disabled = !binding;
  if (history.status === "fulfilled") {
    jobs = history.value.jobs;
    choose(jobs[0] || null);
  } else {
    showHistory();
    problem(history.reason.message);
  }
}
void start();
