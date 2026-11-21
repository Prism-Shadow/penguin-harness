// The chat model of each presentation: the model controls on the rail and on the start page, and
// the choice that opens a deck's Session on a model or switches the Session it already has.
//
// A deck's model is its Session's model, read back from the Session: nothing here stores one.
// The labels come from the app the page is framed in (the page SDK's getChatModel), which also
// shows its own model picker (chooseChatModel).
import { S } from "./strings.js";

const modelKey = (m) => JSON.stringify([m.provider, m.modelId]);
const sessionPath = (sessionId) => "/sessions/" + encodeURIComponent(sessionId);

/**
 * `currentDeck()` is the open deck (its `model`, `choosingModel` and `pendingModel` are kept on
 * it), `currentTalk()` the rail's view of its Session; `send` posts to the workbench's handler,
 * `loadSdk` imports the page SDK, and `refreshTalk` reads the deck's Session again.
 */
export function setupModelChoice({
  $,
  notice,
  send,
  loadSdk,
  currentDeck,
  currentTalk,
  refreshTalk,
}) {
  let defaultModel = null;
  /** Whether the app has answered for the Project's default model (and so whether null means none). */
  let defaultKnown = false;
  let startModel = null;
  let startPicking = false;
  let railControl;
  let startControl;
  const labels = new Map();

  function draw() {
    const open = currentDeck();
    const talk = currentTalk();
    const busy = open?.choosingModel || open?.pendingModel || talk.status === "compacting";
    // With no default model there is nothing for "Project default" to mean: ask for a choice.
    const fallback = defaultKnown && defaultModel === null ? S.pickModel : S.defaultModel;
    railControl?.(
      open?.model ?? defaultModel,
      fallback,
      S.chooseModel,
      !open || Boolean(busy) || (talk.status !== null && talk.status !== "idle"),
      !!open?.choosingModel,
    );
    startControl?.(startModel ?? defaultModel, fallback, S.chooseModel, startPicking, startPicking);
    $("send").disabled = Boolean(busy);
    $("rail-reset").disabled = Boolean(busy);
  }

  async function choose(start) {
    const deck = currentDeck();
    if (start ? startPicking : !deck || deck.choosingModel || deck.pendingModel) return;
    if (start) startPicking = true;
    else deck.choosingModel = true;
    draw();
    try {
      const api = await loadSdk();
      if (!api?.chooseChatModel) {
        notice(S.modelUnsupported);
        return;
      }
      const choice = await api.chooseChatModel(start ? startModel : deck.model);
      if (!choice || (!start && currentDeck() !== deck)) return;
      labels.set(modelKey(choice), choice.label);
      if (start) {
        startModel = choice;
        return;
      }
      // The first choice opens this deck's own Session. Existing Sessions keep their history.
      const response = await send("/ask/session", "POST", { deck: deck.id, model: choice });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || String(response.status));
      if (currentDeck() !== deck) return;
      const path = sessionPath(body.sessionId);
      const {
        body: { session },
      } = await api.transport.get(path);
      if (currentDeck() !== deck) return;
      if (modelKey(session) !== modelKey(choice)) {
        await api.transport.post(path + "/switch-model", {
          provider: choice.provider,
          modelId: choice.modelId,
        });
        deck.pendingModel = choice;
      }
      await refreshTalk();
    } catch (error) {
      if (start || currentDeck() === deck)
        notice(
          error.name === "WorkbenchHostUnavailable"
            ? S.modelUnsupported
            : S.modelFailed(String(error.message || error)),
        );
    } finally {
      if (start) startPicking = false;
      else deck.choosingModel = false;
      draw();
      requestAnimationFrame(() => {
        if (start || currentDeck() === deck)
          (start ? $("start-model") : $("chat-model")).querySelector("button")?.focus();
      });
    }
  }

  /** Reads the model of the deck's Session into `deck.model`; ends a switch once the Session is idle. */
  async function readSessionModel(deck, sessionId) {
    const api = await loadSdk();
    if (!api || currentDeck() !== deck) return;
    const {
      body: { session },
    } = await api.transport.get(sessionPath(sessionId));
    if (currentDeck() !== deck || currentTalk().sessionId !== sessionId) return;
    const key = modelKey(session);
    if (!labels.has(key)) {
      const ref = { provider: session.provider, modelId: session.modelId };
      const named = await api.getChatModel?.(ref).catch(() => null);
      if (currentDeck() !== deck || currentTalk().sessionId !== sessionId) return;
      labels.set(key, named?.label || session.modelId);
    }
    deck.model = { provider: session.provider, modelId: session.modelId, label: labels.get(key) };
    if (deck.pendingModel && session.status === "idle") {
      if (modelKey(deck.pendingModel) !== modelKey(session)) notice(S.modelUnchanged);
      deck.pendingModel = null;
    }
    draw();
  }

  /**
   * Whether a request would find no model: the app says the Project has no default model, and
   * neither the deck's Session (`deck`, or null on the start page) nor the start page names one.
   */
  const needsModel = (deck) =>
    defaultKnown && defaultModel === null && !(deck ? deck.model : startModel);

  /** The model chosen on the start page for the next new presentation: null for the Project default. */
  const startChoice = () => startModel;
  /** Once a presentation has opened on it, the start page goes back to the Project default. */
  function clearStartChoice() {
    startModel = null;
    draw();
  }

  void import("./model-control.js")
    .then(({ mountModelControl }) => {
      railControl = mountModelControl($("chat-model"), () => void choose(false));
      startControl = mountModelControl($("start-model"), () => void choose(true));
      draw();
      void loadSdk()
        .then((api) => api?.getChatModel?.())
        .then((model) => {
          if (model === undefined) return;
          defaultModel = model;
          defaultKnown = true;
          draw();
        })
        .catch(() => {
          /* The picker can retry when the user opens it. */
        });
    })
    .catch(() => {
      /* Plain static previews do not have the workbench UI runtime. */
    });

  return {
    draw,
    readSessionModel,
    startChoice,
    clearStartChoice,
    needsModel,
    pick: (start) => void choose(start),
  };
}
