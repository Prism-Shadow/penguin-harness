import { createActor, createMachine, fromPromise } from 'xstate';
import type { AnyEventObject } from 'xstate';

import { createDefinitionIndex, type DefinitionNode } from './definition-index.ts';
import { createEffectScopeRegistry } from './effect-scope-registry.ts';
import {
  bindInteractableRegistrationContext,
  type StateMachineInteractableRegistry,
} from './interactable-registry.ts';
import type {
  StateMachineActor,
  StateMachineDefinition,
  StateMachineImplementations,
  CreateStateMachineOptions,
  StateMachineEvent,
  StateMachineImplementationReference,
  StateMachineParams,
  StateMachineSnapshot,
  StateMachineStateDefinition,
  StateMachineTransition,
} from './types.ts';
import { assertValidStateMachineDefinition } from './validation.ts';

interface InternalStateMachineSnapshot {
  readonly value: unknown;
}

interface InternalActor {
  send(event: AnyEventObject): void;
  start(): unknown;
  stop(): void;
  subscribe(subscriber: (snapshot: InternalStateMachineSnapshot) => void): { unsubscribe(): void };
}

interface InternalActionArguments {
  readonly event: AnyEventObject;
}

const EMPTY_PARAMS: StateMachineParams = Object.freeze({});

function toArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value as T];
}

function implementationType(reference: StateMachineImplementationReference): string {
  return typeof reference === 'string' ? reference : reference.type;
}

function implementationParams(reference: StateMachineImplementationReference): StateMachineParams {
  return typeof reference === 'string' ? EMPTY_PARAMS : (reference.params ?? EMPTY_PARAMS);
}

function eventObject(event: StateMachineEvent | string): StateMachineEvent {
  if (typeof event === 'string') {
    return { type: event };
  }
  if (!event || typeof event.type !== 'string') {
    throw new Error('State machine events require a string type.');
  }
  return event;
}

function stateValuePath(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('State machine produced an unsupported state value.');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== 1) {
    throw new Error('State machine parallel state values are not supported.');
  }
  const [key, child] = entries[0] as [string, unknown];
  const childPath = stateValuePath(child);
  return childPath ? `${key}.${childPath}` : key;
}

export function createStateMachine<TContext extends object = Record<string, unknown>>(
  definition: StateMachineDefinition<TContext>,
  implementations: StateMachineImplementations<TContext> = {},
  options: CreateStateMachineOptions<TContext> = {},
): StateMachineActor<TContext> {
  assertValidStateMachineDefinition(definition);
  const definitionIndex = createDefinitionIndex(definition);
  const actions = implementations.actions ?? {};
  const guards = implementations.guards ?? {};
  const services = implementations.services ?? {};
  const subscribers = new Set<(snapshot: StateMachineSnapshot<TContext>) => void>();
  const context = Object.assign({}, definition.context ?? {}, options.context ?? {}) as TContext;
  const effectScopes = createEffectScopeRegistry();
  let activeRegistrationContext: { onCancel(callback: () => void): void } | undefined;
  if (options.interactables) {
    bindInteractableRegistrationContext(options.interactables, () => activeRegistrationContext);
  }
  let actorRef: InternalActor | undefined;
  let currentPath = '';
  let entryEvent: StateMachineEvent = { type: '@@start' };
  let publishPending = false;
  let status: StateMachineSnapshot<TContext>['status'] = 'idle';
  let synchronousError: unknown;

  const snapshot = (): StateMachineSnapshot<TContext> => Object.freeze({ context, status, value: currentPath });

  const implementation = <T extends (...args: never[]) => unknown>(
    name: string,
    registry: Readonly<Record<string, T>>,
    kind: string,
  ): T => {
    const selected = registry[name];
    if (typeof selected !== 'function') {
      throw new Error(`Unknown state machine ${kind} "${name}".`);
    }
    return selected;
  };

  let send: StateMachineActor<TContext>['send'];

  const runActions = (
    references: StateMachineImplementationReference | readonly StateMachineImplementationReference[] | undefined,
    event: StateMachineEvent,
    ownerPath = '',
    visibleState = currentPath,
  ): void => {
    for (const reference of toArray(references)) {
      const scope = effectScopes.open(ownerPath);
      const interactableRegistry = options.interactables;
      const scopedInteractables = interactableRegistry
        ? Object.freeze({
            register(element: Element, descriptor: Parameters<StateMachineInteractableRegistry['register']>[1]) {
              const registration = interactableRegistry.register(element, descriptor);
              scope.onCancel(registration.dispose);
              return registration;
            },
          })
        : undefined;
      const previousRegistrationContext = activeRegistrationContext;
      activeRegistrationContext = scope;
      let result: unknown;
      try {
        result = implementation(implementationType(reference), actions, 'action')(
          {
            context,
            event,
            interactables: scopedInteractables,
            send,
            state: visibleState,
            onCancel: scope.onCancel,
            signal: scope.signal,
          },
          implementationParams(reference),
        );
      } catch (error) {
        scope.cancel();
        throw error;
      } finally {
        activeRegistrationContext = previousRegistrationContext;
      }
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        Promise.resolve(result).catch((error: unknown) => {
          if (scope.signal.aborted) {
            return;
          }
          console.error('State machine action failed.', error);
          if (options.onError) {
            options.onError(error, snapshot());
          }
        });
      }
    }
  };

  const publish = (): void => {
    const current = snapshot();
    subscribers.forEach((subscriber) => subscriber(current));
    options.onTransition?.(current);
  };

  const captureSynchronousError = (operation: () => void): void => {
    if (synchronousError !== undefined) {
      return;
    }
    try {
      operation();
    } catch (error) {
      synchronousError = error;
    }
  };

  const throwCapturedError = (): void => {
    if (synchronousError === undefined) {
      return;
    }
    const error = synchronousError;
    synchronousError = undefined;
    throw error;
  };

  const publicInvokeEvent = (event: AnyEventObject, path: string, outcome: 'done' | 'error'): StateMachineEvent => {
    const invoke = definitionIndex.node(path).state.invoke;
    const type = `${outcome}.invoke.${invoke?.id ?? path}`;
    return outcome === 'done' ? { output: event.output, type } : { error: event.error, type };
  };

  const publicEvent = (event: AnyEventObject): StateMachineEvent => {
    if (event.type === 'xstate.init') {
      return entryEvent;
    }
    if (event.type.startsWith('xstate.done.actor.')) {
      return publicInvokeEvent(event, currentPath, 'done');
    }
    if (event.type.startsWith('xstate.error.actor.')) {
      return publicInvokeEvent(event, currentPath, 'error');
    }
    return event as StateMachineEvent;
  };

  const compileGuard = (
    reference: StateMachineImplementationReference | undefined,
    eventMapper: (event: AnyEventObject) => StateMachineEvent,
  ): ((argumentsValue: InternalActionArguments) => boolean) | undefined => {
    if (!reference) {
      return undefined;
    }
    return ({ event }): boolean => {
      try {
        return implementation(implementationType(reference), guards, 'guard')(
          { context, event: eventMapper(event), send, state: currentPath },
          implementationParams(reference),
        );
      } catch (error) {
        synchronousError = error;
        return false;
      }
    };
  };

  const xstateTarget = (target: string): string => {
    if (target.startsWith('#')) {
      return target;
    }
    return definitionIndex.has(target) ? `#${definition.id}.${target}` : target;
  };

  const compileTransition = (
    rawTransition: StateMachineTransition,
    source: DefinitionNode,
    eventMapper: (event: AnyEventObject) => StateMachineEvent,
  ): Record<string, unknown> => {
    const transition = typeof rawTransition === 'string' ? { target: rawTransition } : rawTransition;
    const guard = compileGuard(transition.guard, eventMapper);
    if (!transition.target) {
      return {
        ...(guard ? { guard } : {}),
        actions: [({ event }: InternalActionArguments) => {
          captureSynchronousError(() => runActions(transition.actions, eventMapper(event), source.path));
        }],
      };
    }

    const normalizedTarget = definitionIndex.normalizeTarget(transition.target, source);
    const targetPath = definitionIndex.initialLeaf(normalizedTarget);
    const reenter = normalizedTarget === source.path && !source.state.states;

    return {
      ...(guard ? { guard } : {}),
      target: xstateTarget(transition.target),
      ...(reenter ? { reenter: true } : {}),
      actions: [
        ({ event }: InternalActionArguments) => {
          captureSynchronousError(() => {
            currentPath = targetPath;
            entryEvent = eventMapper(event);
            publishPending = true;
          });
        },
        ({ event }: InternalActionArguments) => {
          captureSynchronousError(() => runActions(
            transition.actions,
            eventMapper(event),
            targetPath,
            targetPath,
          ));
        },
      ],
    };
  };

  const invokeFor = (path: string): Record<string, unknown> | undefined => {
    const invoke = definitionIndex.node(path).state.invoke;
    if (!invoke) {
      return undefined;
    }
    const source = definitionIndex.node(path);
    const logic = fromPromise(({ signal }) => {
      const service = implementation(invoke.src, services, 'service');
      const cancellations: Array<() => void> = [];
      let cancelled = signal.aborted;
      const cancel = (): void => {
        if (cancelled) {
          return;
        }
        cancelled = true;
        cancellations.splice(0).forEach((callback) => callback());
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const result = service({
          context,
          event: entryEvent,
          send,
          state: path,
          onCancel(callback): void {
            if (cancelled || signal.aborted) {
              callback();
              return;
            }
            cancellations.push(callback);
          },
          signal,
        });
        const removeAbortListener = (): void => signal.removeEventListener('abort', cancel);
        const promise = Promise.resolve(result);
        void promise.then(removeAbortListener, (error: unknown) => {
          removeAbortListener();
          if (!signal.aborted) {
            console.error('State machine service failed.', error);
          }
        });
        return promise;
      } catch (error) {
        signal.removeEventListener('abort', cancel);
        if (!signal.aborted) {
          console.error('State machine service failed.', error);
        }
        return Promise.reject(error);
      }
    });
    const doneMapper = (event: AnyEventObject): StateMachineEvent => publicInvokeEvent(event, path, 'done');
    const errorMapper = (event: AnyEventObject): StateMachineEvent => publicInvokeEvent(event, path, 'error');
    const onDone = toArray(invoke.onDone).map((transition) => compileTransition(transition, source, doneMapper));
    const onError = toArray(invoke.onError).map((transition) => compileTransition(transition, source, errorMapper));
    onError.push({
      actions: [({ event }: InternalActionArguments) => {
        const mappedEvent = errorMapper(event);
        status = 'error';
        publishPending = true;
        if (options.onError) {
          options.onError(mappedEvent.error, snapshot());
        }
      }],
    });
    return {
      id: invoke.id ?? `invoke_${path.replace(/\./g, '_')}`,
      src: logic,
      ...(onDone.length > 0 ? { onDone } : {}),
      onError,
    };
  };

  function initialChild(
    path: string,
    state: StateMachineStateDefinition,
    startPath: string,
  ): string | undefined {
    if (startPath.startsWith(`${path}.`)) {
      return startPath.slice(path.length + 1).split('.')[0];
    }
    return state.initial;
  }

  function compileStates(
    states: Readonly<Record<string, StateMachineStateDefinition>>,
    parentPath: string,
    startPath: string,
  ): Record<string, unknown> {
    const compiled: Record<string, unknown> = {};
    for (const [key, state] of Object.entries(states)) {
      const path = parentPath ? `${parentPath}.${key}` : key;
      const source = definitionIndex.node(path);
      const invoke = invokeFor(path);
      const on = Object.fromEntries(
        Object.entries(state.on ?? {}).map(([eventType, transitions]) => [
          eventType,
          toArray(transitions).map((transition) => compileTransition(
            transition,
            source,
            (event) => event as StateMachineEvent,
          )),
        ]),
      );
      const after = Object.fromEntries(
        Object.entries(state.after ?? {}).map(([delay, transitions]) => [
          delay,
          toArray(transitions).map((transition) => compileTransition(
            transition,
            source,
            (event) => event as StateMachineEvent,
          )),
        ]),
      );
      const entry = toArray(state.entry).length > 0
        ? [() => captureSynchronousError(() => runActions(state.entry, entryEvent, path, currentPath))]
        : undefined;
      const exit = [
        () => captureSynchronousError(() => effectScopes.cancel([path])),
        ({ event }: InternalActionArguments) => {
          captureSynchronousError(() => runActions(state.exit, publicEvent(event)));
        },
      ];

      compiled[key] = {
        ...(state.type ? { type: state.type } : {}),
        ...(state.states ? {
          initial: initialChild(path, state, startPath),
          states: compileStates(state.states, path, startPath),
        } : {}),
        ...(entry ? { entry } : {}),
        exit,
        ...(invoke ? { invoke } : {}),
        ...(Object.keys(on).length > 0 ? { on } : {}),
        ...(Object.keys(after).length > 0 ? { after } : {}),
      };
    }
    return compiled;
  }

  const createInternalActor = (startPath: string): InternalActor => {
    const rootInitial = startPath.split('.')[0];
    const stateMachine = createMachine({
      id: definition.id,
      initial: rootInitial,
      states: compileStates(definition.states, '', startPath),
    } as never);
    const internalActor = createActor(stateMachine) as unknown as InternalActor;
    internalActor.subscribe((internalSnapshot) => {
      captureSynchronousError(() => {
        currentPath = stateValuePath(internalSnapshot.value);
        if (definitionIndex.node(currentPath).state.type === 'final') {
          status = 'done';
        }
        if (publishPending) {
          publishPending = false;
          publish();
        }
      });
    });
    return internalActor;
  };

  send = (event): StateMachineSnapshot<TContext> => {
    if (status !== 'running') {
      return snapshot();
    }
    actorRef?.send(eventObject(event));
    throwCapturedError();
    return snapshot();
  };

  const start: StateMachineActor<TContext>['start'] = (startOptions = {}) => {
    if (status !== 'idle') {
      return snapshot();
    }
    const startPath = definitionIndex.initialLeaf(startOptions.state ?? definition.initial);
    currentPath = startPath;
    entryEvent = { type: '@@start' };
    publishPending = true;
    status = 'running';
    actorRef = createInternalActor(startPath);
    actorRef.start();
    throwCapturedError();
    return snapshot();
  };

  const stop = (): StateMachineSnapshot<TContext> => {
    actorRef?.stop();
    if (status === 'running') {
      const activePaths = [...definitionIndex.pathChain(currentPath)];
      effectScopes.cancel(activePaths);
      activePaths.reverse().forEach((path) => runActions(
        definitionIndex.node(path).state.exit,
        { type: '@@stop' },
      ));
    }
    status = 'stopped';
    return snapshot();
  };

  return Object.freeze({
    getSnapshot: snapshot,
    send,
    start,
    stop,
    subscribe(subscriber: (current: StateMachineSnapshot<TContext>) => void) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  });
}
