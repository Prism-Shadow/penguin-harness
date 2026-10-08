export type StateMachineInteractableInputType = 'CLICK' | 'SELECT' | 'SELECT_CLICK' | 'DRAG';

export interface StateMachineInteractableDescriptor {
  /** DOM element id the Interactable is attached to; harnesses target this id. */
  readonly id: string;
  readonly inputType: StateMachineInteractableInputType;
  /** Semantic event the interaction handler sends back to the state machine. */
  readonly event?: string;
  readonly description?: string;
  /**
    * Declarative facts about the interactable, such as isCorrect for choice
   * hotspots or a stable choiceId. Opaque to the runtime; consumed by
   * acceptance tests and tooling.
   */
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ArmedInteractable extends StateMachineInteractableDescriptor {}

export interface RegisteredInteractable extends ArmedInteractable {
  dispose(): void;
}

export interface StateMachineInteractableRegistrar {
  register(element: Element, descriptor: StateMachineInteractableDescriptor): RegisteredInteractable;
}

export interface StateMachineInteractableRegistry extends StateMachineInteractableRegistrar {
  list(): readonly ArmedInteractable[];
  clear(): void;
  subscribe(subscriber: (interactables: readonly ArmedInteractable[]) => void): () => void;
}

interface RegistrationContext {
  onCancel(callback: () => void): void;
}

/**
 * Returns the registration context of the currently executing effect scope,
 * or undefined outside action execution. Wired by the machine adapter.
 */
export type InteractableRegistrationContext = () => RegistrationContext | undefined;

const INPUT_TYPES: readonly string[] = ['CLICK', 'SELECT', 'SELECT_CLICK', 'DRAG'];

const contextGetters = new WeakMap<
  StateMachineInteractableRegistry,
  InteractableRegistrationContext
>();

/**
 * Wires a registry to the currently executing effect scope so registrations
 * dispose automatically when their owning state exits.
 */
export function bindInteractableRegistrationContext(
  registry: StateMachineInteractableRegistry,
  getContext: InteractableRegistrationContext,
): void {
  contextGetters.set(registry, getContext);
}

function annotate(element: Element, descriptor: StateMachineInteractableDescriptor): void {
  element.setAttribute('data-interactable-id', descriptor.id);
  element.setAttribute('data-interactable-input-type', descriptor.inputType);
}

function unannotate(element: Element): void {
  element.removeAttribute('data-interactable-id');
  element.removeAttribute('data-interactable-input-type');
}

export function createInteractableRegistry(): StateMachineInteractableRegistry {
  const armed: Array<{ element: Element; descriptor: StateMachineInteractableDescriptor }> = [];
  const subscribers = new Set<(interactables: readonly ArmedInteractable[]) => void>();

  const list = (): readonly ArmedInteractable[] => (
    armed.map((entry) => Object.freeze({ ...entry.descriptor }))
  );
  const notifySubscribers = (): void => {
    const interactables = list();
    subscribers.forEach((subscriber) => subscriber(interactables));
  };

  const registry: StateMachineInteractableRegistry = {
    register(element, descriptor) {
      if (!element) {
        throw new Error('Registering an interactable requires its DOM element.');
      }
      if (typeof descriptor?.id !== 'string' || descriptor.id.length === 0) {
        throw new Error('Registering an interactable requires a non-empty id.');
      }
      if (!INPUT_TYPES.includes(descriptor.inputType)) {
        throw new Error(
          `Interactable "${descriptor.id}" inputType must be one of ${INPUT_TYPES.join(', ')}.`,
        );
      }
      if (armed.some((entry) => entry.descriptor.id === descriptor.id)) {
        throw new Error(`Interactable "${descriptor.id}" is already armed.`);
      }
      if (element.id && element.id !== descriptor.id) {
        console.warn(
          `Interactable "${descriptor.id}" is registered on element id "${element.id}".`,
        );
      }
      annotate(element, descriptor);
      const entry = { element, descriptor: Object.freeze({ ...descriptor }) };
      armed.push(entry);
      notifySubscribers();
      const dispose = (): void => {
        const index = armed.indexOf(entry);
        if (index < 0) {
          return;
        }
        armed.splice(index, 1);
        unannotate(element);
        notifySubscribers();
      };
      contextGetters.get(registry)?.()?.onCancel(dispose);
      return Object.freeze({ ...entry.descriptor, dispose });
    },
    list(): readonly ArmedInteractable[] {
      return list();
    },
    clear(): void {
      const entries = armed.splice(0);
      entries.forEach((entry) => unannotate(entry.element));
      if (entries.length > 0) {
        notifySubscribers();
      }
    },
    subscribe(subscriber): () => void {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };

  return Object.freeze(registry);
}
