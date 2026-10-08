import { inputManager } from 'input-manager-system';
import pss, { EVENTS } from 'pubsubsingleton';

import {
  ACTIVITY_INTERACTABLES_EVENT,
  createActivityState,
  type ActivityStateObserver,
} from './activity-state.ts';
import { createSelectedAssetHydrator, type HydrateSelectedAssets } from './asset-hydration.ts';
import { createActivityInspection } from './inspection.ts';
import {
  sceneCatalogFromConfiguration,
  type ActivitySceneCatalog,
  type ActivitySceneMetadata,
} from './scene-catalog.ts';
import { createStateMachine } from '../state-machine/xstate-adapter.ts';
import {
  createInteractableRegistry,
  type ArmedInteractable,
  type RegisteredInteractable,
  type StateMachineInteractableRegistry,
} from '../state-machine/interactable-registry.ts';
import {
  stateMachineDefinitionFromConfiguration,
  STATE_MACHINE_CONFIGURATION_KEY,
} from './state-machine-configuration.ts';
import type {
  StateMachineActor,
  StateMachineDefinition,
  StateMachineImplementations,
} from '../state-machine/types.ts';
import { assertValidStateMachineDefinition } from '../state-machine/validation.ts';

export {
  stateMachineDefinitionFromConfiguration,
  STATE_MACHINE_CONFIGURATION_KEY,
};

interface ActivityPubSub {
  publish(event: string, payload?: unknown): void;
  subscribe(event: string, listener: () => void): unknown;
}

/**
 * Scene-owned interactables tracked on the module context for manual
 * disposal. Interactables registered through the runtime's `interactables`
 * registrar dispose themselves when their state exits; this covers elements
 * armed outside that registry.
 */
export interface SceneInteractable {
  dispose(): void;
}

export interface ActivityContext extends Record<string, unknown> {
  _activityPaused: boolean;
  activityState: ActivityStateObserver;
  assets: Record<string, unknown>;
  configuration: Record<string, unknown>;
  hydrateSelectedAssets: HydrateSelectedAssets;
  pubSub: ActivityPubSub;
  root: HTMLElement;
  sceneCatalog: ActivitySceneCatalog;
  theme: Record<string, unknown>;
  user: unknown;
  activeStage: ActivitySceneMetadata | null;
  activeStageId: string;
  activityFinished: boolean;
  backgroundAssetKey: string | null;
  hydratedAssetKeys: Record<string, boolean>;
  hydratingAssetKeys: Record<string, Promise<void>>;
  sceneElement: HTMLElement | null;
  sceneInteractables: SceneInteractable[];
  /**
   * Generated behavior stores arbitrary per-scene facts (attempt counts,
   * selected choices, disabled ids) under the owning scene id, so the value
   * shape stays open. Facts durable enough to be read across actions should
   * be promoted to a declared field instead.
   */
  stageState: Record<string, Record<string, unknown>>;
}

/** @deprecated Use `ActivityContext` instead. */
export type WafActivityData = ActivityContext;

export interface StateMachineRuntime<TContext extends object> {
  getSnapshot(): ReturnType<StateMachineActor<TContext>['getSnapshot']> | null;
  setInteractive(interactive: boolean): void;
  send(event: Parameters<StateMachineActor<TContext>['send']>[0]): ReturnType<StateMachineActor<TContext>['send']> | null;
  /** Live registry of armed Interactables; entries dispose when their state exits. */
  readonly interactables: {
    register(element: Element, descriptor: StateMachineInteractableDescriptor): RegisteredInteractable;
    list(): readonly ArmedInteractable[];
    clear(): void;
  };
}

type StateMachineInteractableDescriptor = Parameters<
  StateMachineInteractableRegistry['register']
>[1];

export interface BootstrapStateMachineOptions<TData extends ActivityContext = ActivityContext> {
  readonly beforeHydrate?: (argumentsValue: { data: TData; stateMachine: StateMachineActor<TData> }) => void | Promise<void>;
  readonly createImplementations: (
    data: TData,
    runtime: StateMachineRuntime<TData>,
  ) => StateMachineImplementations<TData>;
  readonly getDefinition?: (configuration: Record<string, unknown>) => unknown | Promise<unknown>;
  readonly prerequisites?: readonly string[];
  readonly rootId: string;
  readonly sceneIds?: readonly string[];
}

export function previewStartState(
  configuration: Record<string, unknown>,
  definition: StateMachineDefinition,
  sceneIds: readonly string[],
): string {
  const preview = configuration.__loomPreview;
  if (typeof preview !== 'object' || preview === null || Array.isArray(preview)) {
    return definition.initial;
  }
  const sceneId = (preview as Record<string, unknown>).startSceneId;
  return typeof sceneId === 'string' && sceneIds.includes(sceneId) ? sceneId : definition.initial;
}

export function bootstrapStateMachine<TData extends ActivityContext = ActivityContext>(
  options: BootstrapStateMachineOptions<TData>,
): void {
  const { register, ready } = Activity.Modules;
  register({
    id: MODULE_ID,
    type: 'html',
    async initialize(pubSub, declaration, configuration, user): Promise<void> {
      pss.setup({ pubSub });
      inputManager.initialize({
        longPressConfirmDuration: configuration.longPressConfirmDuration,
        moduleId: MODULE_ID,
      });
      const root = document.getElementById(options.rootId);
      if (!root) {
        throw new Error(`State machine root "${options.rootId}" was not found.`);
      }

      const definitionValue = options.getDefinition
        ? await options.getDefinition(configuration)
        : stateMachineDefinitionFromConfiguration(configuration);
      assertValidStateMachineDefinition(definitionValue, {
        requireActivityComplete: true,
        sceneIds: options.sceneIds,
      });
      const definition = definitionValue as StateMachineDefinition<TData>;
      const stateMachineSceneIds = Object.keys(definition.states).filter((stateId) => stateId !== 'activity');
      const sceneIds = options.sceneIds ?? stateMachineSceneIds;
      const sceneCatalog = sceneCatalogFromConfiguration(configuration, sceneIds);
      const data = {
        _activityPaused: false,
        assets: declaration.assets,
        configuration,
        pubSub,
        root,
        sceneCatalog,
        theme: declaration.properties,
        user,
      } as unknown as TData;
      data.hydrateSelectedAssets = createSelectedAssetHydrator(configuration, declaration.assets);
      const activityState = createActivityState(root, 'activity.initializing');
      data.activityState = activityState;
      const interactables = createInteractableRegistry();
      interactables.subscribe((currentInteractables) => {
        if (typeof root.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
          root.dispatchEvent(new CustomEvent(ACTIVITY_INTERACTABLES_EVENT, {
            detail: structuredClone(currentInteractables),
          }));
        }
      });
      const inspection = createActivityInspection(activityState, interactables, definition);
      if (Activity.Inspection) {
        throw new Error('Activity.Inspection is already registered.');
      }
      Object.defineProperty(Activity, 'Inspection', {
        configurable: true,
        enumerable: true,
        value: inspection,
        writable: false,
      });
      let actor: StateMachineActor<TData> | null = null;
      let observedInteractive = false;
      let observedState = '';
      let pendingInteractiveState = '';
      const runtime: StateMachineRuntime<TData> = {
        getSnapshot: () => actor?.getSnapshot() ?? null,
        setInteractive(interactive): void {
          const snapshot = actor?.getSnapshot();
          if (!snapshot || snapshot.status !== 'running' || !snapshot.value) {
            return;
          }
          pendingInteractiveState = interactive ? snapshot.value : '';
          if (snapshot.value !== observedState) {
            return;
          }
          if (interactive === observedInteractive) {
            return;
          }
          observedInteractive = interactive;
          data.activityState.enter(snapshot.value, {
            cause: 'interactive-readiness',
            interactive,
          });
        },
        send: (event) => actor?.send(event) ?? null,
        interactables,
      };
      const implementations = options.createImplementations(data, runtime);
      assertValidStateMachineDefinition(definition, {
        implementationNames: new Set([
          ...Object.keys(implementations.actions ?? {}),
          ...Object.keys(implementations.guards ?? {}),
          ...Object.keys(implementations.services ?? {}),
        ]),
        requireActivityComplete: true,
        sceneIds,
      });
      let activityEnded = false;
      actor = createStateMachine(definition, implementations, {
        context: data,
        interactables,
        onTransition(snapshot): void {
          observedState = snapshot.value;
          observedInteractive = pendingInteractiveState === snapshot.value;
          data.activityState.enter(snapshot.value, {
            cause: 'state-machine',
            interactive: observedInteractive,
          });
          pendingInteractiveState = '';
          if (snapshot.status === 'done' && !activityEnded) {
            activityEnded = true;
            pubSub.publish(EVENTS.activity.end);
          }
        },
      });
      await options.beforeHydrate?.({ data, stateMachine: actor });
      if (options.prerequisites?.length) {
        await data.hydrateSelectedAssets(options.prerequisites);
      }
      pubSub.subscribe(EVENTS.activity.start, () => {
        actor?.start({ state: previewStartState(configuration, definition, sceneIds) });
      });
      pubSub.subscribe(EVENTS.activity.pause, () => {
        data._activityPaused = true;
      });
      pubSub.subscribe(EVENTS.activity.resume, () => {
        data._activityPaused = false;
      });
      ready(MODULE_ID);
    },
  });
}
