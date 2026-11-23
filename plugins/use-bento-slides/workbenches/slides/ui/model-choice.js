// Session settings come from the host. A choice on the start page belongs to the next deck only.
import { S } from "./strings.js";

const key = (model) => model && JSON.stringify([model.provider, model.modelId]);
const sessionPath = (id) => "/sessions/" + encodeURIComponent(id);
const label = (model) => model?.label || model?.modelId;

export function setupModelChoice({
  $,
  notice,
  send,
  loadSdk,
  currentDeck,
  currentTalk,
  refreshTalk,
}) {
  const labels = new Map();
  let defaultModel;
  let thinking = null;
  let startModel = null;
  let startEffort = null;
  let startPicking = false;
  let railModel, newModel, railEffort, newEffort;

  function draw() {
    const deck = currentDeck();
    const status = currentTalk().status;
    const fallback = defaultModel === null ? S.pickModel : S.defaultModel;
    railModel?.(
      deck?.model ?? defaultModel,
      fallback,
      S.chooseModel,
      !deck || !!deck.choosingModel,
      !!deck?.choosingModel,
    );
    newModel?.(startModel ?? defaultModel, fallback, S.chooseModel, startPicking, startPicking);
    railEffort?.(thinking, deck?.draftEffort ?? deck?.effort, !deck || !!deck.choosingModel);
    newEffort?.(thinking, startEffort, startPicking);
    const pending = deck?.pendingModel;
    const detail = [
      pending && deck.model ? S.pendingModel(label(deck.model), label(pending)) : "",
      status && status !== "idle" ? S.effortNext : "",
    ]
      .filter(Boolean)
      .join(" ");
    const line = $("choice-status");
    line.hidden = !detail;
    if (line.textContent !== detail) line.textContent = detail;
    $("send").disabled = !!deck?.savingChoice;
    $("rail-reset").disabled = !!deck?.savingChoice;
  }

  function confirm(title, description) {
    const dialog = $("choice-confirm");
    $("choice-title").textContent = title;
    $("choice-description").textContent = description;
    dialog.returnValue = "";
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "switch"), {
        once: true,
      });
      dialog.showModal();
    });
  }

  async function ensureSession(deck, model) {
    const response = await send("/ask/session", "POST", {
      deck: deck.id,
      ...(model ? { model } : {}),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || body.error || String(response.status));
    return body.sessionId;
  }

  async function setEffort(api, sessionId, thinkingLevel) {
    const response = await fetch(api.apiBase + sessionPath(sessionId), {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thinkingLevel }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message ?? String(response.status));
    }
  }

  // The session and its label lookup are distinct reads. A slower lookup must not repaint
  // an earlier selection over a later reply, or a conversation that was reset.
  async function readSessionModel(deck, id) {
    const revision = (deck.choiceRead = (deck.choiceRead || 0) + 1);
    const api = await loadSdk();
    if (!api) return;
    const {
      body: { session },
    } = await api.transport.get(sessionPath(id));
    async function named(ref) {
      if (!ref) return null;
      const k = key(ref);
      if (!labels.has(k)) {
        const row = await api.getChatModel?.(ref).catch(() => null);
        labels.set(k, row?.label || ref.modelId);
      }
      return { provider: ref.provider, modelId: ref.modelId, label: labels.get(k) };
    }
    const [model, pending] = await Promise.all([named(session), named(session.pendingModel)]);
    if (currentDeck() !== deck || currentTalk().sessionId !== id || deck.choiceRead !== revision)
      return;
    deck.model = model;
    deck.pendingModel = pending;
    deck.effort = session.thinkingLevel ?? null;
    draw();
  }

  async function choose(start, level = null) {
    const deck = currentDeck();
    if (start ? startPicking : !deck || deck.choosingModel) return;
    if (start) startPicking = true;
    else deck.choosingModel = true;
    draw();
    try {
      const api = await loadSdk();
      if (!api?.chooseChatModel) {
        notice(S.modelUnsupported);
        return;
      }
      let choice = null;
      if (level === null) {
        choice = await api.chooseChatModel(
          start ? (startModel ?? defaultModel) : (deck.pendingModel ?? deck.model ?? defaultModel),
        );
        if (!choice) return;
        labels.set(key(choice), label(choice));
      }
      if (start) {
        if (choice) startModel = choice;
        else startEffort = level;
        return;
      }
      if (currentDeck() !== deck) return;
      const talk = currentTalk();
      if (choice && key(choice) === key(deck.pendingModel ?? deck.model)) return;
      if (level !== null && !talk.sessionId && defaultModel === null && !deck.model) {
        deck.draftEffort = level;
        return;
      }
      if (talk.messages.some((message) => message.role === "user")) {
        const copy = choice
          ? key(choice) !== key(deck.model) && S.modelCost(label(choice))
          : (deck.effort ?? thinking?.defaultLevel) !== level && S.effortCost;
        if (copy && !(await confirm(choice ? S.chooseModel : thinking.title, copy))) return;
      }
      if (currentDeck() !== deck || currentTalk().sessionId !== talk.sessionId) return;
      deck.savingChoice = true;
      draw();
      const id = talk.sessionId ?? (await ensureSession(deck, choice));
      if (currentDeck() !== deck) return;
      if (level !== null) await setEffort(api, id, level);
      else if (talk.sessionId) {
        await api.transport.post(sessionPath(id) + "/switch-model", {
          provider: choice.provider,
          modelId: choice.modelId,
          whenIdle: true,
        });
      }
      if (deck.draftEffort) {
        await setEffort(api, id, deck.draftEffort);
        deck.draftEffort = null;
      }
      await refreshTalk();
    } catch (error) {
      if (start || currentDeck() === deck)
        notice(
          error.name === "WorkbenchHostUnavailable"
            ? S.modelUnsupported
            : S.choiceFailed(String(error.message || error)),
        );
    } finally {
      if (start) startPicking = false;
      else {
        deck.choosingModel = false;
        deck.savingChoice = false;
      }
      draw();
      if (level === null)
        requestAnimationFrame(() => {
          if (start || currentDeck() === deck)
            $(start ? "start-model" : "chat-model")
              .querySelector("button")
              ?.focus();
        });
    }
  }

  async function prepareStart(deck) {
    if (startEffort === null) return;
    const id = await ensureSession(deck, startModel);
    const api = await loadSdk();
    await setEffort(api, id, startEffort);
  }

  void import("./model-control.js")
    .then(({ mountModelControl, mountEffortControl }) => {
      railModel = mountModelControl($("chat-model"), () => void choose(false));
      newModel = mountModelControl($("start-model"), () => void choose(true));
      railEffort = mountEffortControl($("chat-effort"), (level) => void choose(false, level));
      newEffort = mountEffortControl($("start-effort"), (level) => void choose(true, level));
      draw();
      void loadSdk().then((api) => {
        void api
          ?.getChatModel?.()
          .then((model) => {
            defaultModel = model;
            draw();
          })
          .catch(() => {});
        void api
          ?.getChatThinkingOptions?.()
          .then((levels) => {
            thinking = levels;
            draw();
          })
          .catch((error) => notice(S.choiceFailed(error.message)));
      });
    })
    .catch(() => {
      /* Static previews have no host UI runtime. */
    });

  return {
    draw,
    readSessionModel,
    prepareStart,
    startChoice: () => startModel,
    clearStartChoice() {
      startModel = null;
      startEffort = null;
      draw();
    },
    needsModel: (deck) => defaultModel === null && !(deck ? deck.model : startModel),
    pick: (start) => void choose(start),
  };
}
