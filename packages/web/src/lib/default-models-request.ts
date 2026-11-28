/**
 * Opening the Project's Default model settings dialog: the Models page's header, the composer's
 * reminder, a connect flow that leaves a Project with keys but no default — anything outside the layer that
 * owns the dialog (the models feature's default-models-layer.tsx, mounted once beside every page).
 *
 * A request made before the layer has mounted is kept and delivered the moment it subscribes, as
 * a Settings request is (settings-request.ts).
 */
type Listener = () => void;

let listener: Listener | null = null;
let pending = false;

/** Asks the mounted layer to open the dialog on the current Project. */
export function requestDefaultModels(): void {
  if (listener) listener();
  else pending = true;
}

/** The layer's side: one listener at a time, taking a request made before it mounted at once. */
export function onDefaultModelsRequest(next: Listener): () => void {
  listener = next;
  if (pending) {
    pending = false;
    next();
  }
  return () => {
    if (listener === next) listener = null;
  };
}

const MODELS_CHANGED = "penguin-project-models-changed";

/**
 * A Project's model table changed in this window (a key saved, a provider connected, a default
 * set): the onboarding reads it again to see whether a model can be used now. Other windows read
 * it again when they are next shown.
 */
export function notifyModelsChanged(projectId: string): void {
  window.dispatchEvent(new CustomEvent(MODELS_CHANGED, { detail: projectId }));
}

/** Calls `fn` with the Project of every such change until the returned function is called. */
export function onModelsChanged(fn: (projectId: string) => void): () => void {
  const listener = (event: Event) => fn((event as CustomEvent<string>).detail);
  window.addEventListener(MODELS_CHANGED, listener);
  return () => window.removeEventListener(MODELS_CHANGED, listener);
}
